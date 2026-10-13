import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';

const release = JSON.parse(
  fs.readFileSync('docs/timezone-release.json', 'utf8'),
);
assert.equal(release.status, 'READY');
assert.equal(release.tests, 227);
const paths = [
  'docs/timezone-audit.json',
  'docs/timezone-audit.md',
  'lib/energy.ts',
  'lib/plant-time.ts',
  'app/solar-app.tsx',
  'components/energy-chart.tsx',
  'components/forecast-panel.tsx',
  'tests/timezone.test.mjs',
  'tests/forecast-server.test.mjs',
  'vercel.json',
  'tests/fixtures/memo-dst-2026-03-29.html',
  'tests/fixtures/memo-dst-2025-10-26.html',
  'tests/fixtures/memo-dst-sources.json',
];
const inputs = {
  files: Object.fromEntries(
    paths.map((path) => [path, fs.readFileSync(path, 'utf8')]),
  ),
  tests: fs.readFileSync('work/timezone-audit/tests.log', 'utf8'),
  build: fs.readFileSync('work/timezone-audit/build.log', 'utf8'),
};
const payload = {
  version: 'timezone-dst-audit-v1',
  ...release,
  officialModel: 'weather-solar-v3.2',
  measurementsRewritten: false,
  pricesRewritten: false,
  inverterControl: false,
  limitation:
    'Upcoming 25 October Huawei clock transition is regression-tested, not yet observed live.',
};
const id =
  payload.version +
  '-' +
  createHash('sha256')
    .update(JSON.stringify({ payload, inputs }))
    .digest('hex')
    .slice(0, 20);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    payload.version,
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
  payload,
};
fs.writeFileSync(
  'docs/timezone-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
