// Explicit archive of telemetry already collected by the authenticated UI.
// No Huawei requests, invented receipts, new forecast or scheduler changes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import { cacheRead } from '../lib/shared-cache.ts';
import { flushTrialPending } from '../lib/forecast-trial-live.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const pending = await cacheRead('trial-pending:' + owner);
assert.ok(
  pending?.inverterSamples?.length,
  'Expected already-collected device evidence',
);
const liveEligibleObservations = pending.observations.filter((s) => {
  const age = Date.parse(s.receivedAt) - Date.parse(s.measuredAt);
  return Number.isFinite(age) && age >= 0 && age <= 15 * 60000;
}).length;
fs.mkdirSync('work/forecast-research/huawei-ingestion-followup', {
  recursive: true,
});
fs.writeFileSync(
  'work/forecast-research/huawei-ingestion-followup/pending.json',
  JSON.stringify(pending),
);
const before = await db()
  .prepare(
    'SELECT count(*)::integer AS count,max(measured_at)::text AS latest FROM forecast_inverter_samples WHERE owner=?',
  )
  .bind(owner)
  .first();
await flushTrialPending(owner);
const after = await db()
  .prepare(
    'SELECT count(*)::integer AS count,max(measured_at)::text AS latest,max(received_at)::text AS receipt FROM forecast_inverter_samples WHERE owner=?',
  )
  .bind(owner)
  .first();
const remaining = await cacheRead('trial-pending:' + owner);
assert.equal(remaining?.inverterSamples?.length ?? 0, 0);
assert.equal(remaining?.observations?.length ?? 0, 0);
assert.ok(after.count >= before.count);
const rows = (
  await db()
    .prepare(
      "SELECT payload FROM forecast_inverter_samples WHERE owner=? AND (device_id::text,measured_at) IN (SELECT value->>'deviceId',(value->>'measuredAt')::timestamptz FROM jsonb_array_elements(?::jsonb))",
    )
    .bind(owner, JSON.stringify(pending.inverterSamples))
    .all()
).results;
const byKey = new Map(
  rows.map((r) => [r.payload.deviceId + ':' + r.payload.measuredAt, r.payload]),
);
for (const sample of pending.inverterSamples) {
  const saved = byKey.get(sample.deviceId + ':' + sample.measuredAt);
  assert.ok(saved, 'Every device sample must be archived');
  assert.ok(
    Date.parse(saved.receivedAt) <= Date.parse(sample.receivedAt),
    'First receipt preserved',
  );
}
const summary = {
  checkedAt: new Date().toISOString(),
  before,
  after,
  queuedDevices: pending.inverterSamples.length,
  queuedObservations: pending.observations.length,
  verifiedArchivedDeviceKeys: rows.length,
  remainingPending: 0,
  liveEligibleObservations,
  reason:
    'Latest measurement 16:30 UTC is older than the 15-minute freshness limit at 17:36 UTC receipt. No invented live correction.',
  newHuaweiCalls: 0,
};
fs.writeFileSync(
  'docs/huawei-ingestion-followup-archive.json',
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(JSON.stringify(summary));
