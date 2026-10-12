// Real persisted source data, isolated SQL branch; no production mutation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { db } from '../db/index.ts';
import { TRIAL_VERSION } from '../lib/forecast-trial.ts';
import { localDate } from '../lib/energy.ts';
import { addDays } from '../lib/forecast-model.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const source = await db()
  .prepare(
    "SELECT payload,inputs FROM forecast_trials WHERE owner=? AND model_version='solar-multimodel-shadow-v1' ORDER BY issued_at DESC LIMIT 1",
  )
  .bind(owner)
  .first();
assert.ok(
  source?.inputs.context && source.inputs.gfs.status === 'ready',
  'A real complete source is required',
);
assert.equal(
  source.payload.date,
  addDays(localDate(), 1),
  'Refresh existing trials first; do not relabel an old source',
);
const url = new URL(process.env.DATABASE_URL);
url.hostname = 'ep-dawn-heart-b1rdaxm1.c-5.eu-central-1.aws.neon.tech';
process.env.DATABASE_URL = url.toString();
const cache = new Map([['trial-context:' + owner, source.inputs.context]]);
mock.module('../lib/auth.ts', {namedExports:{getUser:async()=>null,sameOrigin:()=>false,authLimit:async()=>false}});
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (k) => cache.get(k) ?? null,
    cacheWrite: async (k, v) => cache.set(k, v),
    withCacheLock: async (k, work) => ({ busy: false, value: await work() }),
  },
});
mock.module('../lib/forecast-multimodel-sources.ts', {
  namedExports: {
    fetchModelSource: async (provider) => source.inputs[provider],
  },
});
const { runModels, readModels } =
  await import('../lib/forecast-multimodel-server.ts');
const { siteArtifactHash, siteModel } =
  await import('../lib/forecast-site-learning-server.ts');
const before = await db()
  .prepare(
    'SELECT (SELECT count(*) FROM readings) AS readings,(SELECT count(*) FROM forecast_runs) AS official,(SELECT count(*) FROM forecast_backtests) AS backtests',
  )
  .first();
const view = await runModels(owner);
assert.equal(view.siteLearning.status, 'ready');
assert.equal(view.siteLearning.artifactHash, siteArtifactHash);
assert.equal(view.date, source.payload.date);
assert.equal(view.siteLearning.hours.length, view.hours.length);
const saved = await db()
  .prepare(
    "SELECT payload,inputs FROM forecast_trials WHERE owner=? AND payload->'siteLearning'->>'artifactHash'=? ORDER BY issued_at DESC LIMIT 1",
  )
  .bind(owner, siteArtifactHash)
  .first();
assert.deepEqual(saved.payload, view);
assert.deepEqual(saved.inputs.siteLearning.artifact, siteModel);
assert.ok(
  view.siteLearning.hours.every(
    (h) =>
      h.productionKwh !== null &&
      Date.parse(h.start) > Date.parse(view.issuedAt),
  ),
);
assert.deepEqual(await readModels(owner), view);
const after = await db()
  .prepare(
    'SELECT (SELECT count(*) FROM readings) AS readings,(SELECT count(*) FROM forecast_runs) AS official,(SELECT count(*) FROM forecast_backtests) AS backtests',
  )
  .first();
assert.deepEqual(before, after);
const receipt = {
  checkedAt: new Date().toISOString(),
  environment: 'isolated-validation-branch',
  sourceDate: source.payload.date,
  sourceIssuedAt: source.payload.issuedAt,
  readback: 'exact',
  version: TRIAL_VERSION,
  artifactHash: siteArtifactHash,
  method: siteModel.method,
  hours: view.siteLearning.hours.length,
  predictedMwh:
    view.siteLearning.hours.reduce((s, h) => s + h.productionKwh, 0) / 1000,
  officialReadingsAndBacktestCountsUnchanged: true,
};
fs.writeFileSync(
  'docs/site-learning-runtime-test.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
