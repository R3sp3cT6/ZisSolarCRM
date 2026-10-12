import fs from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { runModels, readModels } from '../lib/forecast-multimodel-server.ts';
import {
  siteArtifactHash,
  siteModel,
} from '../lib/forecast-site-learning-server.ts';
import { withDatabaseUsage } from '../lib/database-usage.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { role } = await db().prepare('SELECT current_user AS role').first();
assert.equal(role, 'zis_app_runtime');
const view = await runModels(owner);
assert.equal(view.siteLearning.artifactHash, siteArtifactHash);
assert.equal(view.siteLearning.status, 'ready');
const stored = await db()
  .prepare(
    "SELECT id,payload,inputs->'siteLearning' AS site FROM forecast_trials WHERE owner=? AND payload->'siteLearning'->>'artifactHash'=? ORDER BY issued_at DESC LIMIT 1",
  )
  .bind(owner, siteArtifactHash)
  .first();
assert.deepEqual(stored.payload, view);
assert.deepEqual(stored.site.artifact, siteModel);
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
  publishedAt: new Date().toISOString(),
  runtimeRole: role,
  id: stored.id,
  artifactHash: siteArtifactHash,
  method: siteModel.method,
  date: view.date,
  issuedAt: view.issuedAt,
  hours: view.siteLearning.hours.length,
  predictedMwh:
    view.siteLearning.hours.reduce((s, h) => s + h.productionKwh, 0) / 1000,
  baselineMwh:
    view.siteLearning.hours.reduce((s, h) => s + (h.baselineKwh ?? 0), 0) /
    1000,
  score: view.siteLearning.score,
  source: view.sources.gfs,
  readback: 'exact',
  warmSqlQueries: 0,
  officialVersion: official.model_version,
  validUntil: siteModel.validUntil,
};
fs.writeFileSync(
  'docs/site-learning-production.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt, null, 2));
