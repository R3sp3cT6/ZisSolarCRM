// Independent audit of temporal cutoffs, imputation provenance, bounds and metrics.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { clearSkyIrradiance } from '../lib/forecast-solar.ts';
const root = 'work/forecast-research/timesfm/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const hash = (p) =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const source = read(root + 'source.json'),
  inputs = read(root + 'inputs.json'),
  predictions = read(root + 'predictions.json'),
  evaluation = read(root + 'evaluation.json');
const revisions = new Map(source.revisions.map((r) => [r.id, r]));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
assert.equal(evaluation.independentHoldout, false);
assert.equal(inputs.candidates.length, 21);
assert.equal(predictions.results.length, inputs.candidates.length);
assert.equal(predictions.metadata.inputSha256, hash(root + 'inputs.json'));
assert.equal(evaluation.predictionsSha256, hash(root + 'predictions.json'));
const publisher = read(root + 'download-receipts.json').find(
  (a) => a.asset === 'model.safetensors',
);
assert.equal(predictions.metadata.weightsSha256, publisher.sha256);
let measured = 0,
  nightFilled = 0,
  dayFilled = 0,
  forecastHours = 0;
for (const fold of inputs.candidates) {
  const origin = Date.parse(fold.originAt);
  for (const h of fold.context) {
    assert.ok(Date.parse(h.start) + 3600000 <= origin);
    assert.ok(Date.parse(h.weatherOriginAt) <= origin);
    assert.ok(Date.parse(h.weatherRunAt) < origin);
    if (h.fill === 'measured') {
      const r = revisions.get(h.revisionId);
      assert.ok(r && Date.parse(r.observedAt) < origin);
      assert.ok(Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt));
      assert.equal(new Date(r.start).toISOString(), h.start);
      close(h.value, r.productionKwh);
      measured++;
    } else if (h.fill === 'astronomical-night') {
      assert.equal(clearSkyIrradiance(h.start, inputs.config), 0);
      assert.equal(h.value, 0);
      nightFilled++;
    } else {
      assert.equal(h.fill, 'prior-same-hour-median');
      const rs = h.sourceRevisionIds.map((id) => revisions.get(id));
      assert.ok(rs.length >= 3);
      for (const r of rs) {
        assert.ok(Date.parse(r.observedAt) < origin);
        assert.ok(Date.parse(r.start) < Date.parse(h.start));
        assert.equal(
          new Date(r.start).getUTCHours(),
          new Date(h.start).getUTCHours(),
        );
      }
      const sorted = rs.map((r) => r.productionKwh).sort((a, b) => a - b);
      close(
        h.value,
        (sorted[Math.floor((sorted.length - 1) / 2)] +
          sorted[Math.floor(sorted.length / 2)]) /
          2,
      );
      dayFilled++;
    }
  }
  const result = predictions.results.find((r) => r.date === fold.date);
  assert.equal(result.originAt, fold.originAt);
  assert.equal(result.hours.length, 28);
  for (let i = 0; i < 28; i++) {
    const h = result.hours[i],
      future = fold.future[i];
    assert.equal(h.start, new Date(origin + i * 3600000).toISOString());
    assert.equal(h.start, future.start);
    for (const [key, raw] of [
      ['timesfmKwh', 'rawTimesfmKwh'],
      ['timesfmWeatherKwh', 'rawTimesfmWeatherKwh'],
    ]) {
      assert.ok(Number.isFinite(h[raw]));
      close(
        h[key],
        future.clearSky > 0 ? Math.min(875, Math.max(0, h[raw])) : 0,
      );
    }
    close(
      h.blendKwh,
      future.clearSky > 0 ? (h.timesfmWeatherKwh + h.baselineKwh) / 2 : 0,
    );
    forecastHours++;
  }
}
for (const [key, score] of Object.entries(evaluation.totals)) {
  const numerator = evaluation.rows.reduce(
    (s, r) => s + Math.abs(r[key] - r.actualKwh),
    0,
  );
  const denominator = evaluation.rows.reduce((s, r) => s + r.actualKwh, 0);
  close(score.wapePercent, (100 * numerator) / denominator);
  close(score.actualMwh, denominator / 1000);
  assert.equal(score.hours, evaluation.rows.length);
  for (const r of evaluation.rows)
    assert.ok(r.actualKwh !== null && r.actualKwh >= 0);
}
const receipt = {
  checkedAt: new Date().toISOString(),
  status: 'passed',
  folds: inputs.candidates.length,
  forecastHours,
  pairedHours: evaluation.rows.length,
  inputContexts: { measured, nightFilled, dayFilled },
  checks: [
    'All input revision receipts precede issue time; all source intervals complete',
    'Median fill uses at least three prior same-hour observations; only astronomical nights get physical zeros',
    'Weather original run and replay issuance precede prediction cutoff',
    'All 21 days and 28 horizons present; original model weight SHA256 matches publisher',
    'Fixed physical constraints and 50:50 combination independently verified',
    'WAPE recomputed independently on identical actual hours for every method',
  ],
  predictionsSha256: evaluation.predictionsSha256,
};
fs.writeFileSync(
  'docs/timesfm-verification.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt, null, 2));
