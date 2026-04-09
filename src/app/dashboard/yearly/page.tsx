import { db } from "@/db";
import { productionMonthly, productionYearly, stations } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ProductionBarChart } from "@/components/charts/production-bar-chart";
import { YearSelector } from "@/components/charts/year-selector";
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
  searchParams: Promise<{ year?: string }>;
}

export default async function YearlyPage({ searchParams }: Props) {
  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const selectedYear = parseInt(params.year || String(currentYear));

  // Fetch monthly data for the selected year
  const monthlyData = await db
    .select({
      month: sql<string>`TO_CHAR(${productionMonthly.collectMonth}::date, 'MM')`,
      production: sql<number>`COALESCE(SUM(CAST(${productionMonthly.inverterPower} as DECIMAL)), 0)`,
      feedIn: sql<number>`COALESCE(SUM(CAST(${productionMonthly.feedInPower} as DECIMAL)), 0)`,
      selfConsumption: sql<number>`COALESCE(SUM(CAST(${productionMonthly.usePower} as DECIMAL)), 0)`,
    })
    .from(productionMonthly)
    .where(
      sql`EXTRACT(YEAR FROM ${productionMonthly.collectMonth}::date) = ${selectedYear}`
    )
    .groupBy(sql`TO_CHAR(${productionMonthly.collectMonth}::date, 'MM')`)
    .orderBy(sql`TO_CHAR(${productionMonthly.collectMonth}::date, 'MM')`);

  const chartData = monthlyData.map((d) => ({
    label: t.months[parseInt(d.month) - 1].substring(0, 3),
    production: Number(d.production),
    feedIn: Number(d.feedIn),
    selfConsumption: Number(d.selfConsumption),
  }));

  // Fetch yearly totals per station
  const yearlyStationData = await db
    .select({
      stationCode: productionYearly.stationCode,
      stationName: stations.stationName,
      production: productionYearly.inverterPower,
      feedIn: productionYearly.feedInPower,
      selfConsumption: productionYearly.usePower,
      revenue: productionYearly.revenue,
    })
    .from(productionYearly)
    .leftJoin(
      stations,
      eq(productionYearly.stationCode, stations.stationCode)
    )
    .where(eq(productionYearly.collectYear, selectedYear));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t.nav.yearly}</h1>
        <Suspense>
          <YearSelector defaultValue={String(currentYear)} />
        </Suspense>
      </div>

      <ProductionBarChart
        data={chartData}
        title={`${t.production.production} - ${selectedYear}`}
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
            {yearlyStationData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  {t.production.noData}
                </TableCell>
              </TableRow>
            ) : (
              yearlyStationData.map((row) => (
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
