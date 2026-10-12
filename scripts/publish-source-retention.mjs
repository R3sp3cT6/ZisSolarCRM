// Restore genuine last-good source copies, then run the normal collector once.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { cacheRead, cacheWrite } from '../lib/shared-cache.ts';
import { localDate, slotsForDay } from '../lib/energy.ts';
import { addDays } from '../lib/forecast-model.ts';
import { runModels, readModels } from '../lib/forecast-multimodel-server.ts';
import { withDatabaseUsage } from '../lib/database-usage.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { role } = await db().prepare('SELECT current_user AS role').first();
assert.equal(role, 'zis_app_runtime');
const now = new Date(),
  date = addDays(localDate(now), 1),
  restored = [];
for (const provider of ['arpege', 'gfs']) {
  const row = await db()
    .prepare(
      `SELECT id,inputs->'context'->'config' AS config,inputs->? AS source FROM forecast_trials WHERE owner=? AND model_version='solar-multimodel-shadow-v1' AND payload->>'date'=? AND inputs->?->>'status'='ready' ORDER BY issued_at DESC LIMIT 1`,
    )
    .bind(provider, owner, date, provider)
    .first();
  if (!row) continue;
  const s = row.source,
    c = row.config;
  const run = Date.parse(s.runAt),
    receipt = Date.parse(s.fetchedAt);
  if (
    !Number.isFinite(run) ||
    !Number.isFinite(receipt) ||
    run > receipt ||
    receipt > now.getTime() ||
    now.getTime() - run >= 18 * 3600000 ||
    now.getTime() - receipt >= 6 * 3600000
  )
    continue;
  assert.deepEqual(
    s.hours.map((h) => h.start),
    slotsForDay(date).map((h) => h.start),
  );
  const key = `model-source:v1:${provider}:${c.latitude}:${c.longitude}:${date}:last-good`;
  const current = await cacheRead(key);
  if (
    !current ||
    Date.parse(current.runAt) < run ||
    Date.parse(current.fetchedAt) < receipt
  ) {
    await cacheWrite(key, s, 86400);
    assert.deepEqual(await cacheRead(key), s);
    restored.push({
      provider,
      sourceId: row.id,
      runAt: s.runAt,
      fetchedAt: s.fetchedAt,
    });
  }
}
const view = await runModels(owner);
const stored = await db()
  .prepare(
    "SELECT id,payload,inputs FROM forecast_trials WHERE owner=? AND model_version='solar-multimodel-shadow-v1' ORDER BY issued_at DESC LIMIT 1",
  )
  .bind(owner)
  .first();
assert.deepEqual(stored.payload, view);
for (const p of ['arpege', 'gfs'])
  if (view.sources[p].status === 'ready') {
    assert.equal(stored.inputs[p].runAt, view.sources[p].runAt);
    assert.equal(stored.inputs[p].fetchedAt, view.sources[p].fetchedAt);
  }
const response = await withDatabaseUsage(async () =>
  Response.json(await readModels(owner)),
);
assert.equal(response.headers.get('X-ZIS-Database-Queries'), '0');
const official = await db()
  .prepare(
    'SELECT model_version FROM forecast_runs WHERE owner=? ORDER BY issued_at DESC LIMIT 1',
  )
  .bind(owner)
  .first();
assert.equal(official.model_version, 'weather-solar-v3.2');
const receipt = {
  checkedAt: new Date().toISOString(),
  restored,
  id: stored.id,
  date: view.date,
  issuedAt: view.issuedAt,
  complete: view.complete,
  sources: view.sources,
  readback: 'exact',
  warmSqlQueries: 0,
  officialVersion: official.model_version,
};
fs.writeFileSync(
  'docs/source-retention-production.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
