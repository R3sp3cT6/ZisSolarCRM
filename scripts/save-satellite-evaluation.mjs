// Explicit maintenance operation. Does not overwrite production or historical chart forecasts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
const full = JSON.parse(
  readFileSync('work/forecast-research/satellite-replay-full.json', 'utf8'),
);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const id =
  'satellite-csi-v1-' +
  createHash('sha256').update(JSON.stringify(full)).digest('hex').slice(0, 20);
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    full.audit.model,
    JSON.stringify(full.audit),
    JSON.stringify(full.inputs),
  )
  .run();
const saved = await db()
  .prepare(
    'SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?',
  )
  .bind(owner, id)
  .first();
assert.deepEqual(saved.payload, full.audit);
assert.deepEqual(saved.inputs, full.inputs);
const receipt = {
  checkedAt: new Date().toISOString(),
  id,
  model: full.audit.model,
  sourceSlots: saved.inputs.satellitePoints.length,
  rawSlots: saved.inputs.satellitePoints.filter(
    (p) => p.raw?.ascii && p.raw?.attributes,
  ).length,
  pairedHours: full.audit.v32.hours,
  readback: 'exact',
  v32Wape: full.audit.v32.wapePercent,
  satelliteWape: full.audit.satellite.wapePercent,
};
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
