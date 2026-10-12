// Simulate network failure against genuine persisted inputs; no production writes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { db } from '../db/index.ts';
import { localDate } from '../lib/energy.ts';
import { addDays } from '../lib/forecast-model.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const row = await db()
  .prepare(
    "SELECT id,payload,inputs FROM forecast_trials WHERE owner=? AND model_version='solar-multimodel-shadow-v1' AND payload->>'complete'='true' ORDER BY issued_at DESC LIMIT 1",
  )
  .bind(owner)
  .first();
const now = new Date(),
  date = addDays(localDate(now), 1),
  config = row.inputs.context.config;
assert.equal(row.payload.date, date);
const memory = new Map(),
  original = row.inputs.arpege;
const key = `model-source:v1:arpege:${config.latitude}:${config.longitude}:${date}`;
memory.set(key + ':last-good', original);
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (k) => memory.get(k) ?? null,
    cacheWrite: async (k, v) => memory.set(k, v),
    withCacheLock: async (k, work) => ({ busy: false, value: await work() }),
  },
});
mock.method(globalThis, 'fetch', async () => {
  throw Error('Simulated refresh failure (verification only)');
});
const { fetchModelSource } =
  await import('../lib/forecast-multimodel-sources.ts');
const retained = await fetchModelSource('arpege', config, now);
assert.deepEqual(retained, { ...original, retainedAfterFailure: true });
assert.ok(
  memory.get(key).expires <=
    Math.min(
      Date.parse(original.fetchedAt) + 6 * 3600000,
      Date.parse(original.runAt) + 18 * 3600000,
    ),
);
memory.set(key, { expires: 0, value: retained });
const expired = await fetchModelSource(
  'arpege',
  config,
  new Date(now.getTime() + 7 * 3600000),
);
assert.equal(expired.status, 'unavailable');
const receipt = {
  checkedAt: now.toISOString(),
  sourceRunId: row.id,
  sourceDate: date,
  sourceRunAt: original.runAt,
  sourceFetchedAt: original.fetchedAt,
  hours: retained.hours.length,
  unchangedSourceAndNumericalValues: true,
  expiredRejected: true,
  productionWrites: 0,
};
fs.writeFileSync(
  'docs/source-retention-verification.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
