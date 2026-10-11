// Append-only research archive. Does not change forecast_runs, chart replays,
// measurements, cache or deployed models. Uses the maintenance DB connection.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import { localDate, slotsForDay } from '../lib/energy.ts';
import { addDays } from '../lib/forecast-model.ts';
import { TRIAL_VERSION } from '../lib/forecast-trial.ts';

const root = 'work/forecast-research/';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const payload = read(root + 'multimodel-evaluation.json');
const sources = Object.fromEntries(
  Object.entries(payload.inputHashes).map(([p, sha]) => {
    assert.equal(hash(fs.readFileSync(p)), sha);
    return [p, read(p)];
  }),
);
function verifyPackages(source, stamp) {
  for (const file of source.files) {
    const chunk = new URL(file.url).pathname.split('__')[3];
    assert.equal(
      hash(fs.readFileSync(root + 'arpege/' + stamp + '/' + chunk + '.grib2')),
      file.sha256,
    );
  }
}
verifyPackages(sources[root + 'arpege/2026101018/source.json'], '2026101018');
const codePaths = [
  'scripts/download-arpege-research.py',
  'scripts/evaluate-multimodel.mjs',
  'scripts/save-multimodel.mjs',
  'lib/forecast-solar.ts',
];
const sourceCode = Object.fromEntries(
  codePaths.map((p) => [p, fs.readFileSync(p, 'utf8')]),
);
const inputs = {
  sources,
  sourceCode,
  protocol: fs.readFileSync('docs/forecast-multimodel-plan.md', 'utf8'),
};
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
async function save(version, payload, inputs) {
  const id =
    version + '-' + hash(JSON.stringify({ payload, inputs })).slice(0, 20);
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
  return { id, readback: 'exact' };
}
const diagnostic = await save(
  'three-model-radiation-diagnostic-v1',
  payload,
  inputs,
);
// Freeze a separate, genuinely prospective ARPEGE candidate for tomorrow.
// This is one research snapshot, not a recurring operational integration.
const future = read(root + 'arpege/2026101112/source.json');
verifyPackages(future, '2026101112');
const prior = await db()
  .prepare(
    "SELECT id,payload,inputs FROM forecast_trials WHERE owner=? AND kind='day-ahead' AND model_version=? ORDER BY issued_at DESC LIMIT 1",
  )
  .bind(owner, TRIAL_VERSION)
  .first();
assert.ok(prior?.inputs?.context);
const context = prior.inputs.context;
const now = new Date(),
  tomorrow = addDays(localDate(now), 1);
assert.ok(Date.parse(context.issuedAt) <= now.getTime());
assert.ok(now.getTime() - Date.parse(context.issuedAt) < 18 * 3600000);
assert.ok(Date.parse(future.runAt) <= now.getTime());
assert.ok(now.getTime() - Date.parse(future.runAt) < 18 * 3600000);
assert.equal(context.config.latitude, future.site.latitude);
assert.equal(context.config.longitude, future.site.longitude);
for (const file of future.files) {
  assert.ok(Date.parse(file.receivedAt) <= now.getTime());
  assert.ok(Date.parse(file.lastModified) <= Date.parse(file.receivedAt));
}
const weather = new Map(context.hours.map((h) => [h.start, h]));
const hours = future.hours.flatMap((h) => {
  const start = new Date(h.start).toISOString(),
    old = weather.get(start);
  if (localDate(start) !== tomorrow) return [];
  assert.ok(old?.weather && Date.parse(start) > now.getTime());
  const predictedKwh = weatherAdjustedEnergy(
    {
      ...old.weather,
      start,
      irradiance: h.irradiance,
      irradianceKind: 'modeled-ghi',
      resolutionHours: 1,
      cloudCover: null,
    },
    context.config,
    context.calibration,
  );
  assert.ok(Number.isFinite(predictedKwh) && predictedKwh >= 0);
  return [
    {
      start,
      predictedKwh,
      ghi: h.irradiance,
      comparisonIconKwh: old.iconKwh,
      comparisonV32Kwh: old.baselineKwh,
    },
  ];
});
assert.deepEqual(
  hours.map((h) => h.start),
  slotsForDay(tomorrow).map((h) => h.start),
);
const prospectivePayload = {
  date: tomorrow,
  issuedAt: now.toISOString(),
  kind: 'prospective-research-only',
  modelVersion: 'arpege-hourly-plant-v1',
  configVersion: context.config.version,
  weatherRunAt: future.runAt,
  comparisonTrialId: prior.id,
  comparisonIssuedAt: context.issuedAt,
  comparisonIconRunAt: context.weatherRunAt,
  note: 'Original hourly ARPEGE radiation with already available MET thermal inputs and plant calibration. Comparison models retain their own origins; not a controlled same-cycle comparison. Not active in the CRM forecast.',
  hours,
};
const prospective = await save(
  'arpege-hourly-prospective-v1',
  prospectivePayload,
  { source: future, context, comparison: prior, sourceCode },
);
const receipt = {
  checkedAt: new Date().toISOString(),
  diagnostic,
  prospective,
  prospectiveDate: tomorrow,
  prospectiveHours: hours.length,
  prospectiveArpegeMwh: hours.reduce((s, h) => s + h.predictedKwh, 0) / 1000,
  productionModelsChanged: false,
  automaticProviderCollectionAdded: false,
};
fs.writeFileSync(
  'docs/multimodel-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
fs.writeFileSync(
  'docs/multimodel-evaluation.json',
  JSON.stringify(payload, null, 2) + '\n',
);
fs.writeFileSync(
  'docs/arpege-prospective.json',
  JSON.stringify(prospectivePayload, null, 2) + '\n',
);
console.log(JSON.stringify(receipt, null, 2));
