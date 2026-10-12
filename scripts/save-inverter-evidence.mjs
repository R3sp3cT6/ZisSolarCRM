import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const mode = process.argv[2];
assert.ok(['--test', '--publish', '--research'].includes(mode));
if (mode === '--test') {
  const url = new URL(process.env.DATABASE_URL);
  url.hostname = 'ep-dawn-heart-b1rdaxm1.c-5.eu-central-1.aws.neon.tech';
  process.env.DATABASE_URL = url.toString();
}
const payload = JSON.parse(fs.readFileSync('docs/inverter-evidence.json'));
const inputs = JSON.parse(
  fs.readFileSync('work/forecast-research/inverter-evidence/inputs.json'),
);
assert.equal(payload.verification, 'passed');
const { owner } = await db()
  .prepare('SELECT owner FROM plants WHERE name=?')
  .bind('ZIS Solar')
  .first();
const before = await db()
  .prepare(
    'SELECT count(*) AS readings FROM readings',
  )
  .first();
if (mode === '--research') {
  inputs.protocol = fs.readFileSync('docs/inverter-evidence-plan.md', 'utf8');
  inputs.storageTest = JSON.parse(fs.readFileSync('docs/inverter-evidence-storage-test.json'));
  inputs.productionStorage = JSON.parse(fs.readFileSync('docs/inverter-evidence-production.json'));
  inputs.report = fs.readFileSync('docs/inverter-evidence.md', 'utf8');
  inputs.auditCode = fs.readFileSync(
    'scripts/audit-inverter-history.mjs',
    'utf8',
  );
  const id =
    'inverter-evidence-v1-' +
    createHash('sha256')
      .update(JSON.stringify({ payload, inputs }))
      .digest('hex')
      .slice(0, 20);
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
      'SELECT payload,inputs FROM forecast_evaluations WHERE id=? AND owner=?',
    )
    .bind(id, owner)
    .first();
  assert.deepEqual(saved, { payload, inputs });
  const receipt = {
    id,
    savedAt: new Date().toISOString(),
    exactReadback: true,
    sourceRows: payload.samples,
    uniqueRows: payload.uniqueSamples,
  };
  fs.writeFileSync(
    'docs/inverter-evidence-research.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify(receipt));
} else {
  const insert = () =>
    db()
      .prepare(`INSERT INTO forecast_inverter_samples(owner,device_id,measured_at,received_at,payload)
 SELECT ?,(value->>'deviceId')::bigint,(value->>'measuredAt')::timestamptz,(value->>'receivedAt')::timestamptz,value
 FROM jsonb_array_elements(?::jsonb) ON CONFLICT(owner,device_id,measured_at) DO NOTHING`)
      .bind(owner, JSON.stringify(inputs.samples))
      .run();
  await insert();
  if (mode === '--test') await insert();
  const starts = inputs.samples.map((s) => s.measuredAt).sort();
  const saved = (
    await db()
      .prepare(
        'SELECT payload FROM forecast_inverter_samples WHERE owner=? AND measured_at BETWEEN ?::timestamptz AND ?::timestamptz',
      )
      .bind(owner, starts[0], starts.at(-1))
      .all()
  ).results;
  const byKey = new Map(
    saved.map((r) => [
      r.payload.deviceId + ':' + r.payload.measuredAt,
      r.payload,
    ]),
  );
  for (const expected of inputs.samples)
    assert.deepEqual(
      byKey.get(expected.deviceId + ':' + expected.measuredAt),
      expected,
    );
  const after = await db()
    .prepare(
      'SELECT count(*) AS readings FROM readings',
    )
    .first();
  if (mode === '--test') assert.deepEqual(before, after);
  const receipt = {
    mode,
    savedAt: new Date().toISOString(),
    exactReadback: true,
    rows: inputs.samples.length,
    duplicateInsertTest: mode === '--test',
    before,
    after,
  };
  fs.writeFileSync(
    `docs/inverter-evidence-${mode === '--test' ? 'storage-test' : 'production'}.json`,
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify(receipt));
}
