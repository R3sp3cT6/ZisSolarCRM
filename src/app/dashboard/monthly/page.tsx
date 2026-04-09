import { db } from "@/db";
import { productionDaily, productionMonthly, stations } from "@/db/schema";
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
  searchParams: Promise<{ month?: string }>;
}

export default async function MonthlyPage({ searchParams }: Props) {
  const params = await searchParams;
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const selectedMonth = params.month || defaultMonth;

  const [yearStr, monthStr] = selectedMonth.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr) - 1;

  // Get all months of the selected year for the chart
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const monthlyData = await db
    .select({
      month: sql<string>`TO_CHAR(${productionDaily.collectDate}::date, 'YYYY-MM')`,
      production: sql<number>`COALESCE(SUM(CAST(${productionDaily.inverterPower} as DECIMAL)), 0)`,
      feedIn: sql<number>`COALESCE(SUM(CAST(${productionDaily.feedInPower} as DECIMAL)), 0)`,
      selfConsumption: sql<number>`COALESCE(SUM(CAST(${productionDaily.usePower} as DECIMAL)), 0)`,
    })
    .from(productionDaily)
    .where(
      and(
        gte(productionDaily.collectDate, yearStart),
        lte(productionDaily.collectDate, yearEnd)
      )
    )
    .groupBy(sql`TO_CHAR(${productionDaily.collectDate}::date, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${productionDaily.collectDate}::date, 'YYYY-MM')`);

  const chartData = monthlyData.map((d) => {
    const m = parseInt(d.month.split("-")[1]) - 1;
    return {
      label: t.months[m].substring(0, 3),
      production: Number(d.production),
      feedIn: Number(d.feedIn),
      selfConsumption: Number(d.selfConsumption),
    };
  });

  // Fetch per-station data for selected month
  const monthStart = `${selectedMonth}-01`;
  const monthEnd = new Date(year, month + 1, 0).toISOString().split("T")[0];

  const stationData = await db
    .select({
      stationCode: productionDaily.stationCode,
      stationName: stations.stationName,
      production: sql<number>`COALESCE(SUM(CAST(${productionDaily.inverterPower} as DECIMAL)), 0)`,
      feedIn: sql<number>`COALESCE(SUM(CAST(${productionDaily.feedInPower} as DECIMAL)), 0)`,
      selfConsumption: sql<number>`COALESCE(SUM(CAST(${productionDaily.usePower} as DECIMAL)), 0)`,
      revenue: sql<number>`COALESCE(SUM(CAST(${productionDaily.revenue} as DECIMAL)), 0)`,
    })
    .from(productionDaily)
    .leftJoin(stations, eq(productionDaily.stationCode, stations.stationCode))
    .where(
      and(
        gte(productionDaily.collectDate, monthStart),
        lte(productionDaily.collectDate, monthEnd)
      )
    )
    .groupBy(productionDaily.stationCode, stations.stationName);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t.nav.monthly}</h1>
        <Suspense>
          <DatePickerControl
            type="month"
            paramName="month"
            defaultValue={defaultMonth}
            label={t.production.selectMonth}
          />
        </Suspense>
      </div>

      <ProductionBarChart
        data={chartData}
        title={`${t.production.production} - ${year}`}
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
                    {Number(row.production).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.feedIn).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.selfConsumption).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.revenue).toFixed(2)}
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
