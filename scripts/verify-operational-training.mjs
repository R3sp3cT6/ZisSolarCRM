import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = 'work/forecast-research/operational-training/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen = read('docs/operational-training-frozen.json');
for (const [p, h] of Object.entries(frozen.hashes)) assert.equal(sha(p), h);
const data = read('work/forecast-research/full-history/inputs.json');
const evidence = read('work/forecast-research/inverter-evidence/inputs.json');
const runs = read(root + 'runs.json');
const mask = read(root + 'mask.json');
const evaluation = read('docs/operational-training-evaluation.json');
const previousRuns = read('work/forecast-research/full-history/runs.json');
const previousScores = read('docs/full-history-evaluation.json');
const methods = evaluation.methods;
const dayMap = new Map(data.days.map((d) => [d.date, d]));
const featureMap = new Map(data.days.flatMap((d) => d.hours.map((h) => [h.start, { ...h, date: d.date, originAt: d.originAt }])));
const raw = new Map();
for (const response of [...evidence.inputs].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
  assert.equal(createHash('sha256').update(JSON.stringify(response.values)).digest('hex'), response.sha256);
  for (const row of response.values) {
    const key = row.devId + ':' + row.collectTime;
    if (!raw.has(key)) raw.set(key, { ...row, receipt: response.receivedAt });
  }
}
assert.equal(raw.size, evidence.samples.length);
const qualifies = (r) => {
  const m = r.dataItemMap, p = m.active_power;
  return Number.isFinite(p) && p >= 0 && ([513, 514].includes(m.inverter_state) || (m.inverter_state >= 768 && m.inverter_state <= 773 && p === 0));
};
const expectedMask = new Map();
for (const [key, row] of raw) {
  const next = raw.get(row.devId + ':' + (row.collectTime + 300000));
  if (!next || Math.floor(row.collectTime / 3600000) !== Math.floor(next.collectTime / 3600000) || !qualifies(row) || !qualifies(next)) continue;
  const start = new Date(Math.floor(row.collectTime / 3600000) * 3600000).toISOString();
  const receipt = new Date(Math.max(Date.parse(row.receipt), Date.parse(next.receipt))).toISOString();
  if (!expectedMask.has(start) || receipt < expectedMask.get(start)) expectedMask.set(start, receipt);
  assert.ok(key);
}
const chronological = (a, b) => a.localeCompare(b);
assert.deepEqual(Object.keys(mask).sort(chronological), [...expectedMask.keys()].sort(chronological));
for (const [start, witness] of Object.entries(mask)) {
  assert.equal(witness.availableAt, expectedMask.get(start));
  const [a, b] = witness.witnessIndices.map((i) => evidence.samples[i]);
  assert.equal(a.deviceId, b.deviceId);
  assert.equal(Date.parse(b.measuredAt) - Date.parse(a.measuredAt), 300000);
  assert.equal(new Date(Math.floor(Date.parse(a.measuredAt) / 3600000) * 3600000).toISOString(), start);
  for (const sample of [a, b]) {
    const original = raw.get(sample.deviceId + ':' + Date.parse(sample.measuredAt));
    assert.ok(original && qualifies(original));
    assert.equal(sample.receivedAt, original.receipt);
    assert.equal(sample.stateCode, original.dataItemMap.inverter_state);
    assert.equal(sample.powerKw, original.dataItemMap.active_power);
  }
}
const close = (a, b) => {
  if (a === null || b === null) assert.equal(a, b);
  else assert.ok(Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
};
function score(rows, method, saved) {
  if (!rows.length) { assert.equal(saved, null); return; }
  let actual = 0, predicted = 0, absolute = 0, squares = 0;
  for (const r of rows) {
    actual += r.actualKwh; predicted += r[method];
    absolute += Math.abs(r[method] - r.actualKwh); squares += (r[method] - r.actualKwh) ** 2;
  }
  const wape = actual ? 100 * absolute / actual : null;
  assert.equal(saved.hours, rows.length);
  assert.equal(saved.days, new Set(rows.map((r) => r.date)).size);
  close(saved.actualMwh, actual / 1000); close(saved.predictedMwh, predicted / 1000);
  close(saved.absoluteErrorMwh, absolute / 1000); close(saved.wape, wape);
  close(saved.displayAccuracy, wape === null ? null : Math.max(0, 100 - wape));
  close(saved.maeKwh, absolute / rows.length); close(saved.rmseKwh, Math.sqrt(squares / rows.length));
  close(saved.biasMwh, (predicted - actual) / 1000);
}
let trainingChecks = 0, predictedChecks = 0, causalExclusions = 0;
const excludedUnique = new Map(methods.map((m) => [m, new Set()]));
for (const [mode, folds] of Object.entries(runs)) {
  const records = mode === 'receiptCausal' ? data.revisions : data.actual;
  const oldMap = new Map(previousRuns[mode].map((r) => [r.date, r]));
  assert.deepEqual(folds.map((r) => r.date), previousRuns[mode].map((r) => r.date));
  const expectedRows = [];
  for (const fold of folds) {
    const day = dayMap.get(fold.date), old = oldMap.get(fold.date), cutoff = Date.parse(fold.originAt);
    assert.equal(fold.originAt, day.originAt);
    assert.deepEqual(fold.starts, day.hours.map((h) => h.start));
    const latest = new Map();
    if (mode === 'receiptCausal') {
      for (const [i, r] of data.revisions.map((r, i) => [i, r]).sort((a, b) => a[1].observedAt.localeCompare(b[1].observedAt) || String(a[1].id).localeCompare(String(b[1].id)))) {
        if (Date.parse(r.observedAt) < cutoff && Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)) latest.set(r.start, i);
      }
    }
    const known = mode === 'receiptCausal' ? [...latest.values()] : records.map((_, i) => i);
    const previousDay = new Date(Date.parse(day.date) - 86400000).toISOString().slice(0, 10);
    const original = known.filter((i) => {
      const r = records[i], h = featureMap.get(r.start);
      return h && h.date < previousDay && Date.parse(h.originAt) < cutoff && h.clearSky > 0 && Number.isFinite(r.productionKwh) && r.productionKwh >= 0 && r.productionKwh <= 875;
    }).sort((a, b) => records[a].start.localeCompare(records[b].start));
    assert.deepEqual(original, old.trainingIndices.All);
    for (const method of methods) {
      const retained = [], removed = [];
      for (const i of original) {
        const r = records[i], d = featureMap.get(r.start).date;
        let exclude = false;
        if (method === 'deviceFiltered') exclude = expectedMask.has(r.start) && (mode === 'archiveReconstruction' || Date.parse(expectedMask.get(r.start)) < cutoff);
        if (method === 'broadConfirmationSensitivity') exclude = (d.startsWith('2026-07') || ['2026-09-11', '2026-09-12'].includes(d)) && (mode === 'archiveReconstruction' || Date.parse(frozen.frozenAt) < cutoff);
        (exclude ? removed : retained).push(i);
        if (exclude) excludedUnique.get(method).add(r.start);
        trainingChecks++;
      }
      assert.deepEqual(fold.trainingIndices[method], retained);
      assert.deepEqual(fold.removedIndices[method], removed);
      assert.ok(retained.length >= 120 && new Set(retained.map((i) => featureMap.get(records[i].start).date)).size >= 10);
      if (mode === 'receiptCausal') {
        causalExclusions += removed.length;
        assert.deepEqual(fold.outputs[method], fold.outputs.control);
      }
      fold.outputs[method].forEach((p, i) => {
        assert.ok(Number.isFinite(p) && p >= 0 && p <= 875);
        if (day.hours[i].clearSky === 0) assert.equal(p, 0);
        predictedChecks++;
      });
    }
    fold.outputs.control.forEach((p, i) => close(p, old.outputs.catboostAll[i]));
    day.hours.forEach((h, i) => {
      if (!Number.isFinite(h.actualKwh) || h.actualKwh < 0 || (h.clearSky <= 0 && h.actualKwh === 0)) return;
      expectedRows.push({ date: day.date, start: h.start, actualKwh: h.actualKwh, v32: h.v32, ...Object.fromEntries(methods.map((m) => [m, fold.outputs[m][i]])) });
    });
  }
  const track = evaluation.tracks[mode];
  assert.deepEqual(track.rows, expectedRows);
  assert.deepEqual(expectedRows.map((r) => [r.start, r.actualKwh]), previousScores.tracks[mode].rows.map((r) => [r.start, r.actualKwh]));
  for (const method of methods) {
    score(expectedRows, method, track.scores[method]);
    for (const month of track.monthly) score(expectedRows.filter((r) => r.date.startsWith(month.month)), method, month.scores[method]);
  }
  for (const method of ['v32', ...methods]) score(expectedRows.filter((r) => r.v32 !== null && r.date.startsWith('2026-10')), method, track.v32MatchedOctober[method]);
}
assert.equal(causalExclusions, 0);
const verification = {
  status: 'passed', verifiedAt: new Date().toISOString(), trainingChecks, predictedChecks,
  deviceAffectedHours: expectedMask.size,
  trainingHoursExcluded: Object.fromEntries([...excludedUnique].map(([m, set]) => [m, set.size])),
  deviceTrainingHoursByDate: Object.fromEntries([...new Set([...excludedUnique.get('deviceFiltered')].map((s) => s.slice(0, 10)))].map((d) => [d, [...excludedUnique.get('deviceFiltered')].filter((s) => s.startsWith(d)).length])),
  causalExclusions, scoreMasksUnchanged: true, baselineReproduced: true,
  monthlyMetricsIndependentlyRecomputed: true,
  hashes: Object.fromEntries([root + 'runs.json', root + 'mask.json', 'docs/operational-training-evaluation.json'].map((p) => [p, sha(p)])),
};
fs.writeFileSync('docs/operational-training-verification.json', JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify(verification));
