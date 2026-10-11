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
};

async function readProspectiveComparison(
  owner: string,
): Promise<ForecastComparison> {
  try {
    // The existing shared forecast view changes on each saved run. A versioned key
    // prevents an in-flight older projection from overwriting the new comparison.
    const view = await readForecast(owner);
    if (!view.forecast) return { hours: [] };
    const revision = view.forecast.id;
    const key = `forecast-comparison:v1:${owner}:${revision}`;
    const read = async () => {
      const stored = await cacheRead<StoredComparison>(key);
      return stored?.owner === owner && stored.revision === revision
        ? stored
        : null;
    };
    const cached = await read();
    if (cached) return { hours: cached.hours };
    const result = await withCacheLock(key, async () => {
      const restored = await read();
      if (restored) return { hours: restored.hours };
      const rows = await db()
        .prepare(`
        SELECT DISTINCT ON (h.value->>'start')
          h.value->>'start' AS start,
          (h.value->>'productionKwh')::double precision AS "productionKwh",
          r.issued_at::text AS "issuedAt", r.model_version AS "modelVersion"
        FROM forecast_runs r
        CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d(value)
        CROSS JOIN LATERAL jsonb_array_elements(d.value->'hours') h(value)
        WHERE r.owner=? AND r.issued_at<=?::timestamptz
          AND h.value->>'productionSource' IN ('weather','weather-history')
          AND h.value->>'productionKwh' IS NOT NULL
          AND r.issued_at < (h.value->>'start')::timestamptz
        ORDER BY h.value->>'start', r.issued_at ASC, r.id ASC
      `)
        .bind(owner, view.forecast!.issuedAt)
        .all<ForecastComparisonHour>();
      await cacheWrite(
        key,
        { owner, revision, hours: rows.results },
        7 * 86400,
      );
      return { hours: rows.results };
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
