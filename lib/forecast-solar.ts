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

/** Ineichen (2008) Simplified Solis GHI, reduced to reference water=1 cm and
 * pressure=101325 Pa. Used only as a relative aerosol sensitivity, not absolute
 * site radiation. Equations/reference: pvlib.clearsky.simplified_solis.
 * The 550→700 nm conversion assumes Ångström exponent 1.3 (not observed).
 * The model's AOD700 validity range is 0–0.45; no extrapolation beyond it. */
export function solisReferenceGhi(
  elevation: number,
  aod550: number,
): number | null {
  const a = aod550 * (700 / 550) ** -1.3;
  if (!Number.isFinite(a) || a < 0 || a > 0.45 || !Number.isFinite(elevation))
    return null;
  if (elevation <= 0) return 0;
  const s = Math.sin((elevation * Math.PI) / 180);
  const enhanced = 1364 * (0.12 * a * a + 0.97 * a + 1.08);
  return (
    enhanced *
    Math.exp(
      -(1.24 * a + 0.27) / s ** (-0.3079 * a * a + 0.2846 * a + 0.3798),
    ) *
    s
  );
}

export function aerosolIrradianceFactor(
  start: string,
  c: ForecastConfig,
  aod550: number,
): number | null {
  if (!hasCoordinates(c) || !Number.isFinite(Date.parse(start))) return null;
  let actual = 0,
    reference = 0;
  for (let i = 0; i < 6; i++) {
    const elevation = getPosition(
      new Date(Date.parse(start) + (i + 0.5) * 600000),
      c.latitude!,
      c.longitude!,
    ).altitude;
    const ghi = solisReferenceGhi(elevation, aod550);
    if (ghi === null) return null;
    actual += ghi;
    reference += solisReferenceGhi(elevation, 0.1)!;
  }
  // The reference AOD550=0.1 is an explicit assumption, not historical measured AOD.
  return reference > 0 ? actual / reference : 1;
}

/** NOCT reference at 1 m/s, adjusted with the Faiman heat-transfer ratio.
 * 10 m wind → assumed 2 m module height using exponent 0.2. These are generic,
 * uncalibrated mounting assumptions, not measured module temperature or wind. */
export function cellTemperature(
  air: number,
  g: number,
  c: ForecastConfig,
  wind10m?: number | null,
) {
  const wind =
    typeof wind10m === 'number' && Number.isFinite(wind10m) && wind10m >= 0
      ? wind10m * (2 / 10) ** 0.2
      : null;
  const cooling = wind === null ? 1 : 31.84 / (25 + 6.84 * wind);
  return air + (((c.noct - 20) * g) / 800) * cooling;
}
function solarHour(start: string, c: ForecastConfig) {
  const midpoint = new Date(Date.parse(start) + 1800000);
  const noon = getTimes(midpoint, c.latitude!, c.longitude!).solarNoon;
  return 12 + (midpoint.getTime() - noon.getTime()) / 3600000;
}
function thermal(
  air: number,
  g: number,
  c: ForecastConfig,
  wind?: number | null,
) {
  return Math.max(0.1, 1 + c.gamma * (cellTemperature(air, g, c, wind) - 25));
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
    Math.min(
      c.acKw,
      ((factor * g) / 1000) * thermal(w.temperature, g, c, w.windSpeed),
    ),
  );
}
