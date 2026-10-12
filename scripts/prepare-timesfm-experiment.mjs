// Assemble a causal replay without invoking TimesFM or using target values in inference.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { backtestOrigin, reconstructDay } from '../lib/forecast-backtest.ts';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';
import { clearSkyIrradiance } from '../lib/forecast-solar.ts';
import { slotsForDay, localDate } from '../lib/energy.ts';

const root = 'work/forecast-research/',
  out = root + 'timesfm/';
const hashes = {};
const hash = (v) => createHash('sha256').update(v).digest('hex');
const read = (p) => {
  const bytes = fs.readFileSync(p);
  hashes[p] = hash(bytes);
  return JSON.parse(bytes);
};
const source = read(out + 'source.json');
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
const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
};
const candidates = [],
  targets = [],
  excluded = [];
for (
  let t = Date.parse('2026-09-21');
  t <= Date.parse('2026-10-11');
  t += 86400000
) {
  const date = stamp(t).slice(0, 10),
    originAt = backtestOrigin(date).originAt,
    origin = Date.parse(originAt);
  const known = knownAt(origin),
    context = [],
    future = [],
    issues = [];
  let daylight = 0,
    imputedDaylight = 0;
  const priorSameHour = (time) =>
    Array.from({ length: 14 }, (_, i) =>
      known.get(stamp(time - (i + 1) * 86400000)),
    ).filter(
      (r) => r && Number.isFinite(r.productionKwh) && r.productionKwh >= 0,
    );
  for (
    let s = origin - 240 * 3600000;
    s < origin + 28 * 3600000;
    s += 3600000
  ) {
    const start = stamp(s),
      clear = clearSkyIrradiance(start, c),
      w = weather.get(start);
    assert.ok(
      w && Date.parse(w.originAt) <= origin && w.radiationRunAt < originAt,
      'Weather availability ' + start,
    );
    assert.ok(Number.isFinite(clear));
    const angle = (2 * Math.PI * (new Date(s).getUTCHours() + 0.5)) / 24;
    const covariates = {
      ghi: w.irradiance,
      clearSky: clear,
      temperature: w.temperature,
      cloudCover: w.cloudCover,
      windSpeed: w.windSpeed,
      hourSin: Math.sin(angle),
      hourCos: Math.cos(angle),
    };
    assert.ok(Object.values(covariates).every(Number.isFinite));
    const row = {
      start,
      clearSky: clear,
      covariates,
      weatherOriginAt: w.originAt,
      weatherRunAt: w.radiationRunAt,
    };
    if (s < origin) {
      if (clear > 0) daylight++;
      const r = known.get(start);
      if (r && Number.isFinite(r.productionKwh) && r.productionKwh >= 0)
        context.push({
          ...row,
          value: r.productionKwh,
          fill: 'measured',
          revisionId: r.id,
          receivedAt: r.observedAt,
        });
      else if (clear === 0)
        context.push({ ...row, value: 0, fill: 'astronomical-night' });
      else {
        imputedDaylight++;
        const priors = priorSameHour(s);
        if (priors.length < 3)
          issues.push('Insufficient same-hour history at ' + start);
        context.push({
          ...row,
          value: priors.length
            ? median(priors.map((r) => r.productionKwh))
            : null,
          fill: 'prior-same-hour-median',
          sourceRevisionIds: priors.map((r) => r.id),
        });
      }
    } else {
      const persistenceRows = priorSameHour(s);
      if (!persistenceRows.length && clear > 0)
        issues.push('Missing persistence context at ' + start);
      future.push({
        ...row,
        baselineKwh: baseline.get(start),
        persistenceKwh:
          clear === 0 ? 0 : (persistenceRows[0]?.productionKwh ?? null),
      });
    }
  }
  assert.equal(context.length, 240);
  assert.equal(future.length, 28);
  assert.deepEqual(
    future.filter((h) => localDate(h.start) === date).map((h) => h.start),
    slotsForDay(date).map((h) => h.start),
  );
  if (imputedDaylight / daylight > 0.1)
    issues.push('Over 10% daylight context imputed');
  if (issues.length) {
    excluded.push({ date, issues });
    continue;
  }
  const delivered = future.filter((h) => localDate(h.start) === date);
  const clouds = delivered
    .filter((h) => h.clearSky > 0)
    .map((h) => h.covariates.cloudCover);
  const meanCloud = clouds.reduce((a, b) => a + b, 0) / clouds.length,
    cloudRange = Math.max(...clouds) - Math.min(...clouds);
  const regime =
    meanCloud <= 30 && cloudRange <= 40
      ? 'sunny'
      : cloudRange >= 50
        ? 'variable'
        : 'cloudy-mixed';
  candidates.push({
    date,
    originAt,
    context,
    future,
    quality: {
      daylight,
      imputedDaylight,
      nightFilled: context.filter((h) => h.fill === 'astronomical-night')
        .length,
    },
    regime,
    meanCloud,
    cloudRange,
  });
  targets.push(
    ...delivered.map((h) => ({
      date,
      start: h.start,
      actualKwh: actual.get(h.start) ?? null,
      clearSky: h.clearSky,
      regime,
    })),
  );
}
const codePaths = [
  'scripts/export-timesfm-inputs.mjs',
  'scripts/prepare-timesfm-experiment.mjs',
  'scripts/run-timesfm-experiment.py',
  'scripts/score-timesfm-experiment.mjs',
  'lib/forecast-backtest.ts',
  'lib/forecast-hourly-calibration.ts',
  'lib/forecast-solar.ts',
];
const codeHashes = Object.fromEntries(
  codePaths.map((p) => [p, hash(fs.readFileSync(p))]),
);
const inputs = {
  preparedAt: new Date().toISOString(),
  config: c,
  from: '2026-09-21',
  to: '2026-10-11',
  contextHours: 240,
  horizonHours: 28,
  candidates,
  excluded,
  sourceHashes: hashes,
  codeHashes,
  protocolSha256: hash(fs.readFileSync('docs/timesfm-experiment-plan.md')),
};
fs.writeFileSync(out + 'inputs.json', JSON.stringify(inputs));
fs.writeFileSync(
  out + 'targets.json',
  JSON.stringify({ exportedAt: source.exportedAt, targets }),
);
const frozen = {
  preparedAt: inputs.preparedAt,
  protocolSha256: inputs.protocolSha256,
  inputSha256: hash(fs.readFileSync(out + 'inputs.json')),
  targetsSha256: hash(fs.readFileSync(out + 'targets.json')),
  codeHashes,
  folds: candidates.length,
  excluded,
  quality: candidates.map(({ date, quality, regime }) => ({
    date,
    ...quality,
    regime,
  })),
};
fs.writeFileSync(
  'docs/timesfm-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
console.log(JSON.stringify(frozen, null, 2));
