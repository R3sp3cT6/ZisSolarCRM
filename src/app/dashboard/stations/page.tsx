import { db } from "@/db";
import { stations, stationRealtime } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";
import { t } from "@/lib/i18n/mk";

export const dynamic = "force-dynamic";

function getHealthLabel(state: number | null) {
  switch (state) {
    case 1:
      return { label: "Нормално", variant: "default" as const };
    case 2:
      return { label: "Аларм", variant: "destructive" as const };
    case 3:
      return { label: "Офлајн", variant: "secondary" as const };
    default:
      return { label: "Непознато", variant: "outline" as const };
  }
}

export default async function StationsPage() {
  const allStations = await db
    .select({
      stationCode: stations.stationCode,
      stationName: stations.stationName,
      capacity: stations.capacity,
      address: stations.address,
      dayPower: stationRealtime.dayPower,
      monthPower: stationRealtime.monthPower,
      totalPower: stationRealtime.totalPower,
      healthState: stationRealtime.realHealthState,
    })
    .from(stations)
    .leftJoin(
      stationRealtime,
      eq(stations.stationCode, stationRealtime.stationCode)
    );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t.nav.stations}</h1>

      {allStations.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center h-32 text-muted-foreground">
            {t.production.noData}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {allStations.map((station) => {
            const health = getHealthLabel(station.healthState);
            return (
              <Card key={station.stationCode}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4 text-orange-500" />
                    {station.stationName}
                  </CardTitle>
                  <Badge variant={health.variant}>{health.label}</Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t.production.capacity}
                      </p>
                      <p className="font-medium">
                        {Number(station.capacity || 0).toFixed(1)} kWp
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t.dashboard.todayProduction}
                      </p>
                      <p className="font-medium">
                        {Number(station.dayPower || 0).toFixed(2)} kWh
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t.dashboard.monthProduction}
                      </p>
                      <p className="font-medium">
                        {Number(station.monthPower || 0).toFixed(2)} kWh
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t.dashboard.totalProduction}
                      </p>
                      <p className="font-medium">
                        {Number(station.totalPower || 0).toFixed(2)} kWh
                      </p>
                    </div>
                  </div>
                  {station.address && (
                    <p className="text-xs text-muted-foreground">
                      {station.address}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
