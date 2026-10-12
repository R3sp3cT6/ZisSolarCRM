import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const telemetry = read(
  'work/forecast-research/huawei-ingestion-followup/pending.json',
);
const archive = read('docs/huawei-ingestion-followup-archive.json');
const fresh = telemetry.observations.filter((s) => {
  const age = Date.parse(s.receivedAt) - Date.parse(s.measuredAt);
  return Number.isFinite(age) && age >= 0 && age <= 900000;
});
assert.equal(fresh.length, archive.liveEligibleObservations);
assert.equal(
  telemetry.inverterSamples.length,
  archive.verifiedArchivedDeviceKeys,
);
const inputs = {
  telemetry,
  code: Object.fromEntries(
    [
      'scripts/check-forecast-ingestion.mjs',
      'scripts/archive-forecast-ingestion-followup.mjs',
      'scripts/save-huawei-ingestion-followup.mjs',
    ].map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
};
const payload = {
  beforeArchive: read('docs/huawei-fresh-history-production-followup.json'),
  archive,
  screenshot: 'outputs/huawei-refresh-followup-2026-10-12.jpg',
  note: 'Authenticated production refresh succeeded. Already collected telemetry archived with first receipts preserved. No new nowcast or day-ahead accuracy claim. No extra Huawei call during archival.',
};
const model = 'huawei-ingestion-followup-v1',
  id =
    model +
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
  savedAt: new Date().toISOString(),
  readback: 'exact',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)),
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
};
fs.writeFileSync(
  'docs/huawei-ingestion-followup-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
