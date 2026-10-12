// Score all fixed candidates on one common mask; no model training or tuning.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'work/forecast-research/timesfm/';
const hash = (p) =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p));
const frozen = read('docs/timesfm-frozen.json');
assert.equal(hash(root + 'inputs.json'), frozen.inputSha256);
assert.equal(hash(root + 'targets.json'), frozen.targetsSha256);
for (const [p, sha] of Object.entries(frozen.codeHashes))
  assert.equal(hash(p), sha);
const { targets } = read(root + 'targets.json'),
  data = read(root + 'predictions.json');
assert.equal(data.results.length, frozen.folds);
const all = new Map(
  data.results.flatMap((d) => d.hours.map((h) => [d.date + '/' + h.start, h])),
);
const keys = [
  'baselineKwh',
  'persistenceKwh',
  'timesfmKwh',
  'timesfmWeatherKwh',
  'blendKwh',
];
const rows = targets
  .filter(
    (t) =>
      Number.isFinite(t.actualKwh) &&
      t.actualKwh >= 0 &&
      (t.clearSky > 0 || t.actualKwh > 0),
  )
  .map((t) => {
    const pred = all.get(t.date + '/' + t.start);
    assert.ok(
      pred && keys.every((k) => Number.isFinite(pred[k]) && pred[k] >= 0),
      t.start,
    );
    return { ...t, ...pred };
  });
function score(rs, key) {
  if (!rs.length) return null;
  const actual = rs.reduce((s, r) => s + r.actualKwh, 0),
    predicted = rs.reduce((s, r) => s + r[key], 0),
    absolute = rs.reduce((s, r) => s + Math.abs(r.actualKwh - r[key]), 0),
    square = rs.reduce((s, r) => s + (r.actualKwh - r[key]) ** 2, 0),
    wape = actual > 0 ? (absolute / actual) * 100 : null;
  return {
    days: new Set(rs.map((r) => r.date)).size,
    hours: rs.length,
    actualMwh: actual / 1000,
    predictedMwh: predicted / 1000,
    absoluteErrorMwh: absolute / 1000,
    differenceMwh: (predicted - actual) / 1000,
    wapePercent: wape,
    matchPercent: wape === null ? null : Math.max(0, 100 - wape),
    maeKwh: absolute / rs.length,
    rmseKwh: Math.sqrt(square / rs.length),
  };
}
const scores = (rs) => Object.fromEntries(keys.map((k) => [k, score(rs, k)]));
const dates = data.results.map((r) => r.date),
  days = dates.map((date) => ({
    date,
    scores: scores(rows.filter((r) => r.date === date)),
  }));
let seed = 42;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const differences = Object.fromEntries(keys.slice(1).map((k) => [k, []]));
const byDate = new Map(dates.map((d) => [d, rows.filter((r) => r.date === d)]));
for (let i = 0; i < 2000; i++) {
  const sample = dates.flatMap(() =>
    byDate.get(dates[Math.floor(random() * dates.length)]),
  );
  const baseline = score(sample, 'baselineKwh').wapePercent;
  for (const k of keys.slice(1))
    differences[k].push(score(sample, k).wapePercent - baseline);
}
const pairedBootstrap = Object.fromEntries(
  Object.entries(differences).map(([k, values]) => {
    values.sort((a, b) => a - b);
    return [
      k,
      {
        replicates: 2000,
        lower95PercentagePoints: values[49],
        upper95PercentagePoints: values[1949],
        dailyWins: days.filter(
          (d) => d.scores[k]?.wapePercent < d.scores.baselineKwh?.wapePercent,
        ).length,
        dailyLosses: days.filter(
          (d) => d.scores[k]?.wapePercent > d.scores.baselineKwh?.wapePercent,
        ).length,
      },
    ];
  }),
);
const summary = {
  evaluatedAt: new Date().toISOString(),
  method: 'retrospective-day-ahead-fixed-candidates',
  from: dates[0],
  to: dates.at(-1),
  source:
    'Google TimesFM 2.5 200M; causal Huawei revision context; original archived NOAA GFS forecasts',
  horizon:
    'issued previous day 18:00 UTC; target local day 00:00–24:00; 4–28h lead',
  independentHoldout: false,
  metadata: data.metadata,
  coverage: {
    folds: dates.length,
    excluded: frozen.excluded,
    deliveryHours: targets.length,
    pairedDaylightHours: rows.length,
    missingDaylightTargets: targets.filter(
      (t) => t.clearSky > 0 && t.actualKwh === null,
    ).length,
    measuredZeroDaylightHours: rows.filter(
      (r) => r.clearSky > 0 && r.actualKwh === 0,
    ).length,
  },
  totals: scores(rows),
  months: Object.fromEntries(
    ['2026-09', '2026-10'].map((m) => [
      m,
      scores(rows.filter((r) => r.date.startsWith(m))),
    ]),
  ),
  regimes: Object.fromEntries(
    ['sunny', 'variable', 'cloudy-mixed'].map((regime) => [
      regime,
      scores(rows.filter((r) => r.regime === regime)),
    ]),
  ),
  days,
  pairedBootstrap,
  inputSha256: frozen.inputSha256,
  targetSha256: frozen.targetsSha256,
  predictionsSha256: hash(root + 'predictions.json'),
  limitations: [
    'Dates were already used in previous model research; not independent prospective evidence.',
    'GFS historical weather is from the original three-hour-resolution source; target scoring remains hourly.',
    'Night input zeros and rare daylight input medians are marked inference-only imputations; target gaps are never filled.',
    'Forecast-derived sky regimes are diagnostic labels, not observed weather.',
    'Bootstrap is exploratory; 21 serially correlated days do not establish production superiority.',
    'Solar DC capacity and panel orientation remain unknown; no weights or geometry were fitted on these target scores.',
  ],
};
fs.writeFileSync(
  root + 'evaluation.json',
  JSON.stringify({ ...summary, rows }, null, 2) + '\n',
);
fs.writeFileSync(
  'docs/timesfm-evaluation.json',
  JSON.stringify(summary, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      coverage: summary.coverage,
      totals: summary.totals,
      october: summary.months['2026-10'],
      october11: days.at(-1),
      bootstrap: pairedBootstrap,
    },
    null,
    2,
  ),
);
