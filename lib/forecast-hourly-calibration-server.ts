import 'server-only';
import { db } from '../db/index';
import { localDate } from './energy';
import type { ForecastConfig } from './forecast-model';
import type { BacktestPayload } from './forecast-backtest';
import {
  calibrateHourly,
  emptyHourlyCalibration,
  type CalibrationPrediction,
  type CalibrationRevision,
} from './forecast-hourly-calibration';

/** Executed only by the existing forecast refresh/cron. No page-load SQL or
 * extra polling. Save these exact inputs beside each immutable forecast run. */
export async function loadHourlyCalibration(
  owner: string,
  config: ForecastConfig,
  now: Date,
) {
  try {
    const from = new Date(now.getTime() - 30 * 86400000).toISOString();
    const [prospective, archived, measured] = await Promise.all([
      db()
        .prepare(`SELECT DISTINCT ON (h.value->>'start')
 h.value->>'start' AS start,
 COALESCE(h.value->>'baseProductionKwh',h.value->>'productionKwh')::double precision AS "baseKwh",
 r.issued_at AS "originAt",'prospective'::text AS source
 FROM forecast_runs r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d(value)
 CROSS JOIN LATERAL jsonb_array_elements(d.value->'hours') h(value)
 WHERE r.owner=? AND r.model_version IN ('weather-solar-v3.1','weather-solar-v3.2')
 AND r.payload->'config'->>'version'=? AND r.issued_at>=?::timestamptz-interval '2 days'
 AND (h.value->>'start')::timestamptz>=? AND (h.value->>'start')::timestamptz<?
 AND h.value->'weather'->>'irradianceKind'='modeled-ghi'
 AND h.value->>'productionSource'='weather-history'
 AND ((h.value->>'start')::timestamptz AT TIME ZONE 'Europe/Skopje')::date =
     (r.issued_at AT TIME ZONE 'Europe/Skopje')::date+1
 ORDER BY h.value->>'start',r.issued_at ASC,r.id ASC`)
        .bind(owner, config.version, from, from, localDate(now))
        .all<CalibrationPrediction>(),
      db()
        .prepare(`SELECT payload FROM forecast_backtests WHERE owner=?
 AND model_version='weather-solar-v3.1-gfs-dswrf-replay-v1'
 AND inputs->'config'->>'version'=? ORDER BY created_at DESC,id DESC LIMIT 1`)
        .bind(owner, config.version)
        .first<{ payload: BacktestPayload }>(),
      db()
        .prepare(`SELECT start,(payload::jsonb->>'productionKwh')::double precision AS "productionKwh",
 created_at AS "observedAt" FROM reading_revisions
 WHERE owner=? AND start>=? AND start<? AND created_at<?
 ORDER BY start,created_at ASC,id ASC`)
        .bind(owner, from, localDate(now), now.toISOString())
        .all<CalibrationRevision>(),
    ]);
    const historical: CalibrationPrediction[] = (
      archived?.payload.days ?? []
    ).flatMap((d) =>
      d.hours.flatMap((h) =>
        h.productionKwh !== null
          ? [
              {
                start: h.start,
                baseKwh: h.productionKwh,
                originAt: h.originAt,
                source: 'historical' as const,
              },
            ]
          : [],
      ),
    );
    const predictions = [...historical, ...prospective.results];
    const revisions = measured.results;
    return {
      calibration: calibrateHourly(
        predictions,
        revisions,
        now,
        config.acKw ?? Infinity,
      ),
      inputs: {
        baselineReplayId: archived?.payload.id ?? null,
        predictions,
        revisions,
      },
    };
  } catch {
    // Calibration is optional; a missing revision archive must not block weather forecasts.
    return {
      calibration: {
        ...emptyHourlyCalibration(now),
        status: 'unavailable' as const,
      },
      inputs: null,
    };
  }
}
