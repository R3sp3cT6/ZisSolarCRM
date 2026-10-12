import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/site-learning/',
  read = (p) => JSON.parse(fs.readFileSync(p)),
  sha = (v) => createHash('sha256').update(v).digest('hex');
const verification = read('docs/site-learning-verification.json'),
  payload = read('docs/site-learning-evaluation.json');
assert.equal(verification.status, 'passed');
assert.equal(
  verification.evaluationSha256,
  sha(fs.readFileSync('docs/site-learning-evaluation.json')),
);
const inputs = {
  causalInputs: read(root + 'inputs.json'),
  runs: read(root + 'runs.json'),
  selection: read(root + 'selection.json'),
  artifact: read(root + 'model.json'),
  finalTraining: read(root + 'final-training.json'),
  portableFixtures: read(root + 'portable-fixtures.json'),
  verification,
  frozen: read('docs/site-learning-frozen.json'),
  sourceCode: Object.fromEntries(
    [
      'scripts/download-site-learning.py',
      'scripts/prepare-site-learning.mjs',
      'scripts/run-site-learning.py',
      'scripts/verify-site-learning.mjs',
      'scripts/save-site-learning.mjs',
      'lib/forecast-site-learning.ts',
      'lib/forecast-provider-hours.ts',
      'lib/forecast-solar.ts',
      'docs/solar-learning-plan.md',
      'docs/solar-forecast-market-analysis.md',
    ].map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
};
assert.equal(
  verification.inputSha256,
  sha(fs.readFileSync(root + 'inputs.json')),
);
assert.equal(verification.runsSha256, sha(fs.readFileSync(root + 'runs.json')));
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const id =
  'solar-site-learning-v1-' +
  sha(JSON.stringify({ payload, inputs })).slice(0, 20);
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    'solar-site-learning-v1',
    JSON.stringify(payload),
    JSON.stringify(inputs),
  )
  .run();
const saved = await db()
  .prepare(
    'SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?',
  )
  .bind(owner, id)
  .first();
assert.deepEqual(saved.payload, payload);
assert.deepEqual(saved.inputs, inputs);
const receipt = {
  id,
  savedAt: new Date().toISOString(),
  readback: 'exact',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)),
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  note: 'Append-only research. Decoded hourly source values, metadata, hashes, causal revisions, predictions, weights and code retained. Original binary GRIB byte ranges remain in local research cache.',
};
fs.writeFileSync(
  'docs/site-learning-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt, null, 2));
