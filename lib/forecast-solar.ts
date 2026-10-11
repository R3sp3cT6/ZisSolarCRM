import { getPosition, getTimes } from 'suncalc';
import type {
  ForecastConfig,
  ForecastReading,
  WeatherHour,
} from './forecast-model';

export function hasCoordinates(c: ForecastConfig) {
  return (
    typeof c.latitude === 'number' &&
    Number.isFinite(c.latitude) &&
    Math.abs(c.latitude) <= 90 &&
    typeof c.longitude === 'number' &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.longitude) <= 180
  );
}

/** Haurwitz clear-sky GHI. Six midpoint samples integrate sunrise/sunset within the UTC hour.
 * This is estimated horizontal irradiance, never measured radiation or panel-plane GTI. */
export function clearSkyIrradiance(
  start: string,
  c: ForecastConfig,
): number | null {
  if (!hasCoordinates(c) || !Number.isFinite(Date.parse(start))) return null;
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const sun = getPosition(
      new Date(Date.parse(start) + (i + 0.5) * 600000),
      c.latitude!,
      c.longitude!,
    );
    // SunCalc 2 returns degrees (v1 returned radians).
    const cosine = Math.sin((sun.altitude * Math.PI) / 180);
    if (cosine > 0) sum += 1098 * cosine * Math.exp(-0.059 / cosine);
  }
  return sum / 6;
}

/** Kasten–Czeplak (1980). Cloud fraction is not optical depth; this is a rough
 * irradiance estimate and is kept distinct from provider-supplied GTI. */
export function cloudTransmission(cloud: number) {
  return 1 - 0.75 * (Math.max(0, Math.min(100, cloud)) / 100) ** 3.4;
}
function solarHour(start: string, c: ForecastConfig) {
  const midpoint = new Date(Date.parse(start) + 1800000);
  const noon = getTimes(midpoint, c.latitude!, c.longitude!).solarNoon;
  return 12 + (midpoint.getTime() - noon.getTime()) / 3600000;
}
function thermal(air: number, g: number, c: ForecastConfig) {
  return Math.max(0.1, 1 + c.gamma * (air + ((c.noct - 20) * g) / 800 - 25));
}
const quantile90 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * 0.9;
  const low = Math.floor(position),
    high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};
export type SolarCalibration = {
  samples: number;
  days: number;
  coefficients: { hour: number; factor: number }[];
};

/** Empirical upper envelope from completed historical days only. The coefficients
 * absorb panel geometry and losses; they are NOT installed DC kWp. Historical air
 * temperature is unavailable, so the reference air temperature is explicitly 20°C. */
export function calibrateSolar(
  readings: ForecastReading[],
  days: number,
  c: ForecastConfig,
): SolarCalibration {
  const empty = { samples: 0, days, coefficients: [] };
  if (!hasCoordinates(c) || days < 7 || c.acKw === null) return empty;
  const bins = new Map<number, number[]>();
  let samples = 0;
  for (const r of readings) {
    const g = clearSkyIrradiance(r.start, c)!;
    if (
      g < 50 ||
      r.production_kwh === null ||
      !Number.isFinite(r.production_kwh) ||
      r.production_kwh <= 0
    )
      continue;
    const h = Math.round(solarHour(r.start, c));
    const coefficient = r.production_kwh / ((g / 1000) * thermal(20, g, c));
    bins.set(h, [...(bins.get(h) ?? []), coefficient]);
    samples++;
  }
  const coefficients = [...bins]
    .filter(([, values]) => values.length >= 5)
    .map(([hour, values]) => ({ hour, factor: quantile90(values) }))
    .sort((a, b) => a.hour - b.hour);
  return {
    samples,
    days,
    coefficients: coefficients.length >= 5 ? coefficients : [],
  };
}

export function weatherAdjustedEnergy(
  w: WeatherHour,
  c: ForecastConfig,
  calibration: SolarCalibration,
): number | null {
  if (
    !hasCoordinates(c) ||
    !calibration.coefficients.length ||
    c.acKw === null ||
    !Number.isFinite(w.irradiance) ||
    !Number.isFinite(w.temperature)
  )
    return null;
  const g = Math.max(0, w.irradiance);
  if (g === 0) return 0;
  const h = solarHour(w.start, c),
    points = calibration.coefficients;
  const left = points.filter((p) => p.hour <= h).at(-1) ?? points[0];
  const right = points.find((p) => p.hour >= h) ?? points.at(-1)!;
  const fraction =
    right.hour === left.hour ? 0 : (h - left.hour) / (right.hour - left.hour);
  const factor = left.factor + fraction * (right.factor - left.factor);
  // Already fitted to AC production: do not apply system/inverter losses a second time.
  return Math.max(
    0,
    Math.min(c.acKw, ((factor * g) / 1000) * thermal(w.temperature, g, c)),
  );
}
