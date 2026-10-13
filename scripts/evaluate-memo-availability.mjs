import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { negativeMemoDecision } from '../lib/forecast-availability.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = (p) =>
  createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root = 'work/forecast-research/memo-availability/';
const source = read(root + 'prices.json'),
  old = read('docs/full-history-evaluation.json');
const days = new Map(
  read('work/forecast-research/full-history/inputs.json').days.map((d) => [
    d.date,
    d,
  ]),
);
const files = [
  'scripts/evaluate-memo-availability.mjs',
  'scripts/verify-memo-availability.py',
  'scripts/export-memo-availability.mjs',
  'lib/forecast-availability.ts',
  'docs/memo-availability-plan.md',
  'tests/forecast-availability.test.mjs',
];
const frozen = {
  frozenAt: new Date().toISOString(),
  hashes: Object.fromEntries(
    [
      root + 'prices.json',
      'docs/full-history-evaluation.json',
      'work/forecast-research/full-history/inputs.json',
      ...files,
    ].map((p) => [p, sha(p)]),
  ),
};
fs.writeFileSync(
  root + 'frozen-source.json',
  JSON.stringify(
    Object.fromEntries(files.map((p) => [p, fs.readFileSync(p, 'utf8')])),
  ),
);
fs.writeFileSync(
  'docs/memo-availability-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
const byHour = new Map();
for (const p of source.records)
  byHour.set(p.start, [...(byHour.get(p.start) ?? []), p]);
function score(rows, key) {
  if (!rows.length) return null;
  const actual = rows.reduce((s, r) => s + r.actualKwh, 0),
    predicted = rows.reduce((s, r) => s + r[key], 0);
  const absolute = rows.reduce((s, r) => s + Math.abs(r[key] - r.actualKwh), 0);
  return {
    hours: rows.length,
    days: new Set(rows.map((r) => r.date)).size,
    actualMwh: actual / 1000,
    predictedMwh: predicted / 1000,
    absoluteErrorMwh: absolute / 1000,
    wape: actual > 0 ? (100 * absolute) / actual : null,
    maeKwh: absolute / rows.length,
    rmseKwh: Math.sqrt(
      rows.reduce((s, r) => s + (r[key] - r.actualKwh) ** 2, 0) / rows.length,
    ),
    biasMwh: (predicted - actual) / 1000,
  };
}
const tracks = {};
for (const mode of ['archiveReconstruction', 'receiptCausal']) {
  const rows = old.tracks[mode].rows.map((r) => {
    const originAt = days.get(r.date).originAt,
      prices = byHour.get(r.start) ?? [];
    const reconstructed = negativeMemoDecision(
      prices,
      r.start,
      source.exportedAt,
    );
    const causal = negativeMemoDecision(prices, r.start, originAt);
    return {
      date: r.date,
      start: r.start,
      originAt,
      actualKwh: r.actualKwh,
      control: r.catboostAll,
      v32: r.v32,
      reconstructed,
      causal,
      policyReconstructed:
        reconstructed.state === 'negative' ? 0 : r.catboostAll,
      policyCausal: causal.state === 'negative' ? 0 : r.catboostAll,
      v32Reconstructed:
        r.v32 === null ? null : reconstructed.state === 'negative' ? 0 : r.v32,
      v32Causal:
        r.v32 === null ? null : causal.state === 'negative' ? 0 : r.v32,
    };
  });
  const summarize = (rs) => ({
    scores: Object.fromEntries(
      ['control', 'policyReconstructed', 'policyCausal'].map((k) => [
        k,
        score(rs, k),
      ]),
    ),
    coverage: Object.fromEntries(
      ['reconstructed', 'causal'].map((k) => [
        k,
        {
          knownPriceHours: rs.filter((r) => r[k].state !== 'unknown').length,
          negativeHours: rs.filter((r) => r[k].state === 'negative').length,
          changedHours: rs.filter(
            (r) => r[k].state === 'negative' && r.control !== 0,
          ).length,
          actualMwhOnNegative:
            rs
              .filter((r) => r[k].state === 'negative')
              .reduce((s, r) => s + r.actualKwh, 0) / 1000,
          positiveActualHoursOnNegative: rs.filter(
            (r) => r[k].state === 'negative' && r.actualKwh > 0,
          ).length,
          dates: [
            ...new Set(
              rs.filter((r) => r[k].state === 'negative').map((r) => r.date),
            ),
          ],
        },
      ]),
    ),
  });
  const summary = summarize(rows);
  assert.ok(
    Math.abs(
      summary.scores.control.wape - old.tracks[mode].scores.catboostAll.wape,
    ) < 1e-8,
  );
  const matched = rows.filter(
    (r) => r.date.startsWith('2026-10') && r.v32 !== null,
  );
  tracks[mode] = {
    ...summary,
    monthly: [...new Set([...days.keys()].map((d) => d.slice(0, 7)))].map(
      (month) => ({
        month,
        ...summarize(rows.filter((r) => r.date.startsWith(month))),
      }),
    ),
    matchedOctober: Object.fromEntries(
      [
        'v32',
        'v32Reconstructed',
        'v32Causal',
        'control',
        'policyReconstructed',
        'policyCausal',
      ].map((k) => [k, score(matched, k)]),
    ),
    rows,
  };
  console.log(
    JSON.stringify({
      mode,
      ...summary,
      matchedOctober: tracks[mode].matchedOctober,
    }),
  );
}
const result = {
  version: 'negative-memo-availability-diagnostic-v1',
  evaluatedAt: new Date().toISOString(),
  frozen,
  tracks,
  promotion: false,
  warning:
    'The operating policy was confirmed today; its historical applicability is assumed, not known before old origins. Reconstruction also assumes historical price availability. All measured zeros and restarts remain scored.',
};
fs.writeFileSync(
  'docs/memo-availability-evaluation.json',
  JSON.stringify(result),
);
