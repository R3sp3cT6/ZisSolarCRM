import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (p) => JSON.parse(fs.readFileSync(p)),
  sha = (v) => createHash('sha256').update(v).digest('hex');
const root = 'work/forecast-research/local-mos/';
const payload = read('docs/local-mos-evaluation.json'),
  verification = read('docs/local-mos-verification.json');
assert.equal(verification.status, 'passed');
assert.equal(
  verification.evaluationSha256,
  sha(fs.readFileSync('docs/local-mos-evaluation.json')),
);
assert.equal(
  verification.inputsSha256,
  sha(fs.readFileSync(root + 'inputs.json')),
);
assert.equal(verification.runsSha256, sha(fs.readFileSync(root + 'runs.json')));
const frozen = read('docs/local-mos-frozen.json');
const frozenSource = read(root + 'frozen-source.json');
for (const [p, h] of Object.entries(frozen.preScoreCodeHashes))
  assert.equal(sha(frozenSource[p]), h, p);
const inputs = {
  causalInputs: read(root + 'inputs.json'),
  runs: read(root + 'runs.json'),
  frozen,
  verification,
  frozenSource,
  sourceCode: Object.fromEntries(
    [
      'lib/forecast-local-mos.ts',
      'scripts/prepare-local-mos.mjs',
      'scripts/evaluate-local-mos.mjs',
      'scripts/verify-local-mos.py',
      'scripts/report-local-mos.py',
      'scripts/save-local-mos.mjs',
      'docs/forecast-local-mos-plan.md',
    ].map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
};
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const id =
  'solar-local-mos-v1-' + sha(JSON.stringify({ payload, inputs })).slice(0, 20);
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    'solar-local-mos-v1',
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
  'docs/local-mos-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
