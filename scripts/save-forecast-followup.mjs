// Explicit maintenance persistence and verification; no control commands or forecasts issued.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import { historicalObservations } from '../lib/forecast-trial.ts';
import {
  recordHistoricalTrial,
  flushTrialPending,
} from '../lib/forecast-trial-live.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = (p) =>
  createHash('sha256').update(JSON.stringify(p)).digest('hex');
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const records = [];
async function save(label, payload, inputs) {
  const id =
    'forecast-followup-' + label + '-' + hash({ payload, inputs }).slice(0, 20);
  await db()
    .prepare(
      'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
    )
    .bind(
      id,
      owner,
      'forecast-followup-research-v1',
      JSON.stringify(payload),
      JSON.stringify(inputs),
    )
    .run();
  const r = await db()
    .prepare(
      'SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?',
    )
    .bind(owner, id)
    .first();
  assert.deepEqual(r.payload, payload);
  assert.deepEqual(r.inputs, inputs);
  records.push({ id, label, readback: 'exact' });
  return id;
}
const archiveReceipt = read('docs/response-research-persistence.json');
const sources = {
  archiveReceipt,
  frozenSources: read('work/forecast-research/frozen-response-sources.json'),
};
const adaptive = read(
  'work/forecast-research/satellite-adaptive-exploratory.json',
);
const persistence = read(
  'work/forecast-research/satellite-persistence-exploratory.json',
);
const fullInputs = read(
  'work/forecast-research/satellite-evaluation-inputs.json',
);
const sourceCode = Object.fromEntries(
  [
    'lib/forecast-satellite-adaptive.ts',
    'lib/forecast-satellite-motion.ts',
    'lib/forecast-huawei-persistence.ts',
    'lib/forecast-trial.ts',
    'lib/forecast-satellite-nowcast.ts',
    'scripts/evaluate-satellite-adaptive.mjs',
    'scripts/evaluate-satellite-persistence.mjs',
    'scripts/evaluate-huawei-nowcast.mjs',
  ].map((p) => [p, fs.readFileSync(p, 'utf8')]),
);
await save(
  'methods',
  {
    adaptive,
    persistence,
    decision:
      'No candidate is promoted: additional gains are small or inconsistent across days and horizons; full ICON/Huawei prospective accuracy is not yet established.',
  },
  { ...sources, sourceCode, octoberBaseline: fullInputs },
);
const huawei = [],
  observations = [];
for (const date of ['2026-10-10', '2026-10-11']) {
  const raw = read(
    'work/forecast-research/huawei-five-minute/' + date + '.json',
  );
  assert.equal(raw.sha256, hash(raw.values));
  const reports = [5, 10].map((latency) =>
    read(
      'work/forecast-research/huawei-nowcast-' +
        date +
        '-latency' +
        latency +
        '.json',
    ),
  );
  await save(
    date,
    {
      reports,
      limitations: [
        'Historical receipt modeled at 5/10min; raw actual receipt preserved.',
        'GFS background, not historical ICON. Original 18h live weather guard retains baseline on later stale-background intervals.',
        'Exploratory selected dates; not independent prospective validation.',
      ],
    },
    { raw, sourceCode },
  );
  const values = historicalObservations(
    raw.values,
    raw.devices,
    new Date(raw.receivedAt),
  );
  observations.push(...values);
  huawei.push({
    date,
    rawRows: raw.values.length,
    completeObservations: values.length,
    reports: reports.map((r) => ({
      assumedReceiptMinutes: r.assumedReceiptMinutes,
      groups: r.groups,
      scored: r.scored,
      corrected: r.corrected,
    })),
  });
}
const before = (
  await db()
    .prepare(
      'SELECT measured_at,payload FROM forecast_observations WHERE owner=? AND measured_at>=?::timestamptz AND measured_at<=?::timestamptz',
    )
    .bind(owner, '2026-10-09T22:00:00Z', '2026-10-11T17:00:00Z')
    .all()
).results;
const previous = new Map(
  before.map((r) => [new Date(r.measured_at).toISOString(), r.payload]),
);
for (const date of ['2026-10-10', '2026-10-11']) {
  const raw = read(
    'work/forecast-research/huawei-five-minute/' + date + '.json',
  );
  await recordHistoricalTrial(
    owner,
    raw.values,
    raw.devices,
    new Date(raw.receivedAt),
  );
}
await flushTrialPending(owner);
const after = (
  await db()
    .prepare(
      'SELECT measured_at,payload FROM forecast_observations WHERE owner=? AND measured_at>=?::timestamptz AND measured_at<=?::timestamptz',
    )
    .bind(owner, '2026-10-09T22:00:00Z', '2026-10-11T17:00:00Z')
    .all()
).results;
const stored = new Map(
  after.map((r) => [new Date(r.measured_at).toISOString(), r.payload]),
);
const firstQueued = new Map();
for (const observation of observations)
  if (!firstQueued.has(observation.measuredAt))
    firstQueued.set(observation.measuredAt, observation);
const unique = [...firstQueued.values()];
for (const observation of unique)
  assert.deepEqual(
    stored.get(observation.measuredAt),
    previous.get(observation.measuredAt) ?? observation,
  );
const receipt = {
  checkedAt: new Date().toISOString(),
  records,
  huawei,
  observationReadback: {
    unique: unique.length,
    alreadyPresent: unique.filter((o) => previous.has(o.measuredAt)).length,
    readback: 'exact, first stored observations preserved',
    liveInputCache: 'not modified',
  },
};
fs.writeFileSync(
  'docs/forecast-followup-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
const compact = (a) =>
  Object.fromEntries(
    Object.entries(a).filter(
      ([k]) => !['rows', 'training', 'details'].includes(k),
    ),
  );
fs.writeFileSync(
  'docs/forecast-followup-results.json',
  JSON.stringify(
    {
      checkedAt: receipt.checkedAt,
      decision:
        'Retain official v3.2 and existing v3.4 trial. Research candidates not activated.',
      adaptive: compact(adaptive),
      persistence: compact(persistence),
      huawei,
      records,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    records,
    observationReadback: receipt.observationReadback,
    rawInverterRecords: huawei.reduce((s, d) => s + d.rawRows, 0),
  }),
);
