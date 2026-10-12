import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/operational-training/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const hash = (s) => createHash('sha256').update(s).digest('hex');
const payload = read('docs/operational-training-evaluation.json');
const verification = read('docs/operational-training-verification.json');
const frozen = read('docs/operational-training-frozen.json');
const frozenSource = read(root + 'frozen-source.json');
assert.equal(verification.status, 'passed');
assert.equal(payload.promotion, false);
for (const [p, h] of Object.entries(frozen.hashes)) assert.equal(hash(frozenSource[p] ?? fs.readFileSync(p)), h);
for (const [p, h] of Object.entries(verification.hashes)) assert.equal(hash(fs.readFileSync(p)), h);
const inputs = {
  data: read('work/forecast-research/full-history/inputs.json'),
  inverterEvidence: read('work/forecast-research/inverter-evidence/inputs.json'),
  originalRuns: read('work/forecast-research/full-history/runs.json'),
  originalEvaluation: read('docs/full-history-evaluation.json'),
  originalFrozenSource: read('work/forecast-research/full-history/frozen-source.json'),
  runs: read(root + 'runs.json'), mask: read(root + 'mask.json'),
  frozen, frozenSource, verification,
  report: fs.readFileSync('docs/operational-training-results.md', 'utf8'),
  verificationCode: fs.readFileSync('scripts/verify-operational-training.mjs', 'utf8'),
  reportingCode: fs.readFileSync('scripts/report-operational-training.mjs', 'utf8'),
};
const { owner } = await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const id = payload.version + '-' + hash(JSON.stringify({ payload, inputs })).slice(0, 20);
await db().prepare('INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING')
  .bind(id, owner, payload.version, JSON.stringify(payload), JSON.stringify(inputs)).run();
const saved = await db().prepare('SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?').bind(owner, id).first();
assert.deepEqual(saved.payload, payload);
assert.deepEqual(saved.inputs, inputs);
const receipt = { id, savedAt: new Date().toISOString(), readback: 'exact',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)), payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  officialForecastChanged: false, newLiveCandidate: false, actualsChanged: false };
fs.writeFileSync('docs/operational-training-persistence.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
