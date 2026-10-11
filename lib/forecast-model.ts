import {
  CONTRACT,
  localDate,
  localHour,
  slotsForDay,
  salePrice,
} from './energy';

export const FORECAST_VERSION = 'baseline-pvwatts-v1';
export type ForecastConfig = {
  latitude: number | null;
  longitude: number | null;
  dcKwp: number | null;
  acKw: number | null;
  tilt: number | null;
  azimuth: number | null;
  lossPercent: number;
  gamma: number;
  noct: number;
  inverterEfficiency: number;
  version: string;
};
export type ForecastPrice = {
  start: string;
  eur_cents: number;
  fetched_at: string;
};
export type ForecastReading = {
  start: string;
  production_kwh: number | null;
  export_kwh: number | null;
};
export type WeatherHour = {
  start: string;
  irradiance: number;
  temperature: number;
  cloudCover: number | null;
};
export type ForecastHour = {
  start: string;
  end: string;
  memo: number | null;
  priceSource: 'official' | 'forecast' | 'missing';
  productionKwh: number | null;
  exportKwh: number | null;
  revenueEur: number | null;
  productionSource: 'weather' | 'history' | 'missing';
};
export type ForecastDay = {
  date: string;
  hours: ForecastHour[];
  productionKwh: number | null;
  exportKwh: number | null;
  revenueEur: number | null;
  meanPrice: number | null;
  capturePrice: number | null;
  officialHours: number;
  negativeSaleHours: number;
  complete: boolean;
};
export type ForecastScore = {
  lead: number;
  hours: number;
  days: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  dailyMeanMae: number | null;
};
export type ForecastPayload = {
  id: string;
  issuedAt: string;
  version: string;
  contract: typeof CONTRACT;
  config: ForecastConfig;
  days: ForecastDay[];
  priceScores: ForecastScore[];
  historyDays: number;
  exportRatio: number | null;
  weather: {
    status: 'ready' | 'unconfigured' | 'missing-settings' | 'failed';
    fetchedAt: string | null;
    hours: number;
  };
  history: {
    priceHours: number;
    readingHours: number;
    latestReading: string | null;
  };
  liveScore: { hours: number; mae: number | null };
  warnings: string[];
};
export const addDays = (day: string, amount: number) =>
  new Date(Date.parse(day + 'T12:00:00Z') + amount * 86400000)
    .toISOString()
    .slice(0, 10);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  return (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2;
};
export function defaultForecastConfig(): ForecastConfig {
  return {
    latitude: null,
    longitude: null,
    dcKwp: null,
    acKw: null,
    tilt: null,
    azimuth: null,
    lossPercent: 14,
    gamma: -0.004,
    noct: 45,
    inverterEfficiency: 0.96,
    version: 'unconfigured',
  };
}
export function validateForecastConfig(
  input: Record<string, unknown>,
): ForecastConfig {
  const bounds: Record<string, [number, number, boolean]> = {
    latitude: [-90, 90, true],
    longitude: [-180, 180, true],
    dcKwp: [0.1, 1000000, true],
    acKw: [0.1, 1000000, true],
    tilt: [0, 90, true],
    azimuth: [-180, 180, true],
    lossPercent: [0, 50, false],
    gamma: [-0.01, 0, false],
    noct: [20, 70, false],
    inverterEfficiency: [0.5, 1, false],
  };
  const out: Record<string, number | null> = {};
  for (const [key, [min, max, nullable]] of Object.entries(bounds)) {
    const v = input[key];
    if (v === null && nullable) {
      out[key] = null;
      continue;
    }
    if (!finite(v) || v < min || v > max)
      throw Error('Невалидни параметри на централата: ' + key);
    out[key] = v;
  }
  return { ...out, version: crypto.randomUUID() } as ForecastConfig;
}
export function weatherConfigured(c: ForecastConfig) {
  return [c.latitude, c.longitude, c.dcKwp, c.acKw, c.tilt, c.azimuth].every(
    finite,
  );
}
export function pvEnergy(weather: WeatherHour, config: ForecastConfig) {
  if (!weatherConfigured(config)) return null;
  const g = Math.max(0, weather.irradiance);
  // Hour-average GTI in W/m²; NOCT cell-temperature approximation, then PVWatts DC.
  const cell = weather.temperature + ((config.noct - 20) * g) / 800;
  const dc =
    ((config.dcKwp! * g) / 1000) * Math.max(0, 1 + config.gamma * (cell - 25));
  const ac = Math.min(
    config.acKw!,
    dc * (1 - config.lossPercent / 100) * config.inverterEfficiency,
  );
  return Math.max(0, ac); // one-hour interval: kW × 1 h = kWh
}
type PriceIndex = Map<string, Map<number, number>>;
function priceIndex(prices: ForecastPrice[]): PriceIndex {
  const buckets = new Map<string, Map<number, number[]>>();
  for (const p of prices) {
    if (!finite(p.eur_cents)) continue;
    const day = localDate(p.start),
      hour = localHour(p.start);
    const row = buckets.get(day) ?? new Map<number, number[]>();
    row.set(hour, [...(row.get(hour) ?? []), p.eur_cents / 100]);
    buckets.set(day, row);
  }
  return new Map(
    [...buckets].map(([d, row]) => [
      d,
      new Map([...row].map(([h, v]) => [h, mean(v)!])),
    ]),
  );
}
/** Fixed benchmark: last available delivery day + last available matching weekday.
 * origin is an information cutoff, never the forecast target. No recursive future labels. */
export function predictPrice(
  index: PriceIndex,
  target: string,
  hour: number,
  origin: string,
): number | null {
  let recent: number | undefined;
  for (let lag = 0; lag < 7; lag++) {
    recent = index.get(addDays(origin, -lag))?.get(hour);
    if (recent !== undefined) break;
  }
  let weeklyDay = addDays(target, -7);
  while (weeklyDay > origin) weeklyDay = addDays(weeklyDay, -7);
  let weekly: number | undefined;
  for (let lag = 0; lag < 4; lag++) {
    weekly = index.get(addDays(weeklyDay, -lag * 7))?.get(hour);
    if (weekly !== undefined) break;
  }
  return recent === undefined || weekly === undefined
    ? null
    : (recent + weekly) / 2;
}
export function priceBacktest(
  prices: ForecastPrice[],
  today: string,
): ForecastScore[] {
  const index = priceIndex(prices.filter((p) => localDate(p.start) < today)),
    actuals = new Map(prices.map((p) => [p.start, p.eur_cents / 100])),
    days = [...index.keys()].filter((d) => d >= addDays(today, -56)).sort();
  return Array.from({ length: 7 }, (_, i) => {
    const lead = i + 1,
      errors: number[] = [],
      daily: number[] = [];
    for (const day of days) {
      const origin = addDays(day, -lead),
        es: number[] = [];
      for (const slot of slotsForDay(day)) {
        const actual = actuals.get(slot.start),
          pred = predictPrice(index, day, slot.hour, origin);
        if (actual !== undefined && pred !== null) es.push(pred - actual);
      }
      if (es.length !== slotsForDay(day).length) continue;
      errors.push(...es);
      daily.push(Math.abs(mean(es)!));
    }
    return {
      lead,
      hours: errors.length,
      days: daily.length,
      mae: mean(errors.map(Math.abs)),
      rmse: errors.length ? Math.sqrt(mean(errors.map((e) => e * e))!) : null,
      bias: mean(errors),
      dailyMeanMae: mean(daily),
    };
  });
}
export function productionProfile(readings: ForecastReading[], today: string) {
  const byStart = new Map(
    readings
      .filter((r) => r.start < slotsForDay(today)[0].start)
      .map((r) => [r.start, r]),
  );
  const complete: ForecastReading[][] = [];
  for (let lag = 1; lag <= 45 && complete.length < 14; lag++) {
    const slots = slotsForDay(addDays(today, -lag)),
      rows = slots.map((s) => byStart.get(s.start));
    if (
      rows.every(
        (r): r is ForecastReading =>
          !!r && finite(r.production_kwh) && r.production_kwh >= 0,
      )
    )
      complete.push(rows);
  }
  const profile = new Map<number, number>();
  if (complete.length >= 7)
    for (let h = 0; h < 24; h++) {
      const values = complete.flatMap((rows) =>
        rows
          .filter((r) => localHour(r.start) === h)
          .map((r) => r.production_kwh!),
      );
      const v = median(values);
      if (v !== null) profile.set(h, v);
    }
  const ratios = complete
    .filter((rows) =>
      rows.every((r) => finite(r.export_kwh) && r.export_kwh >= 0),
    )
    .map((rows) => {
      const production = rows.reduce((a, r) => a + r.production_kwh!, 0);
      return production > 0
        ? rows.reduce((a, r) => a + r.export_kwh!, 0) / production
        : null;
    })
    .filter((r): r is number => r !== null && r >= 0 && r <= 1.1);
  const ratio = ratios.length >= 7 ? Math.min(1, median(ratios)!) : null;
  return { profile, days: complete.length, ratio };
}
export function aggregateForecast(
  date: string,
  hours: ForecastHour[],
): ForecastDay {
  const sum = (key: 'productionKwh' | 'exportKwh' | 'revenueEur') =>
    hours.length && hours.every((h) => h[key] !== null)
      ? hours.reduce((a, h) => a + h[key]!, 0)
      : null;
  const productionKwh = sum('productionKwh'),
    exportKwh = sum('exportKwh'),
    revenueEur = sum('revenueEur');
  const meanPrice = hours.every((h) => h.memo !== null)
    ? mean(hours.map((h) => h.memo!))
    : null;
  const capturePrice =
    exportKwh !== null && exportKwh > 0 && hours.every((h) => h.memo !== null)
      ? hours.reduce((a, h) => a + h.memo! * h.exportKwh!, 0) / exportKwh
      : null;
  return {
    date,
    hours,
    productionKwh,
    exportKwh,
    revenueEur,
    meanPrice,
    capturePrice,
    officialHours: hours.filter((h) => h.priceSource === 'official').length,
    negativeSaleHours: hours.filter(
      (h) => h.memo !== null && salePrice(h.memo) < 0,
    ).length,
    complete: hours.length === slotsForDay(date).length && revenueEur !== null,
  };
}
export function makeForecast(input: {
  prices: ForecastPrice[];
  readings: ForecastReading[];
  config: ForecastConfig;
  weather: WeatherHour[];
  now: Date;
}) {
  const { config, now } = input,
    today = localDate(now),
    issuedAt = now.toISOString();
  const prices = input.prices.filter((p) => p.fetched_at <= issuedAt),
    official = new Map(prices.map((p) => [p.start, p]));
  const index = priceIndex(prices.filter((p) => localDate(p.start) <= today)),
    history = productionProfile(input.readings, today),
    weather = new Map(input.weather.map((w) => [w.start, w]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i + 1);
    const hours = slotsForDay(date).map((slot): ForecastHour => {
      const known = official.get(slot.start),
        memo = known
          ? known.eur_cents / 100
          : predictPrice(index, date, slot.hour, today);
      const w = weather.get(slot.start),
        physical = w ? pvEnergy(w, config) : null;
      const productionKwh = physical ?? history.profile.get(slot.hour) ?? null,
        exportKwh =
          productionKwh !== null && history.ratio !== null
            ? productionKwh * history.ratio
            : null;
      return {
        ...slot,
        memo,
        priceSource: known
          ? 'official'
          : memo !== null
            ? 'forecast'
            : 'missing',
        productionKwh,
        exportKwh,
        revenueEur:
          exportKwh !== null && memo !== null
            ? (exportKwh / 1000) * salePrice(memo)
            : null,
        productionSource:
          physical !== null
            ? 'weather'
            : productionKwh !== null
              ? 'history'
              : 'missing',
      };
    });
    return aggregateForecast(date, hours);
  });
  return {
    days,
    historyDays: history.days,
    exportRatio: history.ratio,
    priceScores: priceBacktest(prices, today),
  };
}
