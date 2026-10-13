// Read-only production audit. Never prints credentials, sessions or device IDs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { db } from '../db/index.ts';
import {
  localDate,
  localHour,
  slotsForDay,
  MEMO_URL,
  parseMemo,
} from '../lib/energy.ts';

const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const instants = [
  '2026-03-29T00:59:00Z',
  '2026-03-29T01:00:00Z',
  '2026-10-25T00:59:00Z',
  '2026-10-25T01:00:00Z',
  '2027-03-28T00:59:00Z',
  '2027-03-28T01:00:00Z',
  '2027-10-31T00:59:00Z',
  '2027-10-31T01:00:00Z',
];
const [clock, readings, prices, samples, transitions, collectors] =
  await Promise.all([
    db()
      .prepare(
        "SELECT current_setting('TimeZone') AS session_zone,now() AS database_now",
      )
      .first(),
    db()
      .prepare(
        'SELECT start,observed_at,updated_at FROM readings WHERE owner=? ORDER BY start',
      )
      .bind(owner)
      .all(),
    db()
      .prepare('SELECT start,market_date,fetched_at FROM prices ORDER BY start')
      .all(),
    db()
      .prepare(
        'SELECT count(*) AS count,min(measured_at) AS first,max(measured_at) AS last,count(*) FILTER (WHERE received_at<measured_at) AS receipt_before_measurement FROM forecast_inverter_samples WHERE owner=?',
      )
      .bind(owner)
      .first(),
    db()
      .prepare(
        "SELECT value AS instant,to_char(value::timestamptz AT TIME ZONE 'Europe/Skopje','YYYY-MM-DD') AS local_day,extract(hour FROM value::timestamptz AT TIME ZONE 'Europe/Skopje')::int AS local_hour FROM jsonb_array_elements_text(?::jsonb)",
      )
      .bind(JSON.stringify(instants))
      .all(),
    db()
      .prepare(
        'SELECT started_at,completed_at,status FROM collector_runs ORDER BY started_at DESC LIMIT 3',
      )
      .all(),
  ]);
const canonical = (value) =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const invalidReadings = readings.results.filter(
  (r) =>
    ![r.start, r.observed_at, r.updated_at].every(canonical) ||
    Date.parse(r.start) % 3600000 !== 0,
);
const invalidPrices = prices.results.filter(
  (r) =>
    ![r.start, r.fetched_at].every(canonical) ||
    Date.parse(r.start) % 3600000 !== 0 ||
    localDate(r.start) !== r.market_date,
);
for (const r of transitions.results) {
  assert.equal(r.local_day, localDate(r.instant));
  assert.equal(r.local_hour, localHour(r.instant));
}
const result = {
  auditedAt: new Date().toISOString(),
  clock,
  runtime: {
    node: process.version,
    icu: process.versions.icu,
    tz: process.versions.tz,
  },
  readings: {
    count: readings.results.length,
    first: readings.results[0]?.start,
    last: readings.results.at(-1)?.start,
    invalidUtcKeysOrReceipts: invalidReadings.length,
  },
  prices: {
    count: prices.results.length,
    first: prices.results[0]?.start,
    last: prices.results.at(-1)?.start,
    invalidUtcKeysReceiptsOrMarketDay: invalidPrices.length,
  },
  inverterSamples: samples,
  postgresIntlAgreement: transitions.results,
  collectors: collectors.results,
  deliveryDays: ['2026-03-29', '2026-10-25', '2027-03-28', '2027-10-31'].map(
    (day) => ({
      day,
      hours: slotsForDay(day).length,
      first: slotsForDay(day)[0].start,
      end: slotsForDay(day).at(-1).end,
    }),
  ),
  memoProbes: [],
};

// Probe already-published transition days, without inserting or changing prices.
for (const day of ['2026-03-29', '2025-10-26']) {
  try {
    const response = await fetch(MEMO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ date: day }),
      signal: AbortSignal.timeout(18000),
    });
    const html = await response.text();
    let parsed = [],
      parseError = null;
    try {
      parsed = parseMemo(html).filter((p) => p.marketDate === day);
    } catch (error) {
      parseError = error.message;
    }
    fs.mkdirSync('work/timezone-audit', { recursive: true });
    fs.writeFileSync(`work/timezone-audit/memo-${day}.html`, html);
    result.memoProbes.push({
      day,
      status: response.status,
      bytes: Buffer.byteLength(html),
      hours: parsed.length,
      expected: slotsForDay(day).length,
      parseError,
    });
  } catch (error) {
    result.memoProbes.push({ day, error: error.message });
  }
}
fs.writeFileSync(
  'docs/timezone-audit.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result, null, 2));
assert.equal(invalidReadings.length, 0);
assert.equal(invalidPrices.length, 0);
