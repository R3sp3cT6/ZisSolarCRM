import type { ForecastConfig } from './forecast-model';
import type { SatelliteSource } from './forecast-satellite';
export const TRIAL_VERSION = 'weather-solar-v3.3-shadow';
export type LiveObservation = {
  measuredAt: string;
  receivedAt: string;
  powerKw: number;
  totalKwh: number;
  inverters: number;
  allProducing: boolean;
};
export type TrialHour = {
  start: string;
  baselineKwh: number | null;
  iconKwh: number | null;
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
  }[];
  correction?: { factor: number; measuredAt: string; observations: number };
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
  }[];
  error?: string;
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
