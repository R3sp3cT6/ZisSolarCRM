import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/full-history/',
  read = (p) => JSON.parse(fs.readFileSync(p));
const sha = (x) => createHash('sha256').update(x).digest('hex');
const payload = read('docs/full-history-evaluation.json'),
  verification = read('docs/full-history-verification.json'),
  frozen = read('docs/full-history-frozen.json'),
  frozenSource = read(root + 'frozen-source.json');
assert.equal(verification.status, 'passed');
for (const [p, h] of Object.entries(frozen.codeHashes))
  assert.equal(sha(frozenSource[p]), h);
assert.equal(
  sha(fs.readFileSync(root + 'inputs.json')),
  verification.inputSha256,
);
assert.equal(sha(fs.readFileSync(root + 'runs.json')), verification.runsSha256);
assert.equal(
  sha(fs.readFileSync('docs/full-history-evaluation.json')),
  verification.evaluationSha256,
);
const inputs = {
  data: read(root + 'inputs.json'),
  runs: read(root + 'runs.json'),
  coverage: read('docs/full-history-coverage.json'),
  verification,
  frozen,
  frozenSource,
  report: fs.readFileSync('docs/full-history-results.md', 'utf8'),
  verificationCode: fs.readFileSync('scripts/verify-full-history.mjs', 'utf8'),
};
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const id =
  'solar-full-history-v1-' +
  sha(JSON.stringify({ payload, inputs })).slice(0, 20);
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    'solar-full-history-v1',
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
  range: [payload.first, payload.last],
  officialForecastChanged: false,
  liveCandidateActivated: false,
};
fs.writeFileSync(
  'docs/full-history-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
