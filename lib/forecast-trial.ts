import type { ForecastConfig } from './forecast-model';
import type { SatelliteSource } from './forecast-satellite';
import type { SatellitePoint } from './forecast-satellite';
import type { SolarCalibration } from './forecast-solar';
import {
  satelliteCorrection,
  satellitePower,
  type SatelliteCorrection,
} from './forecast-satellite-nowcast';
export const TRIAL_VERSION = 'weather-solar-v3.4-satellite';
export type LiveObservation = {
  measuredAt: string;
  receivedAt: string;
  powerKw: number;
  totalKwh: number;
  inverters: number;
  allProducing: boolean;
  source?: 'live' | 'history';
};
export type TrialHour = {
  start: string;
  baselineKwh: number | null;
  iconKwh: number | null;
  weather?: { temperature: number; windSpeed?: number | null };
};
export type TrialRun = {
  id: string;
  issuedAt: string;
  version: string;
  kind: 'day-ahead' | 'intraday';
  configVersion: string;
  baselineId: string;
  weatherRunAt: string | null;
  status: string;
  hours: {
    start: string;
    end: string;
    baselineKwh: number | null;
    predictedKwh: number | null;
    leadMinutes: number;
    v32Kwh?: number | null;
    withoutSatelliteKwh?: number | null;
    satelliteWeight?: number;
  }[];
  correction?: { factor: number; measuredAt: string; observations: number };
  satelliteCorrection?: SatelliteCorrection;
};
export type TrialView = {
  dayAhead: TrialRun | null;
  intraday: TrialRun | null;
  icon: { status: string; runAt: string | null };
  satellite: SatelliteSource;
  scores: {
    kind: string;
    hours: number;
    baselineWape: number | null;
    candidateWape: number | null;
    v32Wape?: number | null;
    withoutSatelliteWape?: number | null;
    v32Intervals?: number;
    v32CandidateWape?: number | null;
  }[];
  error?: string;
  replay?: {
    from: string;
    to: string;
    hours: number;
    appliedHours: number;
    v32Wape: number;
    satelliteWape: number;
    daysImproved: number;
    days: number;
    lastDay: { date: string; v32Wape: number; satelliteWape: number };
  } | null;
};

/** Extract timestamps supplied by Huawei, not the time an HTTP call finished. */
export function liveObservation(
  input: unknown,
  ids: number[],
  now = new Date(),
): LiveObservation | null {
  if (
    !Array.isArray(input) ||
    !ids.length ||
    ids.length !== new Set(ids).size ||
    input.length !== ids.length
  )
    return null;
  const seen = new Set<number>();
  let total = 0,
    power = 0,
    allProducing = true;
  const times: number[] = [];
  for (const p of input) {
    if (!p || !ids.includes(p.devId) || seen.has(p.devId)) return null;
    seen.add(p.devId);
    const m = p.dataItemMap,
      t = p.collectTime;
    if (
      !Number.isSafeInteger(t) ||
      t % 300000 !== 0 ||
      t > now.getTime() ||
      now.getTime() - t > 15 * 60000 ||
      !m ||
      ![m.active_power, m.total_cap].every(
        (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
      ) ||
      m.active_power > 2000
    )
      return null;
    times.push(t);
    power += m.active_power;
    total += m.total_cap;
    allProducing &&= m.active_power > 0.1;
  }
  if (Math.max(...times) !== Math.min(...times)) return null;
  return {
    measuredAt: new Date(times[0]).toISOString(),
    receivedAt: now.toISOString(),
    powerKw: power,
    totalKwh: total,
    inverters: ids.length,
    allProducing,
  };
}

/** Historical five-minute telemetry can close evaluation gaps without new API
 * calls. The actual arrival is now; never backdate it to the measurement time. */
export function historicalObservations(
  input: unknown,
  ids: number[],
  receivedAt = new Date(),
): LiveObservation[] {
  if (!Array.isArray(input) || !Number.isFinite(receivedAt.getTime()))
    return [];
  const groups = new Map<number, unknown[]>();
  for (const row of input) {
    if (
      !row ||
      !Number.isSafeInteger(row.collectTime) ||
      row.collectTime < 0 ||
      !Number.isFinite(new Date(row.collectTime).getTime()) ||
      row.collectTime > receivedAt.getTime()
    )
      continue;
    groups.set(row.collectTime, [...(groups.get(row.collectTime) ?? []), row]);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .flatMap(([at, rows]) => {
      const sample = liveObservation(rows, ids, new Date(at));
      return sample
        ? [
            {
              ...sample,
              receivedAt: receivedAt.toISOString(),
              source: 'history' as const,
            },
          ]
        : [];
    });
}
// Hourly energy divided by one hour is average kW. Linear interpolation between
// interval midpoints is an explicit power approximation for the short-term trial.
export function trialPower(hours: TrialHour[], at: number): number | null {
  const ordered = hours
    .filter((h) => h.iconKwh !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  const left = ordered
      .filter((h) => Date.parse(h.start) + 1800000 <= at)
      .at(-1),
    right = ordered.find((h) => Date.parse(h.start) + 1800000 >= at);
  if (!left || !right) return null;
  const a = Date.parse(left.start) + 1800000,
    b = Date.parse(right.start) + 1800000;
  if (b - a > 3600000) return null;
  return (
    left.iconKwh! +
    (right.iconKwh! - left.iconKwh!) * (a === b ? 0 : (at - a) / (b - a))
  );
}
export function makeNowcast(
  hours: TrialHour[],
  observations: LiveObservation[],
  config: ForecastConfig,
  baselineId: string,
  weatherRunAt: string | null,
  now = new Date(),
): TrialRun {
  const result: TrialRun = {
    id: crypto.randomUUID(),
    issuedAt: now.toISOString(),
    version: TRIAL_VERSION,
    kind: 'intraday',
    configVersion: config.version,
    baselineId,
    weatherRunAt,
    status: 'insufficient-observations',
    hours: [],
  };
  if (
    config.acKw === null ||
    !weatherRunAt ||
    !Number.isFinite(Date.parse(weatherRunAt)) ||
    Date.parse(weatherRunAt) > now.getTime() ||
    now.getTime() - Date.parse(weatherRunAt) > 18 * 3600000
  )
    return { ...result, status: 'stale-weather' };
  const samples = [
    ...new Map(
      observations
        .filter(
          (s) =>
            Date.parse(s.receivedAt) <= now.getTime() &&
            Date.parse(s.measuredAt) <= now.getTime() &&
            now.getTime() - Date.parse(s.measuredAt) <= 15 * 60000,
        )
        .map((s) => [s.measuredAt, s]),
    ).values(),
  ]
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .slice(-2);
  if (samples.length < 2) return result;
  const [a, b] = samples,
    gap = Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
  if (now.getTime() - Date.parse(b.measuredAt) > 10 * 60000)
    return { ...result, status: 'stale-measurement' };
  if (
    gap < 300000 ||
    gap > 600000 ||
    !samples.every((s) => s.allProducing && s.inverters === b.inverters) ||
    b.totalKwh <= a.totalKwh
  )
    return { ...result, status: 'incomplete-or-stopped' };
  const expected = samples.map((s) =>
    trialPower(hours, Date.parse(s.measuredAt)),
  );
  if (expected.some((p) => p === null || p < Math.max(10, config.acKw! * 0.03)))
    return { ...result, status: 'low-sun' };
  const ratios = samples.map((s, i) => s.powerKw / expected[i]!);
  if (
    ratios.some((r) => !Number.isFinite(r) || r <= 0) ||
    Math.abs(ratios[0] - ratios[1]) > 0.6
  )
    return { ...result, status: 'unstable-measurements' };
  const factor = Math.max(0.5, Math.min(1.5, (ratios[0] + ratios[1]) / 2));
  result.correction = { factor, measuredAt: b.measuredAt, observations: 2 };
  const first = Math.ceil(now.getTime() / 900000) * 900000;
  for (let i = 0; i < 4; i++) {
    const start = first + i * 900000,
      mid = start + 450000,
      end = start + 900000;
    const power = trialPower(hours, mid);
    if (power === null) continue;
    const lead = (mid - now.getTime()) / 60000,
      weight = Math.max(0, 1 - lead / 90);
    result.hours.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      baselineKwh: power * 0.25,
      predictedKwh:
        Math.min(config.acKw, power * (1 + (factor - 1) * weight)) * 0.25,
      leadMinutes: lead,
    });
  }
  result.status = result.hours.length === 4 ? 'ready' : 'missing-weather';
  if (result.status !== 'ready') result.hours = [];
  return result;
}

/** Satellite smart persistence affects only future quarters. The existing Huawei
 * estimate is retained alongside it to measure satellite's incremental value. */
export function makeSatelliteNowcast(
  hours: TrialHour[],
  observations: LiveObservation[],
  config: ForecastConfig,
  baselineId: string,
  weatherRunAt: string | null,
  points: SatellitePoint[],
  calibration: SolarCalibration,
  now = new Date(),
): TrialRun {
  const original = makeNowcast(
    hours,
    observations,
    config,
    baselineId,
    weatherRunAt,
    now,
  );
  const state = satelliteCorrection(points, config, now);
  const result = { ...original, satelliteCorrection: state };
  // A known stopped/reset inverter is not a cloud signal. Never override that guard.
  if (['stale-weather', 'incomplete-or-stopped'].includes(original.status))
    return result;
  const hasHuawei = original.status === 'ready';
  if (!hasHuawei && state.status !== 'ready') return result;
  const first = Math.ceil(now.getTime() / 900000) * 900000;
  result.hours = [];
  for (let i = 0; i < 4; i++) {
    const start = first + i * 900000,
      end = start + 900000;
    let base = 0,
      withoutSatellite = 0,
      predicted = 0,
      v32 = 0,
      weightSum = 0,
      v32Complete = true,
      complete = true;
    for (let j = 0; j < 3; j++) {
      const at = start + (j + 0.5) * 300000,
        power = trialPower(hours, at);
      const hour = hours.find(
        (h) => Date.parse(h.start) <= at && Date.parse(h.start) + 3600000 > at,
      );
      if (power === null || !hour) {
        complete = false;
        break;
      }
      const lead = (at - now.getTime()) / 60000;
      const huaweiWeight = hasHuawei ? Math.max(0, 1 - lead / 90) : 0;
      const uncorrected =
        power * (1 + ((original.correction?.factor ?? 1) - 1) * huaweiWeight);
      const satellite = hour.weather
        ? satellitePower(at, power, hour.weather, config, calibration, state)
        : { powerKw: power, weight: 0 };
      const corrected =
        uncorrected + (1 - huaweiWeight) * (satellite.powerKw - power);
      base += power / 12;
      withoutSatellite += Math.min(config.acKw!, uncorrected) / 12;
      predicted += Math.min(config.acKw!, Math.max(0, corrected)) / 12;
      weightSum += ((1 - huaweiWeight) * satellite.weight) / 3;
      if (hour.baselineKwh === null) v32Complete = false;
      else v32 += hour.baselineKwh / 12;
    }
    if (!complete || (!hasHuawei && weightSum === 0)) continue;
    result.hours.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      baselineKwh: base,
      withoutSatelliteKwh: withoutSatellite,
      predictedKwh: predicted,
      v32Kwh: v32Complete ? v32 : null,
      satelliteWeight: weightSum,
      leadMinutes: (start + 450000 - now.getTime()) / 60000,
    });
  }
  result.status = result.hours.length === 4 ? 'ready' : 'missing-weather';
  if (result.status !== 'ready') result.hours = [];
  return result;
}
