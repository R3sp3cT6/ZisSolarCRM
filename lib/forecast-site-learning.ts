import { getPosition } from 'suncalc';
import { localDate, slotsForDay } from './energy';
import type { ForecastConfig } from './forecast-model';
import { clearSkyIrradiance } from './forecast-solar';

export const SITE_LEARNING_VERSION = 'solar-site-learning-v1';
export const SITE_FEATURES = [
  'ghi',
  'previousGhi',
  'nextGhi',
  'clearSky',
  'clearSkyRatio',
  'solarAltitude',
  'sinAzimuth',
  'cosAzimuth',
  'sinHour',
  'cosHour',
  'sinSeason',
  'cosSeason',
  'dayIrradiation',
  'dayPeak',
] as const;
export type IrradianceHour = { start: string; irradiance: number };
/** All temporal/spatial features come from the same known forecast and geometry.
 * The following hour is forecast weather, never a following actual observation. */
export function siteFeatures(
  hours: IrradianceHour[],
  config: ForecastConfig,
): { start: string; clearSky: number; values: number[] }[] {
  if (config.latitude === null || config.longitude === null) return [];
  const seen = new Map<string, number>();
  for (const h of hours) {
    if (
      !Number.isFinite(Date.parse(h.start)) ||
      Date.parse(h.start) % 3600000 ||
      new Date(h.start).toISOString() !== h.start ||
      !Number.isFinite(h.irradiance) ||
      h.irradiance < 0 ||
      h.irradiance > 1800 ||
      seen.has(h.start)
    )
      throw Error('Invalid hourly site-learning weather');
    seen.set(h.start, h.irradiance);
  }
  return hours.flatMap((h) => {
    const t = Date.parse(h.start),
      clear = clearSkyIrradiance(h.start, config);
    const day = localDate(h.start),
      daily = hours.filter((r) => localDate(r.start) === day);
    // Require a complete local day, including DST's23/25hours.
    const expected = slotsForDay(day);
    if (
      daily.length !== expected.length ||
      expected.some((s) => !seen.has(s.start)) ||
      clear === null
    )
      return [];
    const solar = getPosition(
      new Date(t + 1800000),
      config.latitude!,
      config.longitude!,
    );
    const azimuth = (solar.azimuth * Math.PI) / 180;
    const hour = ((new Date(t).getUTCHours() + 0.5) * 2 * Math.PI) / 24;
    const season =
      (((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 86400000) *
        2 *
        Math.PI) /
      365.25;
    const previous = seen.get(new Date(t - 3600000).toISOString());
    const next = seen.get(new Date(t + 3600000).toISOString());
    if (clear > 0 && (previous === undefined || next === undefined)) return [];
    return [
      {
        start: h.start,
        clearSky: clear,
        values: [
          h.irradiance / 1000,
          (previous ?? 0) / 1000,
          (next ?? 0) / 1000,
          clear / 1000,
          clear > 20 ? Math.min(2, h.irradiance / clear) : 0,
          solar.altitude / 90,
          Math.sin(azimuth),
          Math.cos(azimuth),
          Math.sin(hour),
          Math.cos(hour),
          Math.sin(season),
          Math.cos(season),
          daily.reduce((s, r) => s + r.irradiance, 0) / 10000,
          Math.max(...daily.map((r) => r.irradiance)) / 1000,
        ],
      },
    ];
  });
}

export type SiteModel = {
  version: string;
  method: 'catboost' | 'ridge' | 'analog';
  trainedAt: string;
  trainingEnd: string;
  validUntil: string;
  latitude: number;
  longitude: number;
  acKw: number;
  features: string[];
  trainingHours: number;
  trainingDays: number;
  // Numerical-only portable artifacts: no pickle, eval or remote code execution.
  model: {
    bias?: number;
    scale?: number;
    trees?: {
      splits: { feature: number; border: number }[];
      leaves: number[];
    }[];
    means?: number[];
    scales?: number[];
    powers?: number[][];
    coefficients?: number[];
    intercept?: number;
    x?: number[][];
    y?: number[];
    neighbors?: number;
  };
};
export function sitePrediction(values: number[], artifact: SiteModel) {
  if (values.length !== SITE_FEATURES.length || !values.every(Number.isFinite))
    return null;
  const m = artifact.model;
  let predicted: number;
  if (artifact.method === 'catboost') {
    predicted =
      (m.scale ?? 1) *
        m.trees!.reduce((total, tree) => {
          let leaf = 0;
          tree.splits.forEach((s, i) => {
            if (Math.fround(values[s.feature]) > s.border) leaf |= 1 << i;
          });
          return total + tree.leaves[leaf];
        }, 0) +
      m.bias!;
  } else if (artifact.method === 'ridge') {
    const poly = m.powers!.map((powers) =>
      powers.reduce((p, power, i) => p * values[i] ** power, 1),
    );
    predicted =
      m.intercept! +
      poly.reduce(
        (sum, v, i) =>
          sum + ((v - m.means![i]) / m.scales![i]) * m.coefficients![i],
        0,
      );
  } else {
    const normalized = values.map((v, i) => (v - m.means![i]) / m.scales![i]);
    const nearest = m
      .x!.map((x, i) => ({
        distance: Math.sqrt(
          x.reduce((sum, v, j) => sum + (v - normalized[j]) ** 2, 0),
        ),
        y: m.y![i],
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, m.neighbors);
    const exact = nearest.filter((r) => r.distance === 0);
    predicted = exact.length
      ? exact.reduce((s, r) => s + r.y, 0) / exact.length
      : nearest.reduce((s, r) => s + r.y / r.distance, 0) /
        nearest.reduce((s, r) => s + 1 / r.distance, 0);
  }
  return Number.isFinite(predicted)
    ? Math.max(0, Math.min(artifact.acKw, predicted * artifact.acKw))
    : null;
}

/** Reject stale/wrong-site artifacts before they can influence a trial. */
export function validSiteModel(a: SiteModel, c: ForecastConfig, now: Date) {
  const finite = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v);
  const vector = (v: unknown, n: number): v is number[] =>
    Array.isArray(v) && v.length === n && v.every(finite);
  if (
    !a ||
    a.version !== SITE_LEARNING_VERSION ||
    JSON.stringify(a.features) !== JSON.stringify(SITE_FEATURES) ||
    !finite(a.latitude) ||
    !finite(a.longitude) ||
    !finite(a.acKw) ||
    c.latitude === null ||
    c.longitude === null ||
    Math.abs(a.latitude - c.latitude) > 1e-6 ||
    Math.abs(a.longitude - c.longitude) > 1e-6 ||
    a.acKw !== c.acKw ||
    a.acKw <= 0 ||
    !Number.isFinite(Date.parse(a.trainedAt)) ||
    !Number.isFinite(Date.parse(a.trainingEnd)) ||
    !Number.isFinite(Date.parse(a.validUntil)) ||
    Date.parse(a.trainedAt) > now.getTime() ||
    Date.parse(a.trainingEnd) + 3600000 > Date.parse(a.trainedAt) ||
    Date.parse(a.validUntil) <= now.getTime() ||
    Date.parse(a.validUntil) - Date.parse(a.trainedAt) > 7 * 86400000 ||
    !Number.isInteger(a.trainingHours) ||
    a.trainingHours < 120 ||
    !Number.isInteger(a.trainingDays) ||
    a.trainingDays < 10 ||
    !a.model
  )
    return false;
  const m = a.model;
  if (a.method === 'catboost')
    return (
      finite(m.bias) &&
      finite(m.scale) &&
      Array.isArray(m.trees) &&
      m.trees.length > 0 &&
      m.trees.length <= 160 &&
      m.trees.every(
        (t) =>
          Array.isArray(t.splits) &&
          t.splits.length <= 4 &&
          t.splits.every(
            (s) =>
              Number.isInteger(s.feature) &&
              s.feature >= 0 &&
              s.feature < SITE_FEATURES.length &&
              finite(s.border),
          ) &&
          vector(t.leaves, 2 ** t.splits.length),
      )
    );
  if (a.method === 'ridge') {
    const n = m.powers?.length ?? 0;
    return (
      n > 0 &&
      n <= 200 &&
      m.powers!.every(
        (p) =>
          vector(p, SITE_FEATURES.length) &&
          p.every((v) => Number.isInteger(v) && v >= 0) &&
          p.reduce((s, v) => s + v, 0) <= 2,
      ) &&
      vector(m.means, n) &&
      vector(m.scales, n) &&
      m.scales.every((s) => s > 0) &&
      vector(m.coefficients, n) &&
      finite(m.intercept)
    );
  }
  if (a.method === 'analog')
    return (
      vector(m.means, SITE_FEATURES.length) &&
      vector(m.scales, SITE_FEATURES.length) &&
      m.scales.every((s) => s > 0) &&
      Array.isArray(m.x) &&
      m.x.length >= 20 &&
      m.x.length <= 1100 &&
      m.x.every((x) => vector(x, SITE_FEATURES.length)) &&
      vector(m.y, m.x.length) &&
      m.neighbors === 20
    );
  return false;
}

export function siteForecast(
  hours: IrradianceHour[],
  config: ForecastConfig,
  artifact: SiteModel,
  now = new Date(),
) {
  if (!validSiteModel(artifact, config, now)) return [];
  const features = siteFeatures(hours, config);
  // No partial day sum disguised as a complete forecast.
  if (features.length !== hours.length || !features.length) return [];
  return features.map((h) => ({
    start: h.start,
    productionKwh: h.clearSky === 0 ? 0 : sitePrediction(h.values, artifact),
  }));
}
