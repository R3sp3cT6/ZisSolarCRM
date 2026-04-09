import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  stations,
  stationRealtime,
  productionDaily,
  productionMonthly,
  productionYearly,
  syncLog,
} from "@/db/schema";
import { getFusionSolarClient } from "@/lib/fusionsolar/client";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncType =
    request.nextUrl.searchParams.get("type") || "realtime";
  const startedAt = new Date();

  try {
    const client = getFusionSolarClient();
    await client.login();

    let recordsSynced = 0;

    if (syncType === "realtime" || syncType === "stations") {
      // Sync stations
      const stationList = await client.getStationList();
      if (stationList?.list) {
        for (const s of stationList.list) {
          await db
            .insert(stations)
            .values({
              stationCode: s.stationCode,
              stationName: s.stationName,
              capacity: String(s.capacity || 0),
              address: s.stationAddr || "",
              contactPerson: s.contactPerson || "",
            })
            .onConflictDoUpdate({
              target: stations.stationCode,
              set: {
                stationName: s.stationName,
                capacity: String(s.capacity || 0),
                address: s.stationAddr || "",
                contactPerson: s.contactPerson || "",
                updatedAt: new Date(),
              },
            });
        }

        // Sync realtime KPI
        const codes = stationList.list.map((s) => s.stationCode);
        if (codes.length > 0) {
          const realtimeData = await client.getStationRealKpi(codes);
          if (realtimeData) {
            for (const rt of realtimeData) {
              await db
                .insert(stationRealtime)
                .values({
                  stationCode: rt.stationCode,
                  dayPower: String(rt.dataItemMap.day_power || 0),
                  monthPower: String(rt.dataItemMap.month_power || 0),
                  totalPower: String(rt.dataItemMap.total_power || 0),
                  dayIncome: String(rt.dataItemMap.day_income || 0),
                  totalIncome: String(rt.dataItemMap.total_income || 0),
                  realHealthState: rt.dataItemMap.real_health_state || 0,
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: stationRealtime.stationCode,
                  set: {
                    dayPower: String(rt.dataItemMap.day_power || 0),
                    monthPower: String(rt.dataItemMap.month_power || 0),
                    totalPower: String(rt.dataItemMap.total_power || 0),
                    dayIncome: String(rt.dataItemMap.day_income || 0),
                    totalIncome: String(rt.dataItemMap.total_income || 0),
                    realHealthState: rt.dataItemMap.real_health_state || 0,
                    updatedAt: new Date(),
                  },
                });
              recordsSynced++;
            }
          }
        }
      }
    }

    if (syncType === "daily") {
      const allStations = await db.select().from(stations);
      const codes = allStations.map((s) => s.stationCode);
      if (codes.length > 0) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);

        const data = await client.getKpiStationDay(
          codes,
          yesterday.getTime()
        );
        if (data) {
          for (const kpi of data) {
            const dateStr = yesterday.toISOString().split("T")[0];
            await db
              .insert(productionDaily)
              .values({
                stationCode: kpi.stationCode,
                collectDate: dateStr,
                inverterPower: String(
                  kpi.dataItemMap.inverter_power || 0
                ),
                feedInPower: String(kpi.dataItemMap.ongrid_power || 0),
                usePower: String(kpi.dataItemMap.use_power || 0),
                revenue: String(kpi.dataItemMap.power_profit || 0),
                installedCapacity: String(
                  kpi.dataItemMap.installed_capacity || 0
                ),
                performanceRatio: String(
                  kpi.dataItemMap.perpower_ratio || 0
                ),
              })
              .onConflictDoNothing();
            recordsSynced++;
          }
        }
      }
    }

    if (syncType === "monthly") {
      const allStations = await db.select().from(stations);
      const codes = allStations.map((s) => s.stationCode);
      if (codes.length > 0) {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        lastMonth.setDate(1);
        lastMonth.setHours(0, 0, 0, 0);

        const data = await client.getKpiStationMonth(
          codes,
          lastMonth.getTime()
        );
        if (data) {
          for (const kpi of data) {
            const monthStr = lastMonth.toISOString().split("T")[0];
            await db
              .insert(productionMonthly)
              .values({
                stationCode: kpi.stationCode,
                collectMonth: monthStr,
                inverterPower: String(
                  kpi.dataItemMap.inverter_power || 0
                ),
                feedInPower: String(kpi.dataItemMap.ongrid_power || 0),
                usePower: String(kpi.dataItemMap.use_power || 0),
                revenue: String(kpi.dataItemMap.power_profit || 0),
                installedCapacity: String(
                  kpi.dataItemMap.installed_capacity || 0
                ),
                performanceRatio: String(
                  kpi.dataItemMap.perpower_ratio || 0
                ),
              })
              .onConflictDoNothing();
            recordsSynced++;
          }
        }
      }
    }

    if (syncType === "yearly") {
      const allStations = await db.select().from(stations);
      const codes = allStations.map((s) => s.stationCode);
      if (codes.length > 0) {
        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        lastYear.setMonth(0);
        lastYear.setDate(1);
        lastYear.setHours(0, 0, 0, 0);

        const data = await client.getKpiStationYear(
          codes,
          lastYear.getTime()
        );
        if (data) {
          for (const kpi of data) {
            await db
              .insert(productionYearly)
              .values({
                stationCode: kpi.stationCode,
                collectYear: lastYear.getFullYear(),
                inverterPower: String(
                  kpi.dataItemMap.inverter_power || 0
                ),
                feedInPower: String(kpi.dataItemMap.ongrid_power || 0),
                usePower: String(kpi.dataItemMap.use_power || 0),
                revenue: String(kpi.dataItemMap.power_profit || 0),
                installedCapacity: String(
                  kpi.dataItemMap.installed_capacity || 0
                ),
                performanceRatio: String(
                  kpi.dataItemMap.perpower_ratio || 0
                ),
              })
              .onConflictDoNothing();
            recordsSynced++;
          }
        }
      }
    }

    await db.insert(syncLog).values({
      syncType,
      status: "success",
      recordsSynced,
      startedAt,
      completedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      syncType,
      recordsSynced,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await db.insert(syncLog).values({
      syncType,
      status: "error",
      errorMessage,
      recordsSynced: 0,
      startedAt,
      completedAt: new Date(),
    });

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
