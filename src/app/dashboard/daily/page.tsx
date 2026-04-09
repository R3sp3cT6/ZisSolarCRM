import { db } from "@/db";
import { productionDaily, stations } from "@/db/schema";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import { ProductionBarChart } from "@/components/charts/production-bar-chart";
import { DatePickerControl } from "@/components/charts/date-picker-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { t } from "@/lib/i18n/mk";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

export default async function DailyPage({ searchParams }: Props) {
  const params = await searchParams;
  const today = new Date().toISOString().split("T")[0];
  const selectedDate = params.date || today;

  // Get start and end of month for the selected date
  const dateObj = new Date(selectedDate);
  const monthStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const monthEnd = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0)
    .toISOString()
    .split("T")[0];

  // Fetch daily data for the entire month
  const dailyData = await db
    .select({
      date: productionDaily.collectDate,
      production: sql<number>`COALESCE(SUM(CAST(${productionDaily.inverterPower} as DECIMAL)), 0)`,
      feedIn: sql<number>`COALESCE(SUM(CAST(${productionDaily.feedInPower} as DECIMAL)), 0)`,
      selfConsumption: sql<number>`COALESCE(SUM(CAST(${productionDaily.usePower} as DECIMAL)), 0)`,
      revenue: sql<number>`COALESCE(SUM(CAST(${productionDaily.revenue} as DECIMAL)), 0)`,
    })
    .from(productionDaily)
    .where(
      and(
        gte(productionDaily.collectDate, monthStart),
        lte(productionDaily.collectDate, monthEnd)
      )
    )
    .groupBy(productionDaily.collectDate)
    .orderBy(productionDaily.collectDate);

  const chartData = dailyData.map((d) => ({
    label: new Date(d.date).toLocaleDateString("mk-MK", {
      day: "2-digit",
      month: "2-digit",
    }),
    production: Number(d.production),
    feedIn: Number(d.feedIn),
    selfConsumption: Number(d.selfConsumption),
  }));

  // Fetch per-station data for selected date
  const stationData = await db
    .select({
      stationCode: productionDaily.stationCode,
      stationName: stations.stationName,
      production: productionDaily.inverterPower,
      feedIn: productionDaily.feedInPower,
      selfConsumption: productionDaily.usePower,
      revenue: productionDaily.revenue,
    })
    .from(productionDaily)
    .leftJoin(stations, eq(productionDaily.stationCode, stations.stationCode))
    .where(eq(productionDaily.collectDate, selectedDate));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t.nav.daily}</h1>
        <Suspense>
          <DatePickerControl
            type="date"
            paramName="date"
            defaultValue={today}
            label={t.production.selectDate}
          />
        </Suspense>
      </div>

      <ProductionBarChart
        data={chartData}
        title={`${t.production.production} - ${t.months[dateObj.getMonth()]} ${dateObj.getFullYear()}`}
        showBreakdown
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.production.station}</TableHead>
              <TableHead className="text-right">
                {t.production.production} (kWh)
              </TableHead>
              <TableHead className="text-right">
                {t.production.feedIn} (kWh)
              </TableHead>
              <TableHead className="text-right">
                {t.production.selfConsumption} (kWh)
              </TableHead>
              <TableHead className="text-right">
                {t.production.revenue}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stationData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {t.production.noData}
                </TableCell>
              </TableRow>
            ) : (
              stationData.map((row) => (
                <TableRow key={row.stationCode}>
                  <TableCell className="font-medium">
                    {row.stationName || row.stationCode}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.production || 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.feedIn || 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.selfConsumption || 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.revenue || 0).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
