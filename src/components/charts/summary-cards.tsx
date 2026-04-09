"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Calendar, Zap, Activity } from "lucide-react";
import { t } from "@/lib/i18n/mk";

interface SummaryCardsProps {
  dayPower: number;
  monthPower: number;
  totalPower: number;
  stationsCount: number;
}

export function SummaryCards({
  dayPower,
  monthPower,
  totalPower,
  stationsCount,
}: SummaryCardsProps) {
  const cards = [
    {
      title: t.dashboard.todayProduction,
      value: `${dayPower.toFixed(2)} ${t.dashboard.kWh}`,
      icon: Sun,
      color: "text-orange-500",
      bg: "bg-orange-50",
    },
    {
      title: t.dashboard.monthProduction,
      value: `${monthPower.toFixed(2)} ${t.dashboard.kWh}`,
      icon: Calendar,
      color: "text-blue-500",
      bg: "bg-blue-50",
    },
    {
      title: t.dashboard.totalProduction,
      value:
        totalPower >= 1000
          ? `${(totalPower / 1000).toFixed(2)} ${t.dashboard.MWh}`
          : `${totalPower.toFixed(2)} ${t.dashboard.kWh}`,
      icon: Zap,
      color: "text-green-500",
      bg: "bg-green-50",
    },
    {
      title: t.dashboard.stationsCount,
      value: String(stationsCount),
      icon: Activity,
      color: "text-purple-500",
      bg: "bg-purple-50",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {card.title}
            </CardTitle>
            <div className={`${card.bg} p-2 rounded-lg`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
