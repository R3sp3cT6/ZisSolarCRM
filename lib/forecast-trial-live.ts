import 'server-only';
import { db } from '../db/index';
import {
  cacheRead,
  cacheWrite,
  sharedCache,
  withCacheLock,
} from './shared-cache';
import {
  makeSatelliteNowcast,
  historicalObservations,
  TRIAL_VERSION,
  type LiveObservation,
  type TrialHour,
  type TrialRun,
} from './forecast-trial';
import type { ForecastConfig } from './forecast-model';
import type { SolarCalibration } from './forecast-solar';
import type { SatellitePoint } from './forecast-satellite';
import { fetchSatellite } from './forecast-satellite-server';
import { inverterSamples, type InverterSample } from './inverter-availability';
export type TrialContext = {
  config: ForecastConfig;
  baselineId: string;
  weatherRunAt: string | null;
  hours: TrialHour[];
  issuedAt: string;
  version: string;
  calibration: SolarCalibration;
  retainedThermalHistory?: {
    start: string;
    contextIssuedAt: string;
    weather: NonNullable<TrialHour['weather']>;
  }[];
};
type Pending = {
  inverterSamples?: InverterSample[];
  observations: LiveObservation[];
  runs: { run: TrialRun; inputs: unknown }[];
  satellites?: SatellitePoint[];
};
const pendingKey = (owner: string) => 'trial-pending:' + owner;

/** Retain device evidence from existing Huawei calls, including partial device
 * coverage. Only complete, genuinely fresh historical samples may also feed the
 * short-term trial after arrival. First receipt timestamps remain unchanged. */
export async function recordHistoricalTrial(
  owner: string,
  input: unknown,
  ids: number[],
  receivedAt = new Date(),
  source: InverterSample['source'] = 'history',
) {
  if (!sharedCache()) return;
  const observations =
    source === 'history' ? historicalObservations(input, ids, receivedAt) : [];
  const devices = inverterSamples(input, ids, receivedAt, source);
  if (!observations.length && !devices.length) return;
  const queued = await withCacheLock(
    'trial-live:' + owner,
    async () => {
      const pending = (await cacheRead<Pending>(pendingKey(owner))) ?? {
        observations: [],
        runs: [],
      };
      // First arrival wins, matching the append-only SQL table. A historical
      // replay must not overwrite an original live receipt timestamp.
      const byTime = new Map(
        pending.observations.map((s) => [s.measuredAt, s]),
      );
      for (const sample of observations)
        if (!byTime.has(sample.measuredAt))
          byTime.set(sample.measuredAt, sample);
      pending.observations = [...byTime.values()].sort((a, b) =>
        a.measuredAt.localeCompare(b.measuredAt),
      );
      const deviceTimes = new Map(
        (pending.inverterSamples ?? []).map((s) => [
          s.deviceId + ':' + s.measuredAt,
          s,
        ]),
      );
      for (const sample of devices) {
        const key = sample.deviceId + ':' + sample.measuredAt;
        if (!deviceTimes.has(key)) deviceTimes.set(key, sample);
      }
      pending.inverterSamples = [...deviceTimes.values()];
      await cacheWrite(pendingKey(owner), pending);
    },
    90,
  );
  if (queued.busy) throw Error('Trial history queue busy');
  if (source === 'history')
    await recordLiveTrial(owner, observations, receivedAt);
}

/** Runs only after an existing Huawei fetch. No additional polling or SQL. */
export async function recordLiveTrial(
  owner: string,
  sample: LiveObservation | LiveObservation[] | null | undefined,
  now = new Date(),
) {
  if (!sample || !sharedCache()) return;
  const candidates = (Array.isArray(sample) ? sample : [sample]).filter((s) => {
    const measured = Date.parse(s.measuredAt),
      received = Date.parse(s.receivedAt);
    return (
      Number.isFinite(measured) &&
      Number.isFinite(received) &&
      measured <= received &&
      received <= now.getTime() &&
      now.getTime() - measured <= 15 * 60000
    );
  });
  if (!candidates.length) return;
  await withCacheLock(
    'trial-live:' + owner,
    async () => {
      const pending = (await cacheRead<Pending>(pendingKey(owner))) ?? {
        observations: [],
        runs: [],
      };
      const recent =
        (await cacheRead<LiveObservation[]>('trial-observations:' + owner)) ??
        [];
      const byTime = new Map(recent.map((s) => [s.measuredAt, s]));
      const pendingByTime = new Map(
        pending.observations.map((s) => [s.measuredAt, s]),
      );
      let added = false;
      for (const s of candidates) {
        if (byTime.has(s.measuredAt)) continue;
        // History was already queued above. Preserve its genuine first receipt,
        // and do not duplicate observations when the same batch seeds the trial.
        const first = pendingByTime.get(s.measuredAt) ?? s;
        byTime.set(s.measuredAt, first);
        pendingByTime.set(s.measuredAt, first);
        added = true;
      }
      if (!added) return;
      pending.observations = [...pendingByTime.values()];
      const samples = [...byTime.values()]
        .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
        .slice(-48);
      const context = await cacheRead<TrialContext>('trial-context:' + owner);
      if (
        context &&
        context.version === TRIAL_VERSION &&
        Date.parse(context.issuedAt) <= now.getTime() &&
        now.getTime() - Date.parse(context.issuedAt) < 18 * 3600000
      ) {
        const satellite = await fetchSatellite(context.config, now);
        pending.satellites = [
          ...new Map(
            [...(pending.satellites ?? []), ...satellite.points].map((p) => [
              p.slotTime,
              p,
            ]),
          ).values(),
        ];
        await cacheWrite('trial-satellite:' + owner, satellite, 86400);
        const run = makeSatelliteNowcast(
          context.hours,
          samples,
          context.config,
          context.baselineId,
          context.weatherRunAt,
          satellite.points,
          context.calibration,
          new Date(Math.max(now.getTime(), Date.now())),
        );
        if (run.status === 'ready')
          pending.runs.push({
            run,
            inputs: {
              context,
              satellite,
              observations: samples.slice(-2),
              method:
                'LSA SAF clear-sky-index persistence with MSG scan delay; bounded convex blend decays over 120 minutes of observation age; fresh Huawei power has priority and decays over 90 minutes; five-minute integration; no future observations; day-ahead unchanged',
            },
          });
        await cacheWrite('trial-intraday:' + owner, run, 86400);
      }
      // Persist the queue before acknowledging the observation. Retries deduplicate in SQL.
      await cacheWrite(pendingKey(owner), pending);
      await cacheWrite('trial-observations:' + owner, samples, 7 * 86400);
    },
    90,
  );
}
/** Called during an already scheduled/active archive; no new database wake-up. */
export async function flushTrialPending(owner: string) {
  if (!sharedCache()) return;
  await withCacheLock(
    'trial-live:' + owner,
    async () => {
      const pending = await cacheRead<Pending>(pendingKey(owner));
      if (
        !pending?.observations.length &&
        !pending?.runs.length &&
        !pending?.satellites?.length &&
        !pending?.inverterSamples?.length
      )
        return;
      await db()
        .prepare(`INSERT INTO forecast_observations(owner,measured_at,received_at,payload)
   SELECT ?, (value->>'measuredAt')::timestamptz,(value->>'receivedAt')::timestamptz,value FROM jsonb_array_elements(?::jsonb)
   ON CONFLICT(owner,measured_at) DO NOTHING`)
        .bind(owner, JSON.stringify(pending.observations))
        .run();
      await db()
        .prepare(`INSERT INTO forecast_trials(id,owner,run_key,issued_at,kind,model_version,payload,inputs)
   SELECT value->'run'->>'id',?,value->'run'->>'id',(value->'run'->>'issuedAt')::timestamptz,'intraday',value->'run'->>'version',value->'run',value->'inputs'
   FROM jsonb_array_elements(?::jsonb) ON CONFLICT(owner,run_key) DO NOTHING`)
        .bind(owner, JSON.stringify(pending.runs))
        .run();
      await saveSatellitePoints(owner, pending.satellites ?? []);
      if (pending.inverterSamples?.length)
        await db()
          .prepare(`INSERT INTO forecast_inverter_samples(owner,device_id,measured_at,received_at,payload)
          SELECT ?,(value->>'deviceId')::bigint,(value->>'measuredAt')::timestamptz,
          (value->>'receivedAt')::timestamptz,value FROM jsonb_array_elements(?::jsonb)
          ON CONFLICT(owner,device_id,measured_at) DO NOTHING`)
          .bind(owner, JSON.stringify(pending.inverterSamples))
          .run();
      await cacheWrite(pendingKey(owner), { observations: [], runs: [] });
    },
    45,
  );
}
export async function saveSatellitePoints(
  owner: string,
  points: SatellitePoint[],
) {
  if (!points.length) return;
  await db()
    .prepare(`INSERT INTO forecast_satellites(owner,slot_time,received_at,payload)
  SELECT ?,(value->>'slotTime')::timestamptz,(value->>'receivedAt')::timestamptz,value FROM jsonb_array_elements(?::jsonb)
  ON CONFLICT(owner,slot_time) DO NOTHING`)
    .bind(owner, JSON.stringify(points))
    .run();
}
