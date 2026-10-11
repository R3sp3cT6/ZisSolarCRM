import { slotsForDay, localDate } from './energy';
import {
  addDays,
  productionProfile,
  type ForecastConfig,
  type ForecastReading,
  type WeatherHour,
} from './forecast-model';
import {
  calibrateSolar,
  clearSkyIrradiance,
  cloudTransmission,
  weatherAdjustedEnergy,
} from './forecast-solar';

export const BACKTEST_VERSION = 'weather-solar-v3.0-gfs-replay-v1';
type Field = {
  value: number;
  units: string;
  latitude: number;
  longitude: number;
  distanceKm: number;
  sha256: string;
  byteRange: string;
};
export type GfsArchive = {
  day: string;
  provider: string;
  gridDegrees: number;
  resolutionHours: number;
  fetchedAt: string;
  latitude: number;
  longitude: number;
  points: {
    validAt: string;
    runAt: string;
    sourceUrl: string;
    indexSha256: string;
    fields: Record<'temperature' | 'cloud' | 'u' | 'v', Field>;
  }[];
};
export type BacktestHour = {
  start: string;
  productionKwh: number | null;
  originAt: string;
  weatherRunAt: string;
};
export type BacktestPayload = {
  id: string;
  createdAt: string;
  modelVersion: string;
  fromDate: string;
  toDate: string;
  source: 'NOAA GFS';
  days: {
    date: string;
    historyDays: number;
    productionKwh: number | null;
    hours: BacktestHour[];
  }[];
};

export function backtestOrigin(day: string) {
  const previous = addDays(day, -1);
  return {
    weatherRunAt: previous + 'T12:00:00.000Z',
    originAt: previous + 'T18:00:00.000Z',
  };
}

// Original instantaneous GFS fields, interpolated at each delivery-hour midpoint.
// This is a replay with a different weather source, not an as-issued MET forecast.
export function gfsWeather(
  archive: GfsArchive,
  config: ForecastConfig,
): WeatherHour[] {
  const { weatherRunAt } = backtestOrigin(archive.day);
  if (
    archive.provider !== 'NOAA GFS' ||
    archive.gridDegrees !== 0.25 ||
    archive.resolutionHours !== 3 ||
    Math.abs(archive.latitude - config.latitude!) > 0.001 ||
    Math.abs(archive.longitude - config.longitude!) > 0.001
  )
    throw Error('Unexpected GFS archive location/model');
  const points = [...archive.points].sort(
    (a, b) => Date.parse(a.validAt) - Date.parse(b.validAt),
  );
  const seen = new Set<number>();
  for (const p of points) {
    const stamp = Date.parse(p.validAt);
    if (
      !Number.isFinite(stamp) ||
      stamp % 3600000 !== 0 ||
      seen.has(stamp) ||
      Date.parse(p.runAt) !== Date.parse(weatherRunAt) ||
      stamp <= Date.parse(p.runAt) ||
      !p.sourceUrl.startsWith('https://noaa-gfs-bdp-pds.s3.amazonaws.com/')
    )
      throw Error('Invalid archived GFS run');
    seen.add(stamp);
    for (const [key, units] of [
      ['temperature', 'K'],
      ['cloud', '%'],
      ['u', 'm s**-1'],
      ['v', 'm s**-1'],
    ] as const) {
      const f = p.fields[key];
      if (
        !f ||
        !Number.isFinite(f.value) ||
        f.units !== units ||
        f.distanceKm > 25 ||
        !Number.isFinite(f.distanceKm)
      )
        throw Error('Invalid GFS field');
    }
    if (
      p.fields.temperature.value < 193.15 ||
      p.fields.temperature.value > 343.15 ||
      p.fields.cloud.value < 0 ||
      p.fields.cloud.value > 100 ||
      Math.abs(p.fields.u.value) > 150 ||
      Math.abs(p.fields.v.value) > 150
    )
      throw Error('Invalid GFS value');
  }
  return slotsForDay(archive.day).flatMap((slot) => {
    const midpoint = Date.parse(slot.start) + 1800000;
    const left = points.filter((p) => Date.parse(p.validAt) <= midpoint).at(-1),
      right = points.find((p) => Date.parse(p.validAt) >= midpoint);
    if (!left || !right) return [];
    const gap = Date.parse(right.validAt) - Date.parse(left.validAt);
    if (gap > 3 * 3600000) return [];
    const weight = gap ? (midpoint - Date.parse(left.validAt)) / gap : 0;
    const value = (key: keyof typeof left.fields) =>
      left.fields[key].value +
      (right.fields[key].value - left.fields[key].value) * weight;
    const clear = clearSkyIrradiance(slot.start, config),
      cloud = value('cloud');
    if (clear === null) return [];
    return [
      {
        start: slot.start,
        temperature: value('temperature') - 273.15,
        cloudCover: cloud,
        windSpeed: Math.hypot(value('u'), value('v')),
        irradiance: clear * cloudTransmission(cloud),
        clearSkyIrradiance: clear,
        irradianceKind: 'estimated-ghi' as const,
        resolutionHours: 3,
      },
    ];
  });
}

export function reconstructDay(
  archive: GfsArchive,
  readings: ForecastReading[],
  config: ForecastConfig,
) {
  const origin = backtestOrigin(archive.day);
  // Caller must additionally enforce revision.created_at < originAt in SQL.
  // Calibration excludes the target day and the unfinished origin day entirely.
  const history = productionProfile(
    readings.filter((r) => r.start < origin.originAt),
    localDate(origin.originAt),
  );
  const calibration = calibrateSolar(history.readings, history.days, config);
  const weather = gfsWeather(archive, config),
    byStart = new Map(weather.map((w) => [w.start, w]));
  const hours = slotsForDay(archive.day).map((slot) => ({
    start: slot.start,
    ...origin,
    productionKwh: byStart.has(slot.start)
      ? weatherAdjustedEnergy(byStart.get(slot.start)!, config, calibration)
      : null,
  }));
  return {
    day: {
      date: archive.day,
      historyDays: history.days,
      hours,
      productionKwh: hours.every((h) => h.productionKwh !== null)
        ? hours.reduce((s, h) => s + h.productionKwh!, 0)
        : null,
    },
    inputs: {
      weather,
      calibration,
      trainingReadings: history.readings,
      origin,
      ...config,
    },
  };
}

export function backtestScores(
  rows: { start: string; productionKwh: number | null; partial?: boolean }[],
  hours: Pick<BacktestHour, 'start' | 'productionKwh'>[],
) {
  const predictions = new Map(hours.map((h) => [h.start, h.productionKwh]));
  const pairs = rows.flatMap((r) => {
    const pred = predictions.get(r.start);
    return !r.partial &&
      r.productionKwh !== null &&
      Number.isFinite(r.productionKwh) &&
      r.productionKwh >= 0 &&
      pred != null &&
      Number.isFinite(pred) &&
      pred >= 0 &&
      (r.productionKwh > 0 || pred > 0)
      ? [{ actual: r.productionKwh, pred }]
      : [];
  });
  const total = pairs.reduce((s, p) => s + p.actual, 0),
    abs = pairs.reduce((s, p) => s + Math.abs(p.pred - p.actual), 0);
  const wapePercent = total > 0 ? (abs / total) * 100 : null;
  return {
    hours: pairs.length,
    actualKwh: pairs.length ? total : null,
    predictedKwh: pairs.length ? pairs.reduce((s, p) => s + p.pred, 0) : null,
    // A descriptive 0–100 match score, not a probability of future accuracy.
    matchPercent: wapePercent === null ? null : Math.max(0, 100 - wapePercent),
    maeKwh: pairs.length ? abs / pairs.length : null,
    rmseKwh: pairs.length
      ? Math.sqrt(
          pairs.reduce((s, p) => s + (p.pred - p.actual) ** 2, 0) /
            pairs.length,
        )
      : null,
    biasKwh: pairs.length
      ? pairs.reduce((s, p) => s + p.pred - p.actual, 0) / pairs.length
      : null,
    wapePercent,
  };
}
