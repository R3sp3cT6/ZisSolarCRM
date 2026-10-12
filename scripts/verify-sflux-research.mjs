// Independent feature arithmetic, chronological cohorts and hourly error metrics.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'work/forecast-research/sflux/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen = read('docs/sflux-research-frozen.json');
assert.equal(hash(root + 'inputs.json'), frozen.inputSha256);
const inputs = read(root + 'inputs.json'), data = inputs.data;
const evaluation = read('docs/sflux-research-evaluation.json'), runs = read(root + 'runs.json');
const oldRuns = read('work/forecast-research/full-history/runs.json');
const oldEvaluation = read('docs/full-history-evaluation.json');
assert.equal(hash('work/forecast-research/full-history/runs.json'), inputs.originalRunsSha256);
assert.equal(hash('docs/full-history-evaluation.json'), inputs.originalEvaluationSha256);
const methods = ['coarseGhi', 'nativeGhi', 'nativePartitionTemperature'];
assert.deepEqual(evaluation.methods, methods);
const close = (a, b) => {
  if (a === null || b === null) assert.equal(a, b);
  else assert.ok(Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
};
const sourceMap = new Map(inputs.sources.map((s) => [s.date, s]));
const newDayMap = new Map(inputs.days.map((d) => [d.date, d]));
const dayMap = new Map(data.days.map((d) => [d.date, d]));
const featureMap = new Map(data.days.flatMap((d) => d.hours.map((h) => [h.start, { ...h, date: d.date, originAt: d.originAt }])));
assert.equal(sourceMap.size, data.days.length);
assert.equal(newDayMap.size, data.days.length);
let featuresChecked = 0;
for (const day of data.days) {
  const source = sourceMap.get(day.date), prepared = newDayMap.get(day.date);
  const run = Date.parse(source.runAt), cutoff = Date.parse(source.originAt);
  assert.equal(run, Date.parse(day.runAt)); assert.equal(cutoff, Date.parse(day.originAt));
  assert.equal(cutoff - run, 6 * 3600000);
  const fields = new Map(source.fields.map((f) => [f.variable + ':' + f.endLead, f]));
  assert.equal(fields.size, 112);
  for (const f of source.fields) {
    assert.ok(Date.parse(f.lastModified) <= cutoff && Date.parse(f.indexLastModified) <= cutoff);
    assert.ok(Date.parse(f.receivedAt) > cutoff && f.distanceKm < 25);
  }
  function average(variable, lead) {
    const current = fields.get(variable + ':' + (lead + 1));
    if (!current) return null;
    const duration = current.endLead - current.startLead;
    const previous = fields.get(variable + ':' + lead);
    if (duration > 1 && (!previous || previous.startLead !== current.startLead)) return null;
    assert.equal(current.units, 'W m**-2'); assert.equal(current.stepType, 'avg');
    const raw = current.value * duration - (duration > 1 ? previous.value * (duration - 1) : 0);
    assert.ok(raw >= -0.5 && raw <= 1800);
    return raw;
  }
  const hourly = new Map();
  for (let lead = 6; lead < 34; lead++) {
    const rawGhi = average('DSWRF', lead), visible = average('VDDSF', lead), infrared = average('NDDSF', lead);
    const left = fields.get('TMP:' + lead), right = fields.get('TMP:' + (lead + 1));
    if ([rawGhi, visible, infrared].includes(null) || !left || !right) continue;
    assert.ok(visible + infrared >= -0.5 && visible + infrared <= rawGhi + 0.5);
    const ghi = Math.max(0, rawGhi), diffuse = Math.max(0, Math.min(ghi, visible + infrared));
    assert.equal(left.units, 'K'); assert.equal(right.units, 'K');
    assert.equal(left.stepType, 'instant'); assert.equal(right.stepType, 'instant');
    hourly.set(new Date(run + lead * 3600000).toISOString(), { ghi, diffuse, temperature: (left.value + right.value) / 2 - 273.15 });
  }
  assert.deepEqual(prepared.hours.map((h) => h.start), day.hours.map((h) => h.start));
  const selected = day.hours.map((h) => hourly.get(h.start));
  assert.ok(selected.every(Boolean));
  const total = selected.reduce((sum, h) => sum + h.ghi, 0) / 10000;
  const peak = Math.max(...selected.map((h) => h.ghi)) / 1000;
  prepared.hours.forEach((p, i) => {
    const old = day.hours[i], h = selected[i];
    const previous = hourly.get(new Date(Date.parse(p.start) - 3600000).toISOString());
    const next = hourly.get(new Date(Date.parse(p.start) + 3600000).toISOString());
    if (old.clearSky > 0) assert.ok(previous && next);
    assert.deepEqual(p.coarseGhi, old.values);
    const expected = [...old.values];
    expected[0] = h.ghi / 1000; expected[1] = (previous?.ghi ?? 0) / 1000; expected[2] = (next?.ghi ?? 0) / 1000;
    expected[4] = old.clearSky > 20 ? Math.min(2, h.ghi / old.clearSky) : 0;
    expected[12] = total; expected[13] = peak;
    assert.equal(p.nativeGhi.length, 14);
    expected.forEach((x, j) => close(p.nativeGhi[j], x));
    const rich = [...expected, h.diffuse / 1000, (h.ghi - h.diffuse) / 1000, h.ghi > 20 ? h.diffuse / h.ghi : 0, h.temperature / 50];
    assert.equal(p.nativePartitionTemperature.length, 18);
    rich.forEach((x, j) => close(p.nativePartitionTemperature[j], x));
    close(p.ghi, h.ghi); close(p.diffuse, h.diffuse); close(p.temperature, h.temperature); close(p.beamHorizontal, h.ghi - h.diffuse);
    featuresChecked++;
  });
}
function score(rows, method, saved) {
  if (!rows.length) { assert.equal(saved, null); return; }
  let actual = 0, predicted = 0, absolute = 0, squares = 0;
  for (const r of rows) {
    actual += r.actualKwh; predicted += r[method];
    absolute += Math.abs(r[method] - r.actualKwh); squares += (r[method] - r.actualKwh) ** 2;
  }
  const wape = actual ? 100 * absolute / actual : null;
  assert.equal(saved.hours, rows.length); assert.equal(saved.days, new Set(rows.map((r) => r.date)).size);
  close(saved.actualMwh, actual / 1000); close(saved.predictedMwh, predicted / 1000);
  close(saved.absoluteErrorMwh, absolute / 1000); close(saved.wape, wape);
  close(saved.displayAccuracy, wape === null ? null : Math.max(0, 100 - wape));
  close(saved.maeKwh, absolute / rows.length); close(saved.rmseKwh, Math.sqrt(squares / rows.length));
  close(saved.biasMwh, (predicted - actual) / 1000);
}
let trainingChecks = 0, predictionsChecked = 0;
for (const [mode, folds] of Object.entries(runs)) {
  const records = mode === 'receiptCausal' ? data.revisions : data.actual;
  const original = new Map(oldRuns[mode].map((r) => [r.date, r]));
  assert.deepEqual(folds.map((r) => r.date), oldRuns[mode].map((r) => r.date));
  const expectedRows = [];
  for (const fold of folds) {
    const day = dayMap.get(fold.date), old = original.get(fold.date), cutoff = Date.parse(fold.originAt);
    assert.equal(cutoff, Date.parse(day.originAt));
    assert.deepEqual(fold.trainingIndices, old.trainingIndices.All);
    assert.deepEqual(fold.starts, day.hours.map((h) => h.start));
    const previousDay = new Date(Date.parse(day.date) - 86400000).toISOString().slice(0, 10);
    const latest = new Map();
    if (mode === 'receiptCausal') for (const [i, r] of records.map((r, i) => [i, r]).sort((a, b) => a[1].observedAt.localeCompare(b[1].observedAt) || String(a[1].id).localeCompare(String(b[1].id)))) {
      if (Date.parse(r.observedAt) < cutoff && Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)) latest.set(r.start, i);
    }
    for (const i of fold.trainingIndices) {
      const r = records[i], h = featureMap.get(r.start);
      assert.ok(h.date < previousDay && Date.parse(h.originAt) < cutoff && h.clearSky > 0);
      assert.ok(Number.isFinite(r.productionKwh) && r.productionKwh >= 0 && r.productionKwh <= 875);
      if (mode === 'receiptCausal') assert.equal(latest.get(r.start), i);
      trainingChecks++;
    }
    assert.ok(fold.trainingIndices.length >= 120);
    assert.ok(new Set(fold.trainingIndices.map((i) => featureMap.get(records[i].start).date)).size >= 10);
    fold.outputs.coarseGhi.forEach((p, i) => close(p, old.outputs.catboostAll[i]));
    for (const m of methods) fold.outputs[m].forEach((p, i) => {
      assert.ok(Number.isFinite(p) && p >= 0 && p <= 875);
      if (day.hours[i].clearSky === 0) assert.equal(p, 0);
      predictionsChecked++;
    });
    day.hours.forEach((h, i) => {
      if (!Number.isFinite(h.actualKwh) || h.actualKwh < 0 || (h.clearSky <= 0 && h.actualKwh === 0)) return;
      expectedRows.push({ date: day.date, start: h.start, actualKwh: h.actualKwh, v32: h.v32, ...Object.fromEntries(methods.map((m) => [m, fold.outputs[m][i]])) });
    });
  }
  const track = evaluation.tracks[mode];
  assert.deepEqual(track.rows, expectedRows);
  assert.deepEqual(expectedRows.map((r) => [r.start, r.actualKwh]), oldEvaluation.tracks[mode].rows.map((r) => [r.start, r.actualKwh]));
  for (const m of methods) {
    score(expectedRows, m, track.scores[m]);
    for (const month of track.monthly) score(expectedRows.filter((r) => r.date.startsWith(month.month)), m, month.scores[m]);
    for (const day of track.daily) score(expectedRows.filter((r) => r.date === day.date), m, day.scores[m]);
  }
  for (const m of ['v32', ...methods]) score(expectedRows.filter((r) => r.v32 !== null && r.date.startsWith('2026-10')), m, track.v32MatchedOctober[m]);
}
const verified = { status: 'passed', verifiedAt: new Date().toISOString(), featuresChecked, trainingChecks, predictionsChecked,
  sourceDays: sourceMap.size, baselineReproduced: true, scoreMasksUnchanged: true,
  hashes: Object.fromEntries([root + 'inputs.json', root + 'runs.json', 'docs/sflux-research-evaluation.json'].map((p) => [p, hash(p)])) };
fs.writeFileSync('docs/sflux-research-verification.json', JSON.stringify(verified, null, 2) + '\n');
console.log(JSON.stringify(verified));
