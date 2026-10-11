import fs from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { runModels, readModels } from '../lib/forecast-multimodel-server.ts';
import { readForecast } from '../lib/forecast-server.ts';
import { readTrial } from '../lib/forecast-trial-server.ts';
import { getCachedDashboard } from '../lib/solar-cache.ts';
import { localDate } from '../lib/energy.ts';
import { withDatabaseUsage } from '../lib/database-usage.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { role } = await db().prepare('SELECT current_user AS role').first();
assert.equal(role, 'zis_app_runtime');
const view = await runModels(owner);
assert.equal(view.complete, true);
assert.equal(view.selection.weights, null);
const stored = await db()
  .prepare(
    'SELECT id,payload,inputs FROM forecast_trials WHERE owner=? AND model_version=? ORDER BY issued_at DESC LIMIT 1',
  )
  .bind(owner, view.version)
  .first();
assert.deepEqual(stored.payload, view);
assert.equal(stored.inputs.gfs.status, 'ready');
assert.equal(stored.inputs.arpege.status, 'ready');
assert.equal(stored.inputs.gfs.hours.length, view.hours.length);
assert.equal(stored.inputs.arpege.hours.length, view.hours.length);
assert.deepEqual(await readModels(owner), view);
const date = localDate();
await Promise.all([
  getCachedDashboard(owner, date, 'day'),
  readForecast(owner),
  readTrial(owner),
]);
const response = await withDatabaseUsage(async () => {
  const [, forecast, trial, models] = await Promise.all([
    getCachedDashboard(owner, date, 'day'),
    readForecast(owner),
    readTrial(owner),
    readModels(owner),
  ]);
  return Response.json({
    official: forecast.forecast.version,
    trial: trial.dayAhead.version,
    models: models.version,
  });
});
assert.equal(Number(response.headers.get('X-ZIS-Database-Queries')), 0);
const versions = await response.json();
assert.equal(versions.official, 'weather-solar-v3.2');
assert.equal(versions.trial, 'weather-solar-v3.4-satellite');
const totals = Object.fromEntries(
  ['icon', 'gfs', 'arpege', 'mean', 'median'].map((key) => [
    key,
    view.hours.reduce((s, h) => s + h.values[key], 0) / 1000,
  ]),
);
const receipt = {
  checkedAt: new Date().toISOString(),
  runtimeRole: role,
  runId: stored.id,
  issuedAt: view.issuedAt,
  date: view.date,
  hours: view.hours.length,
  totalsMwh: totals,
  versions,
  selection: view.selection,
  readback: 'exact',
  warmSqlQueries: 0,
  sources: view.sources,
  sourceBytes: {
    arpege: stored.inputs.arpege.files.reduce((s, f) => s + f.bytes, 0),
    gfs: stored.inputs.gfs.files.reduce((s, f) => s + f.bytes, 0),
  },
};
if (process.argv[2]) {
  assert.ok(process.argv[2].startsWith('dpl_'));
  receipt.deployment = process.argv[2];
  const [login, anonymous] = await Promise.all([
    fetch('https://zissolar.vercel.app/login'),
    fetch('https://zissolar.vercel.app/api/forecast-models'),
  ]);
  assert.equal(login.status, 200);
  assert.equal(anonymous.status, 401);
  receipt.loginStatus = login.status;
  receipt.anonymousStatus = anonymous.status;
}
fs.writeFileSync(
  'docs/multimodel-runtime-receipt.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
