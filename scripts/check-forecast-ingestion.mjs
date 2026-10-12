// Read-only, sanitized end-to-end check. Never print FusionSolar session state.
import fs from 'node:fs';
import { db } from '../db/index.ts';
import { cacheRead } from '../lib/shared-cache.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const [state, pending, recent, intraday] = await Promise.all(
  ['fusion:', 'trial-pending:', 'trial-observations:', 'trial-intraday:'].map(
    (prefix) => cacheRead(prefix + owner),
  ),
);
const sql = await db()
  .prepare(
    'SELECT count(*)::integer AS count,max(measured_at)::text AS "latestMeasurement",max(received_at)::text AS "latestReceipt" FROM forecast_inverter_samples WHERE owner=?',
  )
  .bind(owner)
  .first();
const observation = await db()
  .prepare(
    'SELECT count(*)::integer AS count,max(measured_at)::text AS "latestMeasurement",max(received_at)::text AS "latestReceipt" FROM forecast_observations WHERE owner=?',
  )
  .bind(owner)
  .first();
const report = {
  checkedAt: new Date().toISOString(),
  lastSuccess: state?.lastSuccess ?? null,
  lastAttempt: state?.lastAttempt ?? null,
  error: state?.error ?? null,
  historyAt: state?.historyAt ?? null,
  forecastObservation: state?.forecastObservation
    ? {
        measuredAt: state.forecastObservation.measuredAt,
        receivedAt: state.forecastObservation.receivedAt,
      }
    : null,
  pending: {
    observations: pending?.observations?.length ?? 0,
    inverterSamples: pending?.inverterSamples?.length ?? 0,
    runs: pending?.runs?.length ?? 0,
  },
  recent: {
    count: recent?.length ?? 0,
    latest: recent?.at(-1)
      ? {
          measuredAt: recent.at(-1).measuredAt,
          receivedAt: recent.at(-1).receivedAt,
        }
      : null,
  },
  intraday: {
    status: intraday?.status ?? null,
    issuedAt: intraday?.issuedAt ?? null,
    correction: intraday?.correction ?? null,
  },
  sql,
  observation,
};
fs.writeFileSync(
  'docs/huawei-fresh-history-production-followup.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
