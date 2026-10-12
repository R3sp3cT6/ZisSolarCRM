import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/sflux/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const payload = read('docs/sflux-pilot-verification.json');
assert.equal(payload.status, 'passed');
assert.equal(payload.forecastScored, false);
assert.equal(sha(fs.readFileSync(root + payload.date + '.json')), payload.sourceSha256);
assert.equal(sha(fs.readFileSync(root + 'pilot-features.json')), payload.featuresSha256);
const codePaths = [
  'scripts/download-sflux-research.py', 'scripts/sflux-features.py',
  'scripts/prepare-sflux-research.py', 'scripts/evaluate-sflux-research.py',
  'scripts/verify-sflux-research.mjs', 'scripts/audit-sflux-pilot.py',
  'tests/sflux-features.test.py', 'docs/sflux-research-plan.md',
];
const oldData = read('work/forecast-research/full-history/inputs.json');
const inputs = {
  source: read(root + payload.date + '.json'),
  prepared: read(root + 'pilot-features.json'),
  originalDay: oldData.days.find((d) => d.date === payload.date),
  config: oldData.config,
  sourceResearchId: 'solar-full-history-v1-66acd8997e24f971babf',
  code: Object.fromEntries(codePaths.map((p) => [p, fs.readFileSync(p, 'utf8')])),
  codeHashes: Object.fromEntries(codePaths.map((p) => [p, sha(fs.readFileSync(p))])),
  report: fs.readFileSync('docs/sflux-pilot-results.md', 'utf8'),
  scope: 'Source validation only. Full192day collection remains in progress; no accuracy score or deployment.',
};
const { owner } = await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const version = 'solar-sflux-probe-v1';
const id = version + '-' + sha(JSON.stringify({ payload, inputs })).slice(0, 20);
await db().prepare('INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING')
  .bind(id, owner, version, JSON.stringify(payload), JSON.stringify(inputs)).run();
const saved = await db().prepare('SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?').bind(owner, id).first();
assert.deepEqual(saved.payload, payload); assert.deepEqual(saved.inputs, inputs);
const receipt = { id, savedAt: new Date().toISOString(), readback: 'exact',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)), payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  officialForecastChanged: false, forecastScored: false };
fs.writeFileSync('docs/sflux-pilot-persistence.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
