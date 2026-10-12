// Read-only production audit and SQL fixture; never changes stored forecasts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import { COMPARISON_SQL } from '../lib/forecast-comparison-server.ts';
import { dayAheadForecasts } from '../lib/forecast-comparison.ts';
import { backtestScores } from '../lib/forecast-backtest.ts';
import { localDate, slotsForDay } from '../lib/energy.ts';
const now = new Date().toISOString();
const hash = (v) => createHash('sha256').update(v).digest('hex');
const day = '2026-10-25',
  starts = slotsForDay(day).map((s) => s.start);
const fixture = (id, issued_at, values) => ({
  id,
  issued_at,
  model_version: 'fixture',
  payload: {
    days: [
      {
        date: day,
        hours: starts.map((start, i) => ({
          start,
          productionKwh: values[i] ?? null,
          productionSource: 'weather',
        })),
      },
    ],
  },
});
const fixtures = [
  fixture('old', '2026-10-23T17:00:00Z', [400, 400]),
  fixture('morning', '2026-10-24T08:00:00Z', [300, 300]),
  fixture('last', '2026-10-24T18:00:00Z', [200, null]),
  fixture('late', '2026-10-24T18:00:01Z', [100, 100]),
  fixture('same-day', '2026-10-25T00:00:00Z', [0, 0]),
];
const fixtureSql = COMPARISON_SQL.replace(
  'SELECT * FROM forecast_runs WHERE owner=? AND issued_at<=?::timestamptz',
  'SELECT * FROM jsonb_to_recordset(?::jsonb) AS r(id text, issued_at timestamptz, model_version text, payload jsonb)',
);
const fixtureRows = (
  await db().prepare(fixtureSql).bind(JSON.stringify(fixtures)).all()
).results;
const selected = fixtureRows.filter((h) => h.cohort === 'day-ahead');
assert.equal(
  selected.length,
  1,
  'Must not fill last snapshot gaps with older hours',
);
assert.equal(selected[0].productionKwh, 200);
assert.equal(
  Date.parse(selected[0].issuedAt),
  Date.parse('2026-10-24T18:00:00Z'),
);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const rows = (await db().prepare(COMPARISON_SQL).bind(owner, now).all())
  .results;
const old = rows.filter((r) => r.cohort === 'first');
const primary = rows.filter((r) => r.cohort === 'day-ahead');
assert.equal(dayAheadForecasts(primary).size, primary.length);
const actual = (
  await db()
    .prepare(
      'SELECT start,production_kwh AS "productionKwh" FROM readings WHERE owner=? AND production_kwh IS NOT NULL AND start<?',
    )
    .bind(
      owner,
      new Date(Math.floor(Date.parse(now) / 3600000) * 3600000).toISOString(),
    )
    .all()
).results;
const dates = [...new Set(primary.map((r) => localDate(r.start)))].sort();
const days = dates.map((date) => {
  const hours = primary.filter((r) => localDate(r.start) === date);
  const issued = [
    ...new Set(hours.map((r) => new Date(r.issuedAt).toISOString())),
  ];
  assert.equal(issued.length, 1, 'A day must use one frozen issue time');
  const paired = actual.filter((r) => hours.some((h) => h.start === r.start));
  return {
    date,
    issuedAt: issued[0],
    availableHours: hours.length,
    pairedHours: paired.length,
    ...backtestScores(paired, hours),
  };
});
const report = {
  checkedAt: now,
  policy:
    'Latest previous-local-day snapshot by 18:00 UTC, no gap fallback; one snapshot/day.',
  sqlFixture:
    'passed; rejects older, after-cutoff and same-day runs; preserves null selected hours; DST day',
  oldHours: old.length,
  oldSameDayHours: old.filter(
    (r) => localDate(r.issuedAt) === localDate(r.start),
  ).length,
  oldLongerHorizonHours: old.filter(
    (r) =>
      localDate(r.issuedAt) <
      localDate(
        new Date(Date.parse(localDate(r.start) + 'T12:00:00Z') - 86400000),
      ),
  ).length,
  dayAheadHours: primary.length,
  days,
  note: 'A change in cohort is not a model improvement. Scores include outages and exclude only unpaired/unfinished hours and double zeros.',
};
const inputs = { checkedAt: now, rows, actual, fixtures, sql: COMPARISON_SQL };
fs.mkdirSync('work/forecast-research/day-ahead-comparison', {
  recursive: true,
});
const serialized = JSON.stringify(inputs);
fs.writeFileSync(
  'work/forecast-research/day-ahead-comparison/inputs.json',
  serialized + '\n',
);
report.inputSha256 = hash(serialized);
fs.writeFileSync(
  'docs/day-ahead-comparison-audit.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
