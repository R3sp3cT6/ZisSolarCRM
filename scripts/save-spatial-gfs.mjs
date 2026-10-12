import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (p) => JSON.parse(fs.readFileSync(p)),
  sha = (v) => createHash('sha256').update(v).digest('hex');
const root = 'work/forecast-research/spatial-gfs/';
const payload = read('docs/spatial-gfs-evaluation.json'),
  verification = read('docs/spatial-gfs-verification.json');
assert.equal(verification.status, 'passed');
assert.equal(
  verification.evaluationSha256,
  sha(fs.readFileSync('docs/spatial-gfs-evaluation.json')),
);
assert.equal(
  verification.inputSha256,
  sha(fs.readFileSync(root + 'inputs.json')),
);
assert.equal(verification.runsSha256, sha(fs.readFileSync(root + 'runs.json')));
const frozen = read('docs/spatial-gfs-frozen.json');
const frozenSource = read(root + 'frozen-source.json');
for (const [p, h] of Object.entries(frozen.codeHashes))
  assert.equal(sha(frozenSource[p]), h, p);
const inputs = {
  spatialInputs: read(root + 'inputs.json'),
  runs: read(root + 'runs.json'),
  frozen,
  verification,
  frozenSource,
  sourceCode: Object.fromEntries(
    [
      'scripts/decode-spatial-gfs.py',
      'scripts/prepare-spatial-gfs.mjs',
      'scripts/evaluate-spatial-gfs.mjs',
      'scripts/verify-spatial-gfs.py',
      'lib/forecast-provider-hours.ts',
      'scripts/save-spatial-gfs.mjs',
      'docs/forecast-spatial-gfs-plan.md',
    ].map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
};
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const id =
  'solar-spatial-gfs-v1-' +
  sha(JSON.stringify({ payload, inputs })).slice(0, 20);
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    'solar-spatial-gfs-v1',
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
  officialForecastChanged: false,
  liveCandidateActivated: false,
};
fs.writeFileSync(
  'docs/spatial-gfs-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
