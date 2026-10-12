import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { providerHours } from '../lib/forecast-provider-hours.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import { localDate } from '../lib/energy.ts';
const root = 'work/forecast-research/spatial-gfs/',
  read = (p) => JSON.parse(fs.readFileSync(p));
const sha = (p) =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen = read('docs/spatial-gfs-frozen.json');
assert.equal(sha(root + 'inputs.json'), frozen.inputSha256);
for (const [p, h] of Object.entries(frozen.codeHashes))
  assert.equal(sha(p), h, p);
const data = read(root + 'inputs.json'),
  keys = ['v32', 'nearest', 'bilinear', 'mean9'];
function metrics(rows, key) {
  const actual = rows.reduce((s, r) => s + r.actualKwh, 0),
    predicted = rows.reduce((s, r) => s + r[key], 0);
  const absolute = rows.reduce((s, r) => s + Math.abs(r[key] - r.actualKwh), 0);
  return {
    hours: rows.length,
    days: new Set(rows.map((r) => r.date)).size,
    actualMwh: actual / 1000,
    predictedMwh: predicted / 1000,
    wape: (100 * absolute) / actual,
    maeKwh: absolute / rows.length,
    rmseKwh: Math.sqrt(
      rows.reduce((s, r) => s + (r[key] - r.actualKwh) ** 2, 0) / rows.length,
    ),
    biasMwh: (predicted - actual) / 1000,
    biasPercent: (100 * (predicted - actual)) / actual,
  };
}
const scores = (rows) =>
  Object.fromEntries(keys.map((k) => [k, metrics(rows, k)]));
const rows = [],
  runs = [];
let selected;
for (const d of data.days) {
  if (d.date === '2026-10-01') {
    const selection = scores(rows);
    selected = ['bilinear', 'mean9'].sort(
      (a, b) => selection[a].wape - selection[b].wape,
    )[0];
    fs.writeFileSync(
      root + 'selection.json',
      JSON.stringify({
        selected,
        selectedAt: new Date().toISOString(),
        scores: selection,
        period: ['2026-09-21', '2026-09-30'],
      }),
    );
  }
  const weather = new Map(d.weather.map((w) => [w.start, w]));
  const forecasts = {};
  for (const method of ['nearest', 'bilinear', 'mean9']) {
    const fields = d.fields.map((f) => ({
      ...f,
      value: method === 'nearest' ? f.value : f[method],
    }));
    const hours = providerHours(
      new Date(d.runAt).toISOString(),
      fields,
      'gfs',
    ).filter((h) => localDate(h.start) === d.date);
    assert.deepEqual(
      hours.map((h) => h.start),
      d.original.hours.map((h) => h.start),
    );
    forecasts[method] = hours.map((h) => {
      const w = weather.get(h.start);
      assert.ok(w);
      const kwh = Math.min(
        data.config.acKw,
        d.original.gain *
          weatherAdjustedEnergy(
            { ...w, irradiance: h.irradiance, resolutionHours: 1 },
            data.config,
            d.calibration,
          ),
      );
      return { start: h.start, irradiance: h.irradiance, productionKwh: kwh };
    });
  }
  for (const [i, h] of d.original.hours.entries()) {
    assert.ok(
      Math.abs(forecasts.nearest[i].productionKwh - h.nativePhysicsKwh) < 1e-8,
      h.start,
    );
    if (h.clearSky <= 0 && !(h.actualKwh > 0)) continue;
    assert.ok(Number.isFinite(h.actualKwh));
    rows.push({
      date: d.date,
      start: h.start,
      actualKwh: h.actualKwh,
      v32: h.baselineKwh,
      ...Object.fromEntries(
        Object.entries(forecasts).map(([k, v]) => [k, v[i].productionKwh]),
      ),
    });
  }
  runs.push({ date: d.date, forecasts });
}
const allScores = {
  all: scores(rows),
  september: scores(rows.filter((r) => r.date < '2026-10-01')),
  october: scores(rows.filter((r) => r.date >= '2026-10-01')),
};
const gate =
  ['september', 'october'].every((period) =>
    ['v32', 'nearest'].every(
      (base) =>
        allScores[period][selected].wape <= 0.98 * allScores[period][base].wape,
    ),
  ) &&
  ['v32', 'nearest'].every(
    (base) => allScores.all[selected].rmseKwh <= allScores.all[base].rmseKwh,
  );
const daily = [...new Set(rows.map((r) => r.date))].map((date) => ({
  date,
  scores: scores(rows.filter((r) => r.date === date)),
}));
const payload = {
  version: 'solar-spatial-gfs-v1',
  evaluatedAt: new Date().toISOString(),
  inputSha256: frozen.inputSha256,
  selected,
  gate,
  scores: allScores,
  daily,
  rows,
};
fs.writeFileSync(root + 'runs.json', JSON.stringify(runs));
fs.writeFileSync('docs/spatial-gfs-evaluation.json', JSON.stringify(payload));
console.log(JSON.stringify({ selected, gate, scores: allScores }, null, 2));
