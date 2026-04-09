import { db } from "@/db";
import { stationRealtime, stations, productionDaily } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { SummaryCards } from "@/components/charts/summary-cards";
import { ProductionBarChart } from "@/components/charts/production-bar-chart";
import { t } from "@/lib/i18n/mk";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetch realtime aggregated data
  const [realtimeAgg] = await db
    .select({
      dayPower: sql<number>`COALESCE(SUM(CAST(${stationRealtime.dayPower} as DECIMAL)), 0)`,
      monthPower: sql<number>`COALESCE(SUM(CAST(${stationRealtime.monthPower} as DECIMAL)), 0)`,
      totalPower: sql<number>`COALESCE(SUM(CAST(${stationRealtime.totalPower} as DECIMAL)), 0)`,
    })
    .from(stationRealtime);

  const stationsCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(stations);

  // Fetch last 7 days production
  const last7Days = await db
    .select({
      date: productionDaily.collectDate,
      production: sql<number>`COALESCE(SUM(CAST(${productionDaily.inverterPower} as DECIMAL)), 0)`,
    })
    .from(productionDaily)
    .groupBy(productionDaily.collectDate)
    .orderBy(desc(productionDaily.collectDate))
    .limit(7);

  const chartData = last7Days.reverse().map((d) => ({
    label: new Date(d.date).toLocaleDateString("mk-MK", {
      day: "2-digit",
      month: "2-digit",
    }),
    production: Number(d.production),
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t.dashboard.title}</h1>

      <SummaryCards
        dayPower={Number(realtimeAgg?.dayPower || 0)}
        monthPower={Number(realtimeAgg?.monthPower || 0)}
        totalPower={Number(realtimeAgg?.totalPower || 0)}
        stationsCount={Number(stationsCount[0]?.count || 0)}
      />

      <ProductionBarChart
        data={chartData}
        title={t.dashboard.last7Days}
      />
    </div>
  );
}
