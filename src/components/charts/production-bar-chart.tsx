"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n/mk";

interface ChartData {
  label: string;
  production: number;
  feedIn?: number;
  selfConsumption?: number;
}

interface ProductionBarChartProps {
  data: ChartData[];
  title: string;
  showBreakdown?: boolean;
}

export function ProductionBarChart({
  data,
  title,
  showBreakdown = false,
}: ProductionBarChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            {t.production.noData}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip
                formatter={(value: any) =>
                  `${Number(value).toFixed(2)} kWh`
                }
              />
              <Legend />
              {showBreakdown ? (
                <>
                  <Bar
                    dataKey="feedIn"
                    name={t.production.feedIn}
                    fill="#3b82f6"
                    radius={[2, 2, 0, 0]}
                    stackId="a"
                  />
                  <Bar
                    dataKey="selfConsumption"
                    name={t.production.selfConsumption}
                    fill="#f97316"
                    radius={[2, 2, 0, 0]}
                    stackId="a"
                  />
                </>
              ) : (
                <Bar
                  dataKey="production"
                  name={t.production.production}
                  fill="#f97316"
                  radius={[4, 4, 0, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
