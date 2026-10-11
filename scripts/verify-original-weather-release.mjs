import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { cacheRead } from '../lib/shared-cache.ts';
import { runTrial, readTrial } from '../lib/forecast-trial-server.ts';
import { readForecast } from '../lib/forecast-server.ts';
import { getCachedDashboard } from '../lib/solar-cache.ts';
import { localDate } from '../lib/energy.ts';
import { withDatabaseUsage } from '../lib/database-usage.ts';
const [deployment, commit] = process.argv.slice(2);
assert.ok(
  deployment?.startsWith('dpl_') && /^[a-f0-9]{7,40}$/.test(commit ?? ''),
);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { role } = await db().prepare('SELECT current_user AS role').first();
assert.equal(role, 'zis_app_runtime');
const previous = await cacheRead('trial-context:' + owner);
const trial = await runTrial(owner);
const saved = await db()
  .prepare('SELECT payload,inputs FROM forecast_trials WHERE owner=? AND id=?')
  .bind(owner, trial.dayAhead.id)
  .first();
assert.deepEqual(saved.payload, trial.dayAhead);
assert.ok(Array.isArray(saved.inputs.context.retainedThermalHistory));
assert.deepEqual(
  saved.inputs.context,
  await cacheRead('trial-context:' + owner),
);
const date = localDate(new Date());
await Promise.all([
  getCachedDashboard(owner, date, 'day'),
  readForecast(owner),
  readTrial(owner),
]);
const response = await withDatabaseUsage(async () => {
  const [dashboard, forecast, view] = await Promise.all([
    getCachedDashboard(owner, date, 'day'),
    readForecast(owner),
    readTrial(owner),
  ]);
  return Response.json({
    hasDashboard: !!dashboard,
    official: forecast.forecast.version,
    trial: view.dayAhead.version,
  });
});
const value = await response.json(),
  queries = Number(response.headers.get('X-ZIS-Database-Queries'));
assert.equal(queries, 0);
assert.equal(value.official, 'weather-solar-v3.2');
assert.equal(value.trial, 'weather-solar-v3.4-satellite');
const [login, anonymous] = await Promise.all([
  fetch('https://zissolar.vercel.app/login'),
  fetch('https://zissolar.vercel.app/api/forecast-trial'),
]);
assert.equal(login.status, 200);
assert.equal(anonymous.status, 401);
const receipt = {
  checkedAt: new Date().toISOString(),
  commit,
  deployment,
  readyState: 'READY',
  runtimeRole: role,
  officialModel: value.official,
  trialModel: value.trial,
  trialId: trial.dayAhead.id,
  previousContextIssuedAt: previous?.issuedAt ?? null,
  retainedThermalHistory: saved.inputs.context.retainedThermalHistory,
  readback: 'exact',
  warmDashboardForecastTrialSqlQueries: queries,
  loginStatus: login.status,
  anonymousTrialStatus: anonymous.status,
  change:
    'Retain previously fetched thermal hours needed for fresh Huawei normalization; day-ahead formulas unchanged',
};
writeFileSync(
  'docs/original-weather-release.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
