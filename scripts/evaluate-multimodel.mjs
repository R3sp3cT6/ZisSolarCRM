// Controlled radiation-source comparison on an already inspected day.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';

const root = 'work/forecast-research/';
const paths = [
  root + 'original-weather-evaluation.json',
  root + 'satellite-evaluation-inputs.json',
  root + 'arpege/2026101018/source.json',
];
const [original, input, arpege] = paths.map((p) =>
  JSON.parse(fs.readFileSync(p, 'utf8')),
);
const base = original.hourly.find((r) => r.stamp === '2026101018');
assert.equal(Date.parse(arpege.runAt), Date.parse(base.runAt));
for (const file of arpege.files) {
  assert.ok(Date.parse(file.lastModified) <= Date.parse(base.availableAt));
}
const day = input.replay.inputs.days.find((d) => d.date === original.date);
const ghi = new Map(
  arpege.hours.map((h) => [new Date(h.start).toISOString(), h.irradiance]),
);
const weather = new Map(day.weather.map((w) => [w.start, w]));
const models = [
  'icon',
  'gfs',
  'arpege',
  'meanThree',
  'medianThree',
  'meanIconArpege',
  'v32',
];
const rows = base.rows.flatMap((r) => {
  if (
    Date.parse(r.start) < Date.parse(base.availableAt) ||
    r.actualKwh == null ||
    r.iconKwh == null ||
    r.gfsKwh == null ||
    !ghi.has(r.start) ||
    !weather.has(r.start)
  )
    return [];
  const a = weatherAdjustedEnergy(
    { ...weather.get(r.start), irradiance: ghi.get(r.start) },
    input.replay.inputs.config,
    day.calibration,
  );
  assert.ok(a !== null && Number.isFinite(a));
  const values = [r.iconKwh, r.gfsKwh, a];
  // Identical eligible hours for all models, including valid daylight zeros.
  // Ignore only floating-point night residue (e.g. 1e-14 kWh), not small
  // measured output or real zero-production hours with meaningful forecasts.
  if (
    r.actualKwh === 0 &&
    values.every((v) => Math.abs(v) < 1e-9) &&
    r.v32Kwh === 0
  )
    return [];
  return [
    {
      start: r.start,
      actualKwh: r.actualKwh,
      icon: r.iconKwh,
      gfs: r.gfsKwh,
      arpege: a,
      meanThree: values.reduce((s, v) => s + v, 0) / 3,
      medianThree: values.toSorted((x, y) => x - y)[1],
      meanIconArpege: (r.iconKwh + a) / 2,
      v32: r.v32Kwh,
    },
  ];
});
assert.ok(rows.length > 0);
const actualKwh = rows.reduce((s, r) => s + r.actualKwh, 0);
assert.ok(actualKwh > 0);
const scores = Object.fromEntries(
  models.map((model) => {
    const errors = rows.map((r) => r[model] - r.actualKwh);
    const absolute = errors.reduce((s, e) => s + Math.abs(e), 0);
    const difference = errors.reduce((s, e) => s + e, 0);
    const wape = (100 * absolute) / actualKwh;
    return [
      model,
      {
        hours: rows.length,
        actualKwh,
        predictedKwh: rows.reduce((s, r) => s + r[model], 0),
        wapePercent: wape,
        matchPercent: Math.max(0, 100 - wape),
        maeKwh: absolute / rows.length,
        rmseKwh: Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / rows.length),
        totalDifferenceKwh: difference,
        totalDifferencePercent: (100 * difference) / actualKwh,
      },
    ];
  }),
);
const payload = {
  checkedAt: new Date().toISOString(),
  date: original.date,
  kind: 'three-original-model-diagnostic-not-independent',
  runAt: base.runAt,
  availableAt: base.availableAt,
  plant: input.replay.inputs.config,
  note: 'Same radiation-to-production conversion and common hours; no fitted weights. v3.2 uses an older origin/gain. Not a holdout or future accuracy.',
  scores,
  rows,
  arpege: {
    gridDegrees: arpege.gridDegrees,
    resolutionHours: arpege.resolutionHours,
    latitude: arpege.points[0].latitude,
    longitude: arpege.points[0].longitude,
    distanceKm: arpege.points[0].distanceKm,
    negativeQuantizationClampedWhM2: arpege.negativeQuantizationClampedWhM2,
    files: arpege.files,
  },
  inputHashes: Object.fromEntries(
    paths.map((p) => [
      p,
      createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
    ]),
  ),
};
fs.writeFileSync(
  root + 'multimodel-evaluation.json',
  JSON.stringify(payload, null, 2) + '\n',
);
console.log(JSON.stringify({ date: payload.date, scores }, null, 2));
