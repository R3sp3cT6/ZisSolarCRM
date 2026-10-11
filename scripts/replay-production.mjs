// Run with --conditions=react-server --experimental-transform-types and a private
// --env-file. Apply migration 008 first. Source files come from download-gfs-backtest.py.
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
registerHooks({
  resolve(s, c, next) {
    if (s === 'next/headers') return next('next/headers.js', c);
    if (
      !c.parentURL?.includes('/node_modules/') &&
      s.startsWith('.') &&
      !extname(s)
    )
      return next(s + '.ts', c);
    return next(s, c);
  },
});
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const from = arg('--from-date'),
  to = arg('--to-date'),
  directory = arg('--source-dir'),
  auditFile = arg('--audit-file');
assert.ok(
  /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    directory &&
    auditFile,
);
const { db } = await import('../db/index.ts');
const { reconstructDay, backtestOrigin, BACKTEST_VERSION } =
  await import('../lib/forecast-backtest.ts');
const { addDays } = await import('../lib/forecast-model.ts');
const { localDate } = await import('../lib/energy.ts');
const { loadDashboardSnapshot } = await import('../lib/solar-server.ts');
const { buildDashboard } = await import('../lib/dashboard.ts');
const { attachForecastComparison } =
  await import('../lib/forecast-comparison.ts');
const { cacheWrite } = await import('../lib/shared-cache.ts');
const { backtestKey } = await import('../lib/forecast-backtest-server.ts');
assert.ok(
  from <= to &&
    to <= localDate() &&
    Date.parse(to) - Date.parse(from) < 32 * 86400000,
);
const connection = db();
const plants = (
  await connection
    .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
    .all()
).results;
assert.equal(plants.length, 1);
const owner = plants[0].owner;
const fingerprint = async () =>
  connection
    .prepare(`SELECT
 (SELECT md5(string_agg(row_to_json(r)::text,',' ORDER BY start)) FROM readings r WHERE owner=?) AS readings,
 (SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY start)) FROM prices p) AS prices,
 (SELECT md5(string_agg(row_to_json(f)::text,',' ORDER BY id)) FROM forecast_runs f WHERE owner=?) AS prospective_forecasts`)
    .bind(owner, owner)
    .first();
const original = await fingerprint();
const settings = await connection
  .prepare('SELECT config FROM forecast_settings WHERE owner=?')
  .bind(owner)
  .first();
assert.ok(settings);
const payload = {
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  modelVersion: BACKTEST_VERSION,
  fromDate: from,
  toDate: to,
  source: 'NOAA GFS',
  days: [],
};
const inputs = {
  method:
    'Current solar model retrospective replay; archived prior-day 12 UTC GFS runs; 18 UTC information cutoff. DSWRF original GRIB interval bounds, de-averaged to 3h, clear-sky weighted hourly allocation. Temperature/wind midpoint interpolation. Recent completed daylight-only calibration. No repeated cloud/aerosol correction on surface flux.',
  limitations: [
    'Different weather provider from live MET forecasts: not the live-model accuracy score.',
    'Settings and model selected today; retrospective validation, not a prediction issued historically.',
    'Six-hour run-publication allowance is a conservative assumption; historical distribution timestamps are not independently archived.',
    'Latest available revision before origin is selected; unavailable history stays missing.',
  ],
  config: settings.config,
  days: [],
};
for (let date = from; date <= to; date = addDays(date, 1)) {
  const archive = JSON.parse(
    readFileSync(join(directory, date + '.json'), 'utf8'),
  );
  assert.equal(archive.day, date);
  archive.radiation = JSON.parse(
    readFileSync(join(directory, date + '-radiation.json'), 'utf8'),
  );
  const { originAt } = backtestOrigin(date);
  const { results: readings } = await connection
    .prepare(`SELECT DISTINCT ON(start) start,
 (payload::jsonb->>'productionKwh')::double precision AS production_kwh,
 (payload::jsonb->>'exportKwh')::double precision AS export_kwh,
 created_at AS revision_created_at,id AS revision_id
 FROM reading_revisions WHERE owner=? AND created_at<? AND start>=? AND start<?
 ORDER BY start,created_at DESC,id DESC`)
    .bind(owner, originAt, addDays(date, -47) + 'T00:00:00.000Z', originAt)
    .all();
  assert.ok(
    readings.every(
      (r) => r.revision_created_at < originAt && r.start < originAt,
    ),
  );
  const result = reconstructDay(archive, readings, settings.config);
  assert.ok(
    result.day.historyDays >= 7,
    'Insufficient prior complete days for ' + date,
  );
  assert.ok(
    result.day.hours.every((h) => h.productionKwh !== null),
    'Missing source coverage for ' + date,
  );
  payload.days.push(result.day);
  inputs.days.push({ date, archive, ...result.inputs });
  console.log(
    JSON.stringify({
      date,
      priorCompleteDays: result.day.historyDays,
      productionKwh: result.day.productionKwh,
    }),
  );
}
const snapshot = await loadDashboardSnapshot(owner);
const result = attachForecastComparison(
  buildDashboard(snapshot, from, 'month'),
  { hours: [], backtest: payload },
);
assert.ok(result.forecastComparison.backtestHours > 0);
assert.deepEqual(
  await fingerprint(),
  original,
  'Source data changed during replay; rerun for a stable audit.',
);
await connection
  .prepare(
    'INSERT INTO forecast_backtests(id,owner,created_at,period_from,period_to,model_version,payload,inputs) VALUES (?,?,?::timestamptz,?::date,?::date,?,?::jsonb,?::jsonb)',
  )
  .bind(
    payload.id,
    owner,
    payload.createdAt,
    from,
    to,
    BACKTEST_VERSION,
    JSON.stringify(payload),
    JSON.stringify(inputs),
  )
  .run();
const stored = await connection
  .prepare('SELECT payload,inputs FROM forecast_backtests WHERE id=?')
  .bind(payload.id)
  .first();
assert.deepEqual(stored.payload, payload);
assert.deepEqual(stored.inputs, inputs);
await connection
  .prepare('GRANT SELECT ON forecast_backtests TO zis_app_runtime')
  .run();
if (process.argv.includes('--publish'))
  await cacheWrite(backtestKey(owner), { owner, backtest: payload }, 7 * 86400);
const audit = {
  id: payload.id,
  createdAt: payload.createdAt,
  from,
  to,
  model: BACKTEST_VERSION,
  source: 'NOAA GFS',
  sourceGridDegrees: 0.25,
  sourceResolutionHours: 3,
  days: payload.days.map((d) => ({
    date: d.date,
    predictedKwh: d.productionKwh,
    trainingDays: d.historyDays,
  })),
  score: result.forecastComparison.backtestScore,
  scope:
    'Paired completed hours with actual or predicted production above zero; missing actuals excluded; current partial hour excluded.',
  sourceDataUnchanged: original,
  inputsSha256: createHash('sha256')
    .update(JSON.stringify(inputs))
    .digest('hex'),
  limitations: inputs.limitations,
};
writeFileSync(auditFile, JSON.stringify(audit, null, 2) + '\n');
console.log(
  JSON.stringify({
    saved: true,
    id: payload.id,
    hours: result.forecastComparison.backtestHours,
    score: audit.score,
  }),
);
