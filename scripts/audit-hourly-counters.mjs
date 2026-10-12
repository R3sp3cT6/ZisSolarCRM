// Independent energy-target audit. It never modifies readings or forecast scores.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { slotsForDay } from '../lib/energy.ts';
import { parseCounterHistory, counterHours } from '../lib/fusion-telemetry.ts';

const dates = [
  '2026-07-15',
  '2026-09-11',
  '2026-09-12',
  '2026-10-10',
  '2026-10-11',
];
const actualPath = 'work/forecast-research/full-history/inputs.json';
const bytes = fs.readFileSync(actualPath),
  archive = JSON.parse(bytes);
const hash = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(
  hash(bytes),
  JSON.parse(fs.readFileSync('docs/full-history-verification.json'))
    .inputSha256,
);
const actual = new Map(archive.actual.map((row) => [row.start, row]));
const days = [],
  evidence = [];
for (const date of dates) {
  const path = 'work/forecast-research/huawei-five-minute/' + date + '.json';
  const input = JSON.parse(fs.readFileSync(path));
  assert.equal(hash(JSON.stringify(input.values)), input.sha256);
  assert.equal(input.devices.length, 8);
  const byKey = new Map();
  for (const row of input.values) {
    assert.ok(input.devices.includes(row.devId));
    const key = row.devId + ':' + row.collectTime;
    assert.ok(!byKey.has(key), 'Ambiguous duplicate within one response');
    byKey.set(key, row);
  }
  const computed = counterHours(
    parseCounterHistory(
      input.values,
      input.devices,
      'total_cap',
      Date.parse(input.from),
      Date.parse(input.to),
    ),
    input.devices,
    date,
    'production',
  );
  const computedByStart = new Map(
    computed.map((row) => [row.start, row.productionKwh]),
  );
  const rows = slotsForDay(date).map((slot) => {
    const first = Date.parse(slot.start),
      end = Date.parse(slot.end);
    const known = actual.get(slot.start);
    const boundaries = input.devices.map((id) => [
      byKey.get(id + ':' + first)?.dataItemMap?.total_cap,
      byKey.get(id + ':' + end)?.dataItemMap?.total_cap,
    ]);
    const valid = (value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const complete = boundaries.every((pair) => pair.every(valid));
    const reset = input.devices.some((id) => {
      const sequence = input.values
        .filter(
          (r) =>
            r.devId === id && r.collectTime >= first && r.collectTime <= end,
        )
        .sort((a, b) => a.collectTime - b.collectTime)
        .map((r) => r.dataItemMap.total_cap)
        .filter(valid);
      return sequence.some((v, i) => i > 0 && v < sequence[i - 1]);
    });
    const counterKwh =
      complete && !reset
        ? Math.round(boundaries.reduce((n, [a, b]) => n + b - a, 0) * 1000) /
          1000
        : null;
    assert.equal(
      counterKwh,
      computedByStart.get(slot.start) ?? null,
      'Independent counter arithmetic matches collector',
    );
    const archivedKwh =
      typeof known?.productionKwh === 'number' ? known.productionKwh : null;
    return {
      start: slot.start,
      archivedKwh,
      exportKwh: known?.exportKwh ?? null,
      counterKwh,
      differenceKwh:
        archivedKwh !== null && counterKwh !== null
          ? archivedKwh - counterKwh
          : null,
      missingBoundaries: !complete,
      reset,
      source: known?.source ?? null,
      observedAt: known?.observedAt ?? null,
    };
  });
  const matched = rows.filter((r) => r.differenceKwh !== null);
  days.push({
    date,
    sourceSha256: input.sha256,
    receivedAt: input.receivedAt,
    matchedHours: matched.length,
    missingBoundaryHours: rows.filter((r) => r.missingBoundaries).length,
    resetHours: rows.filter((r) => r.reset).length,
    archivedKwh: matched.reduce((n, r) => n + r.archivedKwh, 0),
    counterKwh: matched.reduce((n, r) => n + r.counterKwh, 0),
    absoluteDifferenceKwh: matched.reduce(
      (n, r) => n + Math.abs(r.differenceKwh),
      0,
    ),
    maxAbsoluteDifferenceKwh: matched.length
      ? Math.max(...matched.map((r) => Math.abs(r.differenceKwh)))
      : null,
    rows,
  });
  evidence.push(input);
}
const payload = {
  version: 'hourly-counter-audit-v1',
  auditedAt: new Date().toISOString(),
  actualInputSha256: hash(bytes),
  days,
  actualsChanged: false,
  forecastScoresChanged: false,
  scope:
    'Five existing device-history dates only; exact matched UTC hour boundaries; no shifts, interpolation, outcome exclusions or forecast refitting.',
};
fs.mkdirSync('work/forecast-research/counter-audit', { recursive: true });
fs.writeFileSync(
  'work/forecast-research/counter-audit/inputs.json',
  JSON.stringify({
    archiveActual: archive.actual.filter((r) =>
      dates.some(
        (date) =>
          r.start >= slotsForDay(date)[0].start &&
          r.start <= slotsForDay(date).at(-1).start,
      ),
    ),
    // Original full responses already exist in append-only research storage.
    sourceResearchIds: [
      'solar-full-history-v1-66acd8997e24f971babf',
      'inverter-evidence-v1-60ce0c99f8c8a4f2e59c',
    ],
    evidence: evidence.map(({ date, sha256, receivedAt }) => ({
      date,
      sha256,
      receivedAt,
    })),
    code: fs.readFileSync('scripts/audit-hourly-counters.mjs', 'utf8'),
  }),
);
fs.writeFileSync(
  'docs/hourly-counter-audit.json',
  JSON.stringify(payload, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    days: days.map(({ rows: _rows, ...summary }) => summary),
    largestDifferences: days
      .flatMap((d) => d.rows)
      .filter((r) => r.differenceKwh !== null)
      .sort((a, b) => Math.abs(b.differenceKwh) - Math.abs(a.differenceKwh))
      .slice(0, 12),
  }),
);
