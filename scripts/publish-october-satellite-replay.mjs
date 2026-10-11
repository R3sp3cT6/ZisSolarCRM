// Append an audited historical chart projection. Never edits forecast_runs or measurements.
// --test writes only to the existing isolated validation branch and disables Redis.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import {
  satelliteReplay,
  SATELLITE_REPLAY_VERSION,
} from '../lib/forecast-satellite-replay.ts';
import { attachForecastComparison } from '../lib/forecast-comparison.ts';
import { buildDashboard } from '../lib/dashboard.ts';
import { slotsForDay } from '../lib/energy.ts';
import { cacheWrite } from '../lib/shared-cache.ts';
import { backtestKey } from '../lib/forecast-backtest-server.ts';

const test = process.argv.includes('--test');
assert.ok(
  test || process.argv.includes('--publish'),
  'Use --test or --publish',
);
const evaluationId = 'satellite-csi-v1-7ed68a9409bc354df08b';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const evaluation = await db()
  .prepare(
    'SELECT payload,inputs FROM forecast_evaluations WHERE id=? AND owner=?',
  )
  .bind(evaluationId, owner)
  .first();
assert.equal(evaluation.payload.model, SATELLITE_REPLAY_VERSION);
assert.equal(evaluation.payload.from, '2026-10-01');
assert.equal(evaluation.payload.to, '2026-10-11');
const hash = createHash('sha256')
  .update(JSON.stringify(evaluation))
  .digest('hex');
if (test) {
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = 'ep-dawn-heart-b1rdaxm1.c-5.eu-central-1.aws.neon.tech';
  process.env.DATABASE_URL = url.toString();
  for (const name of [
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ])
    process.env[name] = '';
}
const fingerprint = async () =>
  db()
    .prepare(`SELECT
 (SELECT md5(string_agg(row_to_json(r)::text,',' ORDER BY start)) FROM readings r WHERE owner=?) AS readings,
 (SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY start)) FROM prices p) AS prices,
 (SELECT md5(string_agg(row_to_json(f)::text,',' ORDER BY id)) FROM forecast_runs f WHERE owner=?) AS forecasts,
 (SELECT md5(string_agg(row_to_json(b)::text,',' ORDER BY id)) FROM forecast_backtests b WHERE owner=? AND model_version<>?) AS previous_backtests`)
    .bind(owner, owner, owner, SATELLITE_REPLAY_VERSION)
    .first();
const before = await fingerprint();
const id = 'october-satellite-chart-v1-' + hash.slice(0, 20);
const previous = await db()
  .prepare('SELECT payload FROM forecast_backtests WHERE owner=? AND id=?')
  .bind(owner, id)
  .first();
const payload = satelliteReplay(evaluation.inputs, {
  id,
  evaluationId,
  createdAt: previous?.payload.createdAt ?? new Date().toISOString(),
});
assert.equal(payload.days.length, 11);
const projected = new Map(
  payload.days.flatMap((d) => d.hours).map((h) => [h.start, h]),
);
for (const r of evaluation.payload.rows) {
  assert.ok(
    Math.abs(projected.get(r.start).productionKwh - r.predictedKwh) < 1e-9,
    r.start,
  );
  assert.ok(
    Math.abs(projected.get(r.start).baselineKwh - r.baselineKwh) < 1e-9,
    r.start,
  );
  assert.ok(
    Math.abs(projected.get(r.start).satelliteWeight - r.satelliteWeight) < 1e-9,
    r.start,
  );
}
const snapshot = {
  owner,
  plant: null,
  readings: evaluation.inputs.actual.map((r) => ({
    start: r.start,
    production_kwh: r.productionKwh,
    export_kwh: null,
    power_kw: null,
  })),
  prices: [],
  reports: [],
  syncs: [],
  fusionState: {},
  configured: false,
  savedAt: '',
};
const days = payload.days.map((day) => {
  assert.deepEqual(
    day.hours.map((h) => h.start),
    slotsForDay(day.date).map((h) => h.start),
  );
  assert.ok(
    day.hours.every(
      (h) => Number.isFinite(h.productionKwh) && h.productionKwh >= 0,
    ),
  );
  const base = buildDashboard(snapshot, day.date, 'day');
  base.generatedAt = payload.createdAt;
  const view = attachForecastComparison(base, { hours: [], backtest: payload });
  const score = view.forecastComparison.backtestScore;
  const audited = evaluation.payload.days.find(
    (d) => d.date === day.date,
  ).satellite;
  assert.ok(Math.abs(score.wapePercent - audited.wapePercent) < 1e-9);
  assert.equal(
    view.chart.filter((h) => h.forecastProductionKwh !== null).length,
    24,
  );
  assert.deepEqual(view.totals, base.totals);
  return {
    date: day.date,
    hours: score.hours,
    predictedMwh: score.predictedKwh / 1000,
    actualMwh: score.actualKwh / 1000,
    wape: score.wapePercent,
    score: score.matchPercent,
  };
});
const month = attachForecastComparison(
  buildDashboard(snapshot, '2026-10-01', 'month'),
  { hours: [], backtest: payload },
);
assert.equal(
  month.chart.filter((h) => h.forecastProductionKwh !== null).length,
  11,
);
assert.ok(
  month.chart
    .filter((h) => h.key > '2026-10-11')
    .every((h) => h.forecastProductionKwh === null),
);
const inputs = {
  evaluationId,
  evaluationSha256: hash,
  baselineReplayId: evaluation.inputs.replay.payload.id,
  method: evaluation.payload.method,
  limitations: evaluation.payload.limitations,
  projection:
    'Complete source hours; same fixed archived satellite experiment; target actuals only for scoring.',
};
await db()
  .prepare(
    'INSERT INTO forecast_backtests(id,owner,created_at,period_from,period_to,model_version,payload,inputs) VALUES (?,?,?::timestamptz,?::date,?::date,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    payload.createdAt,
    payload.fromDate,
    payload.toDate,
    payload.modelVersion,
    JSON.stringify(payload),
    JSON.stringify(inputs),
  )
  .run();
const saved = await db()
  .prepare(
    'SELECT payload,inputs FROM forecast_backtests WHERE id=? AND owner=?',
  )
  .bind(id, owner)
  .first();
assert.deepEqual(saved.payload, payload);
assert.deepEqual(saved.inputs, inputs);
assert.deepEqual(
  await fingerprint(),
  before,
  'Measurements, prices or existing forecasts changed during publication',
);
if (!test)
  await cacheWrite(backtestKey(owner), { owner, backtest: payload }, 7 * 86400);
const receipt = {
  checkedAt: new Date().toISOString(),
  environment: test ? 'isolated-test-branch' : 'production',
  id,
  evaluationId,
  exactSqlReadback: true,
  originalsUnchanged: true,
  chartHours: projected.size,
  days,
  monthWape: month.forecastComparison.backtestScore.wapePercent,
};
fs.writeFileSync(
  `docs/october-satellite-chart-${test ? 'test' : 'production'}.json`,
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
