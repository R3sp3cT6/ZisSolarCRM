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
  TRIAL_VERSION,
  type LiveObservation,
  type TrialHour,
  type TrialRun,
} from './forecast-trial';
import type { ForecastConfig } from './forecast-model';
import type { SolarCalibration } from './forecast-solar';
import type { SatellitePoint } from './forecast-satellite';
import { fetchSatellite } from './forecast-satellite-server';
export type TrialContext = {
  config: ForecastConfig;
  baselineId: string;
  weatherRunAt: string | null;
  hours: TrialHour[];
  issuedAt: string;
  version: string;
  calibration: SolarCalibration;
};
type Pending = {
  observations: LiveObservation[];
  runs: { run: TrialRun; inputs: unknown }[];
  satellites?: SatellitePoint[];
};
const pendingKey = (owner: string) => 'trial-pending:' + owner;

/** Runs only after an existing Huawei fetch. No additional polling or SQL. */
export async function recordLiveTrial(
  owner: string,
  sample: LiveObservation | null | undefined,
  now = new Date(),
) {
  if (
    !sample ||
    !sharedCache() ||
    now.getTime() - Date.parse(sample.measuredAt) > 15 * 60000
  )
    return;
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
      if (recent.some((s) => s.measuredAt === sample.measuredAt)) return;
      pending.observations.push(sample);
      const samples = [...recent, sample]
        .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
        .slice(-48);
      const context = await cacheRead<TrialContext>('trial-context:' + owner);
      if (
        context &&
        context.version === TRIAL_VERSION &&
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
        !pending?.satellites?.length
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
