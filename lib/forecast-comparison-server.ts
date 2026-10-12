import 'server-only';
import { db } from '../db/index';
import { readForecast } from './forecast-server';
import { readBacktest } from './forecast-backtest-server';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import type {
  ForecastComparison,
  ForecastComparisonHour,
} from './forecast-comparison';

type StoredComparison = {
  owner: string;
  revision: string;
  hours: ForecastComparisonHour[];
  dayAheadHours: ForecastComparisonHour[];
};

// One snapshot per delivery day, selected before inspecting its hourly values.
// A missing hour in that snapshot must not be replaced by an older/better run.
export const COMPARISON_SQL = `
  WITH runs AS (
    SELECT * FROM forecast_runs WHERE owner=? AND issued_at<=?::timestamptz
  ), day_snapshots AS (
    SELECT DISTINCT ON (d.value->>'date')
      d.value AS day, r.issued_at, r.model_version, r.id
    FROM runs r
    CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d(value)
    WHERE (r.issued_at AT TIME ZONE 'Europe/Skopje')::date =
          (d.value->>'date')::date - 1
      AND r.issued_at <= (((d.value->>'date')::date - 1 + interval '18 hours') AT TIME ZONE 'UTC')
    ORDER BY d.value->>'date', r.issued_at DESC, r.id ASC
  ), first_hours AS (
    SELECT DISTINCT ON (h.value->>'start')
      h.value->>'start' AS start,
      (h.value->>'productionKwh')::double precision AS "productionKwh",
      r.issued_at::text AS "issuedAt", r.model_version AS "modelVersion"
    FROM runs r
    CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d(value)
    CROSS JOIN LATERAL jsonb_array_elements(d.value->'hours') h(value)
    WHERE h.value->>'productionSource' IN ('weather','weather-history')
      AND h.value->>'productionKwh' IS NOT NULL
      AND r.issued_at < (h.value->>'start')::timestamptz
    ORDER BY h.value->>'start', r.issued_at ASC, r.id ASC
  )
  SELECT *, 'first' AS cohort FROM first_hours
  UNION ALL
  SELECT h.value->>'start',
    (h.value->>'productionKwh')::double precision,
    s.issued_at::text, s.model_version, 'day-ahead' AS cohort
  FROM day_snapshots s
  CROSS JOIN LATERAL jsonb_array_elements(s.day->'hours') h(value)
  WHERE h.value->>'productionSource' IN ('weather','weather-history')
    AND h.value->>'productionKwh' IS NOT NULL
    AND ((h.value->>'start')::timestamptz AT TIME ZONE 'Europe/Skopje')::date =
        (s.day->>'date')::date
`;

async function readProspectiveComparison(
  owner: string,
): Promise<ForecastComparison> {
  try {
    // The existing shared forecast view changes on each saved run. A versioned key
    // prevents an in-flight older projection from overwriting the new comparison.
    const view = await readForecast(owner);
    if (!view.forecast) return { hours: [], dayAheadHours: [] };
    const revision = view.forecast.id;
    const key = `forecast-comparison:v2:${owner}:${revision}`;
    const read = async () => {
      const stored = await cacheRead<StoredComparison>(key);
      return stored?.owner === owner && stored.revision === revision
        ? stored
        : null;
    };
    const cached = await read();
    if (cached)
      return { hours: cached.hours, dayAheadHours: cached.dayAheadHours };
    const result = await withCacheLock(key, async () => {
      const restored = await read();
      if (restored)
        return { hours: restored.hours, dayAheadHours: restored.dayAheadHours };
      const rows = await db()
        .prepare(COMPARISON_SQL)
        .bind(owner, view.forecast!.issuedAt)
        .all<ForecastComparisonHour & { cohort: 'first' | 'day-ahead' }>();
      const result = {
        hours: rows.results
          .filter((h) => h.cohort === 'first')
          .map(({ cohort: _, ...h }) => h),
        dayAheadHours: rows.results
          .filter((h) => h.cohort === 'day-ahead')
          .map(({ cohort: _, ...h }) => h),
      };
      await cacheWrite(key, { owner, revision, ...result }, 7 * 86400);
      return result;
    });
    return result.busy ? { hours: [], unavailable: true } : result.value;
  } catch {
    // Keep the measured chart available if forecast storage is temporarily offline.
    return { hours: [], unavailable: true };
  }
}

export async function readForecastComparison(
  owner: string,
): Promise<ForecastComparison> {
  const [prospective, backtest] = await Promise.allSettled([
    readProspectiveComparison(owner),
    readBacktest(owner),
  ]);
  const result =
    prospective.status === 'fulfilled'
      ? prospective.value
      : { hours: [], unavailable: true };
  return {
    ...result,
    ...(backtest.status === 'fulfilled' && backtest.value
      ? { backtest: backtest.value }
      : {}),
    ...(backtest.status === 'rejected' ? { unavailable: true } : {}),
  };
}
