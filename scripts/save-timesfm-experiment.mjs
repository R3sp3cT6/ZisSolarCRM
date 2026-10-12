// Explicit append-only research archive; never writes operational model tables.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/timesfm/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const digest = (v) => createHash('sha256').update(v).digest('hex');
const payload = read(root + 'evaluation.json');
const verification = read('docs/timesfm-verification.json');
assert.equal(verification.status, 'passed');
assert.equal(
  verification.predictionsSha256,
  digest(fs.readFileSync(root + 'predictions.json')),
);
const inputs = {
  source: read(root + 'source.json'),
  causalInputs: read(root + 'inputs.json'),
  targets: read(root + 'targets.json'),
  predictions: read(root + 'predictions.json'),
  downloads: read(root + 'download-receipts.json'),
  protocol: fs.readFileSync('docs/timesfm-experiment-plan.md', 'utf8'),
  frozen: read('docs/timesfm-frozen.json'),
  verification,
  sourceCode: Object.fromEntries(
    [
      'scripts/export-timesfm-inputs.mjs',
      'scripts/prepare-timesfm-experiment.mjs',
      'scripts/run-timesfm-experiment.py',
      'scripts/score-timesfm-experiment.mjs',
      'scripts/verify-timesfm-experiment.mjs',
      'scripts/save-timesfm-experiment.mjs',
      'scripts/download-timesfm-assets.py',
      'lib/forecast-backtest.ts',
      'lib/forecast-hourly-calibration.ts',
      'lib/forecast-solar.ts',
    ].map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
  originalWeatherArchives: [
    'response-research-evaluation-6ba96e6aeb36b080d6a5',
    'satellite-csi-v1-7ed68a9409bc354df08b',
  ],
};
assert.equal(
  digest(fs.readFileSync(root + 'inputs.json')),
  payload.inputSha256,
);
assert.equal(
  digest(fs.readFileSync(root + 'targets.json')),
  payload.targetSha256,
);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const version = 'timesfm-2.5-day-ahead-research-v1';
const id =
  version + '-' + digest(JSON.stringify({ payload, inputs })).slice(0, 20);
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(id, owner, version, JSON.stringify(payload), JSON.stringify(inputs))
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
  savedAt: new Date().toISOString(),
  id,
  table: 'forecast_evaluations',
  modelVersion: version,
  readback: 'exact',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)),
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  unchangedOperationalTables: true,
  note: 'This script only inserts a new research record. No operational forecast, replay, reading, revenue, cache or schedule mutation.',
};
fs.writeFileSync(
  'docs/timesfm-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt, null, 2));
