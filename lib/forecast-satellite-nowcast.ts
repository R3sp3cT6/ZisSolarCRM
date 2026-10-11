import { getPosition } from 'suncalc';
import type { ForecastConfig } from './forecast-model';
import type { SatellitePoint } from './forecast-satellite';
import { weatherAdjustedEnergy, type SolarCalibration } from './forecast-solar';

export type SatelliteCorrection = {
  status: 'ready' | 'missing' | 'quality-or-stale' | 'low-sun';
  slotTimes: string[];
  observedAt?: string;
  clearSkyIndex?: number;
  stability?: number;
  scanOffsetSeconds?: number;
};
/** MSG 0° native line projected from the remapped point. LSA-207 PUM §6.2–6.3:
 * LFAC=13642337, LOFF=1857; scan delay ≈760−line/5 seconds. Approximation,
 * not a per-pixel instrument timestamp. Never substitute NetCDF row for MSG line. */
export function satelliteScanOffset(latitude: number, longitude: number) {
  const rad = Math.PI / 180,
    phi = Math.atan(0.993243 * Math.tan(latitude * rad));
  const re = 6356.7523 / Math.sqrt(1 - 0.00675701 * Math.cos(phi) ** 2);
  const r1 = 42164 - re * Math.cos(phi) * Math.cos(longitude * rad);
  const r2 = -re * Math.cos(phi) * Math.sin(longitude * rad),
    r3 = re * Math.sin(phi);
  const y = -Math.asin(r3 / Math.hypot(r1, r2, r3)) / rad;
  const line = 1857 + (y * 13642337) / 65536;
  return Math.max(0, Math.min(900, 760 - line / 5));
}
export function instantClearSky(at: number, c: ForecastConfig) {
  if (c.latitude === null || c.longitude === null || !Number.isFinite(at))
    return null;
  const elevation = getPosition(new Date(at), c.latitude, c.longitude).altitude;
  const cosine = Math.sin((elevation * Math.PI) / 180);
  return cosine > 0 ? 1098 * cosine * Math.exp(-0.059 / cosine) : 0;
}
/** Only observations actually received before issue time can affect a live run. */
export function satelliteCorrection(
  points: SatellitePoint[],
  c: ForecastConfig,
  now: Date,
): SatelliteCorrection {
  const empty: SatelliteCorrection = { status: 'missing', slotTimes: [] };
  if (c.latitude === null || c.longitude === null) return empty;
  const time = now.getTime();
  const available = [
    ...new Map(
      points
        .filter(
          (p) =>
            Number.isFinite(Date.parse(p.receivedAt)) &&
            Date.parse(p.receivedAt) <= time &&
            Number.isFinite(Date.parse(p.createdAt)) &&
            Date.parse(p.createdAt) <= Date.parse(p.receivedAt) &&
            Date.parse(p.createdAt) >= Date.parse(p.slotTime) &&
            Date.parse(p.slotTime) <= time &&
            time - Date.parse(p.slotTime) <= 60 * 60000 &&
            Math.abs(p.latitude - c.latitude!) <= 0.026 &&
            Math.abs(p.longitude - c.longitude!) <= 0.026,
        )
        .map((p) => [p.slotTime, p]),
    ).values(),
  ]
    .sort((a, b) => a.slotTime.localeCompare(b.slotTime))
    .slice(-2);
  if (available.length < 2) return empty;
  const [a, b] = available,
    gap = Date.parse(b.slotTime) - Date.parse(a.slotTime);
  if (
    gap !== 15 * 60000 ||
    time - Date.parse(b.slotTime) > 45 * 60000 ||
    available.some(
      (p) =>
        p.quality !== 'good' ||
        p.ghi === null ||
        !Number.isFinite(p.ghi) ||
        p.ghi < 0 ||
        p.ghi > 1500,
    )
  )
    return { ...empty, status: 'quality-or-stale' };
  const offset = satelliteScanOffset(b.latitude, b.longitude);
  const times = available.map((p) => Date.parse(p.slotTime) + offset * 1000);
  if (times.some((t, i) => t > time || t > Date.parse(available[i].createdAt)))
    return { ...empty, status: 'quality-or-stale' };
  const clear = times.map((t) => instantClearSky(t, c));
  if (clear.some((g) => g === null || g < 50))
    return { ...empty, status: 'low-sun' };
  const indices = available.map((p, i) => Math.min(1.5, p.ghi! / clear[i]!));
  return {
    status: 'ready',
    slotTimes: available.map((p) => p.slotTime),
    observedAt: new Date(times[1]).toISOString(),
    scanOffsetSeconds: offset,
    clearSkyIndex: 0.35 * indices[0] + 0.65 * indices[1],
    stability: Math.max(0.3, 1 - Math.abs(indices[1] - indices[0]) / 1.5),
  };
}
/** Convex radiation-informed power blend; no second cloud loss multiplier.
 * Satellite persistence loses influence with observation age and variability.
 * Fixed a priori constants: 0.75 maximum weight, 120-minute age horizon.
 * Actual five-minute Huawei power remains the strongest near-term signal. */
export function satellitePower(
  at: number,
  baseKw: number,
  weather: { temperature: number; windSpeed?: number | null },
  c: ForecastConfig,
  calibration: SolarCalibration,
  state: SatelliteCorrection,
) {
  if (
    state.status !== 'ready' ||
    state.clearSkyIndex === undefined ||
    !state.observedAt ||
    !calibration.coefficients.length
  )
    return { powerKw: baseKw, weight: 0 };
  const clear = instantClearSky(at, c);
  if (clear === null) return { powerKw: baseKw, weight: 0 };
  const age = (at - Date.parse(state.observedAt)) / 60000;
  if (age < 0) return { powerKw: baseKw, weight: 0 };
  const weight = 0.75 * Math.max(0, 1 - age / 120) * (state.stability ?? 0);
  // weatherAdjustedEnergy's one-hour AC energy is numerically average kW.
  // Move its midpoint to this integration point for the empirical solar-hour fit.
  const kw = weatherAdjustedEnergy(
    {
      start: new Date(at - 1800000).toISOString(),
      irradiance: clear * state.clearSkyIndex,
      temperature: weather.temperature,
      windSpeed: weather.windSpeed,
      cloudCover: null,
      irradianceKind: 'modeled-ghi',
      resolutionHours: 1,
    },
    c,
    calibration,
  );
  return kw === null
    ? { powerKw: baseKw, weight: 0 }
    : {
        powerKw: Math.min(
          c.acKw!,
          Math.max(0, (1 - weight) * baseKw + weight * kw),
        ),
        weight,
      };
}
