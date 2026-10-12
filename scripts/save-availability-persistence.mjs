import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
const evaluation = read('docs/availability-persistence-evaluation.json'),
  verification = read('docs/availability-persistence-verification.json');
assert.equal(verification.status, 'passed');
assert.equal(
  createHash('sha256')
    .update(fs.readFileSync('docs/availability-persistence-evaluation.json'))
    .digest('hex'),
  verification.evaluationSha256,
);
const inputs = {
  sourceResearchId: 'solar-full-history-v1-66acd8997e24f971babf',
  sourceHashes: evaluation.inputs,
  originalInputs: read('work/forecast-research/full-history/inputs.json'),
  originalRuns: read('work/forecast-research/full-history/runs.json'),
  frozenCode: read(
    'work/forecast-research/availability-persistence/frozen-source.json',
  ),
  verifier: fs.readFileSync(
    'scripts/verify-availability-persistence.py',
    'utf8',
  ),
  reportCode: fs.readFileSync(
    'scripts/report-availability-persistence.mjs',
    'utf8',
  ),
  saveCode: fs.readFileSync(
    'scripts/save-availability-persistence.mjs',
    'utf8',
  ),
};
const payload = {
  evaluation,
  verification,
  report: fs.readFileSync('docs/availability-persistence-results.md', 'utf8'),
};
const model = 'availability-persistence-v1',
  id = model + '-' + hash({ payload, inputs }).slice(0, 20);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(id, owner, model, JSON.stringify(payload), JSON.stringify(inputs))
  .run();
const restored = await db()
  .prepare(
    'SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?',
  )
  .bind(owner, id)
  .first();
assert.deepEqual(restored, { payload, inputs });
const receipt = {
  id,
  readback: 'exact',
  savedAt: new Date().toISOString(),
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)),
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
};
fs.writeFileSync(
  'docs/availability-persistence-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
