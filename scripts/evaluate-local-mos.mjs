import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mosTraining,
  localMos,
  LOCAL_MOS_VERSION,
} from '../lib/forecast-local-mos.ts';
const root = 'work/forecast-research/local-mos/';
const read = (p) => JSON.parse(fs.readFileSync(p)),
  sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const frozen = read('docs/local-mos-frozen.json');
assert.equal(sha(root + 'inputs.json'), frozen.inputSha256);
for (const [p, h] of Object.entries(frozen.codeHashes))
  assert.equal(sha(p), h, p);
const input = read(root + 'inputs.json'),
  hours = input.days.flatMap((d) => d.hours);
const forecastHours = hours.map(
  ({ actualKwh: _actual, weather: _weather, ...h }) => h,
);
const rows = [],
  runs = [];
for (const d of input.days) {
  if (d.date < '2026-09-18') continue;
  const origin = new Date(d.originAt);
  const train = mosTraining(
    forecastHours,
    input.revisions,
    origin,
    input.config.acKw,
  );
  const output = d.hours.map(
    ({ actualKwh: _actual, weather: _weather, ...h }) => ({
      start: h.start,
      ...localMos(train, h, origin, input.config.acKw),
    }),
  );
  runs.push({ date: d.date, originAt: d.originAt, train, output });
  for (const [i, h] of d.hours.entries()) {
    if (h.clearSky <= 0 && !(h.actualKwh > 0)) continue;
    assert.ok(Number.isFinite(h.actualKwh) && h.actualKwh >= 0, h.start);
    rows.push({
      date: d.date,
      start: h.start,
      actualKwh: h.actualKwh,
      v32: h.baseKwh,
      mos: output[i].productionKwh,
      ...output[i],
    });
  }
}
const metrics = (rs, key) => {
  const actual = rs.reduce((s, r) => s + r.actualKwh, 0),
    predicted = rs.reduce((s, r) => s + r[key], 0);
  const absolute = rs.reduce((s, r) => s + Math.abs(r[key] - r.actualKwh), 0);
  return {
    hours: rs.length,
    days: new Set(rs.map((r) => r.date)).size,
    actualMwh: actual / 1000,
    predictedMwh: predicted / 1000,
    wape: (100 * absolute) / actual,
    maeKwh: absolute / rs.length,
    rmseKwh: Math.sqrt(
      rs.reduce((s, r) => s + (r[key] - r.actualKwh) ** 2, 0) / rs.length,
    ),
    biasMwh: (predicted - actual) / 1000,
    biasPercent: (100 * (predicted - actual)) / actual,
  };
};
const summary = (rs) => ({
  v32: metrics(rs, 'v32'),
  mos: metrics(rs, 'mos'),
  changedHours: rs.filter((r) => Math.abs(r.mos - r.v32) > 1e-8).length,
  readyHours: rs.filter((r) => r.status === 'ready').length,
  fallbackHours: rs.filter((r) => r.status !== 'ready').length,
});
const scores = {
  all: summary(rows),
  september: summary(rows.filter((r) => r.date < '2026-10-01')),
  october: summary(rows.filter((r) => r.date >= '2026-10-01')),
};
const daily = [...new Set(rows.map((r) => r.date))].map((date) => ({
  date,
  ...summary(rows.filter((r) => r.date === date)),
}));
const gate =
  [scores.september, scores.october].every(
    (s) => s.mos.wape <= s.v32.wape * 0.98,
  ) &&
  scores.all.mos.rmseKwh <= scores.all.v32.rmseKwh &&
  Math.abs(scores.all.mos.biasPercent) <=
    Math.abs(scores.all.v32.biasPercent) + 2;
const payload = {
  version: LOCAL_MOS_VERSION,
  evaluatedAt: new Date().toISOString(),
  inputSha256: frozen.inputSha256,
  scores,
  daily,
  dailyWins: daily.filter((d) => d.mos.wape < d.v32.wape).length,
  gate,
  rows,
};
fs.writeFileSync(root + 'runs.json', JSON.stringify(runs));
fs.writeFileSync('docs/local-mos-evaluation.json', JSON.stringify(payload));
console.log(
  JSON.stringify({ scores, dailyWins: payload.dailyWins, gate }, null, 2),
);
