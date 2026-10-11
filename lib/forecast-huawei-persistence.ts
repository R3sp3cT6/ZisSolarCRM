import type { ForecastConfig } from './forecast-model';
import type { LiveObservation, TrialHour, TrialRun } from './forecast-trial';
import { makeSatelliteNowcast, trialPower } from './forecast-trial';
import {
  instantClearSky,
  satelliteCorrection,
  satellitePower,
} from './forecast-satellite-nowcast';
import { weatherAdjustedEnergy, type SolarCalibration } from './forecast-solar';
import type { SatellitePoint } from './forecast-satellite';

/** Experimental measured clear-sky power persistence. Weather/geometry must be
 * known at issuance; no later satellite or inverter sample may enter the run. */
export function makeMeasuredNowcast(
  hours: TrialHour[],
  observations: LiveObservation[],
  config: ForecastConfig,
  baselineId: string,
  weatherRunAt: string | null,
  points: SatellitePoint[],
  calibration: SolarCalibration,
  now = new Date(),
): TrialRun & {
  measuredCorrection?: { index: number; measuredAt: string };
  v34Hours: TrialRun['hours'];
} {
  const previous = makeSatelliteNowcast(
    hours,
    observations,
    config,
    baselineId,
    weatherRunAt,
    points,
    calibration,
    now,
  );
  const result = {
    ...previous,
    id: crypto.randomUUID(),
    version: 'weather-solar-v3.5-measured',
    v34Hours: previous.hours,
  };
  if (
    ['stale-weather', 'incomplete-or-stopped'].includes(previous.status) ||
    config.acKw === null
  )
    return result;
  const samples = [
    ...new Map(
      observations
        .filter(
          (s) =>
            [s.measuredAt, s.receivedAt].every((t) =>
              Number.isFinite(Date.parse(t)),
            ) &&
            Date.parse(s.measuredAt) <= Date.parse(s.receivedAt) &&
            Date.parse(s.receivedAt) <= now.getTime() &&
            now.getTime() - Date.parse(s.measuredAt) <= 15 * 60000 &&
            Number.isFinite(s.powerKw) &&
            s.powerKw >= 0 &&
            Number.isFinite(s.totalKwh) &&
            s.totalKwh >= 0,
        )
        .map((s) => [s.measuredAt, s]),
    ).values(),
  ]
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .slice(-2);
  if (samples.length < 2) return result;
  const [a, b] = samples,
    gap = Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
  if (
    now.getTime() - Date.parse(b.measuredAt) > 10 * 60000 ||
    gap < 300000 ||
    gap > 600000 ||
    !a.allProducing ||
    !b.allProducing ||
    a.inverters !== b.inverters ||
    b.totalKwh <= a.totalKwh
  )
    return result;
  function clearPower(at: number) {
    const hour = hours.find(
      (h) => Date.parse(h.start) <= at && Date.parse(h.start) + 3600000 > at,
    );
    const ghi = instantClearSky(at, config);
    if (!hour?.weather || ghi === null) return null;
    return weatherAdjustedEnergy(
      {
        start: new Date(at - 1800000).toISOString(),
        irradiance: ghi,
        ...hour.weather,
        cloudCover: null,
        irradianceKind: 'modeled-ghi',
        resolutionHours: 1,
      },
      config,
      calibration,
    );
  }
  const clears = samples.map((s) => clearPower(Date.parse(s.measuredAt)));
  if (clears.some((p) => p === null || p < Math.max(10, config.acKw! * 0.03)))
    return result;
  const index = Math.min(
    1.5,
    (0.35 * a.powerKw) / clears[0]! + (0.65 * b.powerKw) / clears[1]!,
  );
  const state = satelliteCorrection(points, config, now),
    first = Math.ceil(now.getTime() / 900000) * 900000;
  const predicted: TrialRun['hours'] = [];
  for (let i = 0; i < 4; i++) {
    const start = first + i * 900000,
      end = start + 900000;
    let total = 0,
      base = 0,
      v32 = 0,
      weight = 0,
      complete = true,
      baselineComplete = true;
    for (let j = 0; j < 3; j++) {
      const at = start + (j + 0.5) * 300000,
        power = trialPower(hours, at),
        clear = clearPower(at);
      const hour = hours.find(
        (h) => Date.parse(h.start) <= at && Date.parse(h.start) + 3600000 > at,
      );
      if (power === null || clear === null || !hour?.weather) {
        complete = false;
        break;
      }
      const satellite = satellitePower(
        at,
        power,
        hour.weather,
        config,
        calibration,
        state,
      );
      const w = 0.95 * Math.exp(-(at - Date.parse(b.measuredAt)) / 60000 / 60);
      total +=
        Math.min(
          config.acKw,
          Math.max(0, clear * index * w + satellite.powerKw * (1 - w)),
        ) / 12;
      base += power / 12;
      weight += ((1 - w) * satellite.weight) / 3;
      if (hour.baselineKwh === null) baselineComplete = false;
      else v32 += hour.baselineKwh / 12;
    }
    if (!complete) return result;
    predicted.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      predictedKwh: total,
      baselineKwh: base,
      v32Kwh: baselineComplete ? v32 : null,
      satelliteWeight: weight,
      leadMinutes: (start + 450000 - now.getTime()) / 60000,
    });
  }
  return {
    ...result,
    status: 'ready',
    hours: predicted,
    measuredCorrection: { index, measuredAt: b.measuredAt },
  };
}
