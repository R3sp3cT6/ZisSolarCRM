import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  nearZeroPersistence,
  measurementsKnownAt,
} from './near-zero-persistence.mjs';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = (p) =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root = 'work/forecast-research/availability-persistence/';
const inputPath = 'work/forecast-research/full-history/inputs.json';
const data = read(inputPath),
  old = read('docs/full-history-evaluation.json'),
  runs = read('work/forecast-research/full-history/runs.json');
assert.equal(
  hash(inputPath),
  read('docs/full-history-verification.json').inputSha256,
);
assert.equal(old.inputSha256, hash(inputPath));
const codePaths = [
  'scripts/near-zero-persistence.mjs',
  'scripts/evaluate-availability-persistence.mjs',
  'tests/near-zero-persistence.test.mjs',
  'docs/availability-persistence-plan.md',
];
const frozen = {
  frozenAt: new Date().toISOString(),
  inputSha256: hash(inputPath),
  runSha256: hash('work/forecast-research/full-history/runs.json'),
  evaluationSha256: hash('docs/full-history-evaluation.json'),
  codeHashes: Object.fromEntries(codePaths.map((p) => [p, hash(p)])),
};
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(
  root + 'frozen-source.json',
  JSON.stringify(
    Object.fromEntries(codePaths.map((p) => [p, fs.readFileSync(p, 'utf8')])),
  ),
);
fs.writeFileSync(
  'docs/availability-persistence-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
const score = (rows, key) => {
  if (!rows.length) return null;
  const actual = rows.reduce((s, r) => s + r.actualKwh, 0),
    pred = rows.reduce((s, r) => s + r[key], 0),
    absolute = rows.reduce((s, r) => s + Math.abs(r[key] - r.actualKwh), 0);
  return {
    hours: rows.length,
    days: new Set(rows.map((r) => r.date)).size,
    actualMwh: actual / 1000,
    predictedMwh: pred / 1000,
    absoluteErrorMwh: absolute / 1000,
    wape: actual > 0 ? (100 * absolute) / actual : null,
    maeKwh: absolute / rows.length,
    rmseKwh: Math.sqrt(
      rows.reduce((s, r) => s + (r[key] - r.actualKwh) ** 2, 0) / rows.length,
    ),
    biasMwh: (pred - actual) / 1000,
  };
};
const tracks = {};
for (const mode of ['archiveReconstruction', 'receiptCausal']) {
  const decisions = runs[mode].map((run) => ({
    date: run.date,
    originAt: run.originAt,
    ...nearZeroPersistence({
      targetDate: run.date,
      originAt: run.originAt,
      days: data.days,
      known: measurementsKnownAt(data, mode, run.originAt),
      acKw: data.config.acKw,
    }),
  }));
  const triggers = new Set(
    decisions.filter((d) => d.trigger).map((d) => d.date),
  );
  const rows = old.tracks[mode].rows.map((r) => ({
    date: r.date,
    start: r.start,
    actualKwh: r.actualKwh,
    v32: r.v32,
    control: r.catboostAll,
    persistence: triggers.has(r.date) ? 0 : r.catboostAll,
  }));
  for (const [k, v] of Object.entries(score(rows, 'control')))
    if (typeof v === 'number')
      assert.ok(Math.abs(v - old.tracks[mode].scores.catboostAll[k]) < 1e-8, k);
  const summaries = (rs) =>
    Object.fromEntries(
      ['control', 'persistence'].map((k) => [k, score(rs, k)]),
    );
  const matched = rows.filter(
    (r) => r.date.startsWith('2026-10') && r.v32 !== null,
  );
  tracks[mode] = {
    scores: summaries(rows),
    monthly: [...new Set(data.days.map((d) => d.date.slice(0, 7)))].map(
      (month) => ({
        month,
        scores: summaries(rows.filter((r) => r.date.startsWith(month))),
      }),
    ),
    triggered: decisions
      .filter((d) => d.trigger)
      .map((d) => ({
        date: d.date,
        ...summaries(rows.filter((r) => r.date === d.date)),
      })),
    v32MatchedOctober: Object.fromEntries(
      ['v32', 'control', 'persistence'].map((k) => [k, score(matched, k)]),
    ),
    decisions,
    rows,
  };
  console.log(
    JSON.stringify({
      mode,
      scores: tracks[mode].scores,
      triggered: tracks[mode].triggered.map((d) => d.date),
    }),
  );
}
const report = {
  version: 'availability-persistence-v1',
  evaluatedAt: new Date().toISOString(),
  first: data.first,
  last: data.last,
  inputs: frozen,
  tracks,
  promotion: false,
  warning:
    'Near-zero response is not a proven shutdown. Retrospective, fixed threshold, no forecast promotion. All actual outages and restarts remain in primary scores.',
};
fs.writeFileSync(
  'docs/availability-persistence-evaluation.json',
  JSON.stringify(report, null, 2) + '\n',
);
