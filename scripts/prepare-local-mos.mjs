import { mosFeatures } from '../lib/forecast-local-mos.ts';
// Assemble a causal replay without invoking TimesFM or using target values in inference.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { backtestOrigin, reconstructDay } from '../lib/forecast-backtest.ts';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';

const root = 'work/forecast-research/',
  out = root + 'local-mos/';
const hashes = {};
const hash = (v) => createHash('sha256').update(v).digest('hex');
const read = (p) => {
  const bytes = fs.readFileSync(p);
  hashes[p] = hash(bytes);
  return JSON.parse(bytes);
};
const source = read(root + 'timesfm/source.json');
const c = source.config;
assert.equal(c.acKw, 875);
const stamp = (s) => new Date(s).toISOString();
const revisions = source.revisions
  .map((r) => ({
    ...r,
    start: stamp(r.start),
    observedAt: stamp(r.observedAt),
  }))
  .sort(
    (a, b) =>
      a.observedAt.localeCompare(b.observedAt) ||
      String(a.id).localeCompare(String(b.id)),
  );
const actual = new Map(
  source.actual.map((r) => [stamp(r.start), r.productionKwh]),
);
function knownAt(origin) {
  const known = new Map();
  for (const r of revisions)
    if (
      Date.parse(r.observedAt) < origin &&
      Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
    )
      known.set(r.start, r);
  return known;
}
const archiveDays = [];
for (
  let t = Date.parse('2026-09-09');
  t <= Date.parse('2026-09-30');
  t += 86400000
) {
  const date = stamp(t).slice(0, 10),
    archive = read(root + 'gfs-september/' + date + '.json');
  archive.radiation = read(
    root + 'gfs-september-radiation/' + date + '-radiation.json',
  );
  const origin = Date.parse(backtestOrigin(date).originAt);
  const readings = [...knownAt(origin).values()].map((r) => ({
    start: r.start,
    production_kwh: r.productionKwh,
    export_kwh: null,
  }));
  archiveDays.push({ ...reconstructDay(archive, readings, c), date });
}
const septemberPredictions = archiveDays.flatMap((d) =>
  d.day.hours.map((h) => ({
    start: h.start,
    baseKwh: h.productionKwh,
    originAt: h.originAt,
    source: 'historical',
  })),
);
for (const d of archiveDays)
  d.gain = calibrateHourly(
    septemberPredictions,
    revisions,
    new Date(backtestOrigin(d.date).originAt),
    c.acKw,
  ).factor;
const october = read(root + 'satellite-replay-full.json');
const octoberPredictions = october.inputs.replay.payload.days.flatMap((d) =>
  d.hours.map((h) => ({
    start: h.start,
    baseKwh: h.productionKwh,
    originAt: h.originAt,
    source: 'historical',
  })),
);
for (const d of october.inputs.replay.payload.days) {
  const inputs = october.inputs.replay.inputs.days.find(
    (x) => x.date === d.date,
  );
  const gain = calibrateHourly(
    octoberPredictions,
    october.inputs.revisions,
    new Date(backtestOrigin(d.date).originAt),
    c.acKw,
  ).factor;
  archiveDays.push({ date: d.date, day: d, inputs, gain });
}
const weather = new Map(),
  baseline = new Map();
for (const d of archiveDays) {
  const originAt = backtestOrigin(d.date).originAt;
  for (const w of d.inputs.weather) weather.set(w.start, { ...w, originAt });
  for (const h of d.day.hours)
    baseline.set(h.start, Math.min(c.acKw, h.productionKwh * d.gain));
}
// Ensure the baseline is exactly the previously archived model, not a new fit.
for (const row of october.audit.rows)
  assert.ok(
    Math.abs(baseline.get(row.start) - row.baselineKwh) < 1e-7,
    row.start,
  );
for (const row of read(root + 'response-holdout.json').rows)
  assert.ok(Math.abs(baseline.get(row.start) - row.v32) < 1e-7, row.start);

const days = archiveDays.map((d) => ({
  date: d.date,
  originAt: backtestOrigin(d.date).originAt,
  hours: d.inputs.weather.map((w) => ({
    start: w.start,
    originAt: backtestOrigin(d.date).originAt,
    baseKwh: baseline.get(w.start),
    ...mosFeatures(w.start, w.irradiance, c),
    weather: w,
    actualKwh: actual.get(w.start) ?? null,
  })),
}));
fs.mkdirSync(out, { recursive: true });
const payload = {
  config: c,
  revisions,
  days,
  sourceHashes: hashes,
  preparedAt: new Date().toISOString(),
};
fs.writeFileSync(out + 'inputs.json', JSON.stringify(payload));
const paths = [
  'lib/forecast-local-mos.ts',
  'scripts/prepare-local-mos.mjs',
  'scripts/evaluate-local-mos.mjs',
  'docs/forecast-local-mos-plan.md',
];
const frozen = {
  frozenAt: new Date().toISOString(),
  inputSha256: hash(fs.readFileSync(out + 'inputs.json')),
  codeHashes: Object.fromEntries(
    paths.map((p) => [p, hash(fs.readFileSync(p))]),
  ),
};
fs.writeFileSync(
  'docs/local-mos-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    days: days.length,
    from: days[0].date,
    to: days.at(-1).date,
    frozen,
  }),
);
