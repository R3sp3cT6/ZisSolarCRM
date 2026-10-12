// Independent chronology, coverage and metric checks for every reported fold.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { localDate, slotsForDay } from '../lib/energy.ts';
import { addDays } from '../lib/forecast-model.ts';
const root = 'work/forecast-research/full-history/',
  read = (p) => JSON.parse(fs.readFileSync(p));
const data = read(root + 'inputs.json'),
  runs = read(root + 'runs.json'),
  evaluation = read('docs/full-history-evaluation.json');
const hash = (p) =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(evaluation.inputSha256, hash(root + 'inputs.json'));
const dayMap = new Map(data.days.map((d) => [d.date, d]));
const weather = new Map(
  data.days.flatMap((d) =>
    d.hours.map((h) => [h.start, { ...h, date: d.date, originAt: d.originAt }]),
  ),
);
let checks = 0,
  predictions = 0;
const close = (a, b) => {
  if (a === null || b === null) assert.equal(a, b);
  else
    assert.ok(
      Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)),
      `${a} != ${b}`,
    );
};
function verifyScore(rows, key, saved) {
  if (!rows.length) {
    assert.equal(saved, null);
    return;
  }
  let actual = 0,
    predicted = 0,
    absolute = 0,
    squares = 0;
  for (const row of rows) {
    actual += row.actualKwh;
    predicted += row[key];
    absolute += Math.abs(row[key] - row.actualKwh);
    squares += (row[key] - row.actualKwh) ** 2;
  }
  const wape = actual ? (100 * absolute) / actual : null;
  assert.equal(rows.length, saved.hours);
  assert.equal(new Set(rows.map((r) => r.date)).size, saved.days);
  close(actual / 1000, saved.actualMwh);
  close(predicted / 1000, saved.predictedMwh);
  close(absolute / 1000, saved.absoluteErrorMwh);
  close(wape, saved.wape);
  close(wape === null ? null : Math.max(0, 100 - wape), saved.displayAccuracy);
  close(absolute / rows.length, saved.maeKwh);
  close(Math.sqrt(squares / rows.length), saved.rmseKwh);
  close((predicted - actual) / 1000, saved.biasMwh);
}
for (const [mode, trackRuns] of Object.entries(runs)) {
  const records = mode === 'receiptCausal' ? data.revisions : data.actual;
  const track = evaluation.tracks[mode],
    expected = [];
  for (const run of trackRuns) {
    const day = dayMap.get(run.date),
      cutoff = Date.parse(run.originAt),
      previous = addDays(run.date, -1);
    assert.equal(run.originAt, day.originAt);
    assert.deepEqual(
      run.starts,
      slotsForDay(run.date).map((s) => s.start),
    );
    const latest = new Map();
    if (mode === 'receiptCausal')
      for (const r of [...data.revisions].sort(
        (a, b) =>
          a.observedAt.localeCompare(b.observedAt) ||
          String(a.id).localeCompare(String(b.id)),
      ))
        if (
          Date.parse(r.observedAt) < cutoff &&
          Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
        )
          latest.set(r.start, r.id);
    for (const [window, indices] of Object.entries(run.trainingIndices)) {
      assert.ok(indices.length >= 120);
      assert.equal(new Set(indices).size, indices.length);
      const dates = new Set();
      for (const index of indices) {
        const row = records[index],
          w = weather.get(row.start);
        assert.ok(row && w);
        assert.ok(
          w.date < previous &&
            Date.parse(w.originAt) < cutoff &&
            w.clearSky > 0,
        );
        assert.ok(
          Number.isFinite(row.productionKwh) &&
            row.productionKwh >= 0 &&
            row.productionKwh <= data.config.acKw,
        );
        if (window === '45')
          assert.ok(Date.parse(row.start) >= cutoff - 45 * 86400000);
        if (mode === 'receiptCausal') {
          assert.ok(Date.parse(row.observedAt) < cutoff);
          assert.ok(
            Date.parse(row.start) + 3600000 <= Date.parse(row.observedAt),
          );
          assert.equal(
            latest.get(row.start),
            row.id,
            'Later eligible revision ignored',
          );
        }
        dates.add(localDate(row.start));
        checks++;
      }
      assert.equal(dates.size, run.trainingDays[window]);
      assert.ok(dates.size >= 10);
    }
    assert.ok(
      run.trainingIndices['45'].every((i) =>
        run.trainingIndices.All.includes(i),
      ),
    );
    for (let i = 0; i < day.hours.length; i++) {
      const h = day.hours[i];
      for (const m of evaluation.methods) {
        const p = run.outputs[m][i];
        assert.ok(Number.isFinite(p) && p >= 0 && p <= data.config.acKw);
        if (h.clearSky === 0) assert.equal(p, 0);
        predictions++;
      }
      if (
        !Number.isFinite(h.actualKwh) ||
        h.actualKwh < 0 ||
        (h.clearSky <= 0 && h.actualKwh === 0)
      )
        continue;
      expected.push({
        date: day.date,
        start: h.start,
        actualKwh: h.actualKwh,
        v32: h.v32,
        ...Object.fromEntries(
          evaluation.methods.map((m) => [m, run.outputs[m][i]]),
        ),
      });
    }
  }
  assert.deepEqual(expected, track.rows);
  for (const method of evaluation.methods) {
    verifyScore(expected, method, track.scores[method]);
    for (const month of track.monthly)
      verifyScore(
        expected.filter((r) => r.date.startsWith(month.month)),
        method,
        month.scores[method],
      );
    for (const day of track.daily)
      verifyScore(
        expected.filter((r) => r.date === day.date),
        method,
        day.scores[method],
      );
    verifyScore(
      expected.filter(
        (r) =>
          !r.date.startsWith('2026-07') &&
          !['2026-09-11', '2026-09-12'].includes(r.date),
      ),
      method,
      track.withoutConfirmedPeriods[method],
    );
  }
  for (const method of ['v32', ...evaluation.methods]) {
    verifyScore(
      expected.filter((r) => r.v32 !== null),
      method,
      track.v32Matched[method],
    );
    verifyScore(
      expected.filter((r) => r.v32 !== null && r.date.startsWith('2026-10')),
      method,
      track.v32MatchedOctober[method],
    );
  }
}
const verified = {
  verifiedAt: new Date().toISOString(),
  status: 'passed',
  trainingRowsChecked: checks,
  predictionsChecked: predictions,
  inputSha256: hash(root + 'inputs.json'),
  runsSha256: hash(root + 'runs.json'),
  evaluationSha256: hash('docs/full-history-evaluation.json'),
  receiptCausalChecked: true,
  archiveAssumptionExplicit: true,
  allMonthlyMetricsIndependentlyRecomputed: true,
};
fs.writeFileSync(
  'docs/full-history-verification.json',
  JSON.stringify(verified, null, 2) + '\n',
);
console.log(JSON.stringify(verified));
