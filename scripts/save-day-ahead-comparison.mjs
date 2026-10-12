// Append-only evidence archive. Run with the existing maintenance credential.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const audit = read('docs/day-ahead-comparison-audit.json');
const evidence = read(
  'work/forecast-research/day-ahead-comparison/inputs.json',
);
assert.equal(hash(evidence), audit.inputSha256);
const release = read('docs/day-ahead-comparison-release.json');
assert.equal(release.status, 'verified');
const paths = [
  'lib/forecast-comparison.ts',
  'lib/forecast-comparison-server.ts',
  'components/forecast-accuracy.tsx',
  'components/energy-chart.tsx',
  'tests/forecast-comparison.test.mjs',
  'scripts/audit-day-ahead-comparison.mjs',
  'scripts/save-day-ahead-comparison.mjs',
  'docs/day-ahead-comparison.md',
];
const inputs = {
  evidence,
  sourceCode: Object.fromEntries(
    paths.map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
};
const payload = { audit, release };
const model = 'day-ahead-comparison-policy-v1';
const id = model + '-' + hash({ payload, inputs }).slice(0, 20);
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
  'docs/day-ahead-comparison-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
