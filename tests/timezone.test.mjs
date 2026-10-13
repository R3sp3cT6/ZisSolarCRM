import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  slotsForDay,
  localHour,
  parseMemo,
  validateReadings,
} from '../lib/energy.ts';
import { formatPlantTime } from '../lib/plant-time.ts';
import {
  counterHours,
  parseCounterHistory,
  retainLiveHours,
} from '../lib/fusion-telemetry.ts';
import { buildDashboard } from '../lib/dashboard.ts';
import { attachForecastComparison } from '../lib/forecast-comparison.ts';
import { reportTime } from '../lib/push-policy.ts';

const fixture = (day) =>
  fs.readFileSync(
    new URL(`./fixtures/memo-dst-${day}.html`, import.meta.url),
    'utf8',
  );
void test('real MEMO spring table excludes only the nonexistent zero placeholder, preserving all 23 prices', () => {
  const rows = parseMemo(fixture('2026-03-29'));
  const day = rows.filter((p) => p.marketDate === '2026-03-29');
  assert.equal(rows.length, 6 * 24 + 23);
  assert.deepEqual(
    day.map((p) => p.start),
    slotsForDay('2026-03-29').map((s) => s.start),
  );
  assert.equal(day[1].eurCents, 10843);
  assert.equal(day[2].start, '2026-03-29T01:00:00.000Z'); // 03:00 after the skipped hour
  assert.equal(day[2].eurCents, 9941);
  assert.equal(day.at(-1).eurCents, 10000);
});

void test('real MEMO autumn 02x belongs to the second UTC hour regardless of HTML order; adjacent days stay complete', () => {
  const rows = parseMemo(fixture('2025-10-26'));
  assert.equal(rows.length, 6 * 24 + 25);
  const day = rows.filter((p) => p.marketDate === '2025-10-26');
  assert.deepEqual(
    day.map((p) => p.start),
    slotsForDay('2025-10-26').map((s) => s.start),
  );
  assert.equal(day[2].start, '2025-10-26T00:00:00.000Z');
  assert.equal(day[2].eurCents, 7597); // ordinary 02, first occurrence
  assert.equal(day[3].start, '2025-10-26T01:00:00.000Z');
  assert.equal(day[3].eurCents, 7397); // 02x, second occurrence (manual Appendix G)
  assert.equal(
    rows.filter((p) => p.marketDate === '2025-10-20')[2].eurCents,
    8820,
  );
});

void test('unexpected DST prices, malformed interval labels and extra duplicates remain rejected', () => {
  const spring = fixture('2026-03-29');
  // A real zero in an existing delivery interval is retained.
  const zero = spring.replace('113,14', '0,00');
  assert.equal(
    parseMemo(zero).filter((p) => p.marketDate === '2026-03-29')[0].eurCents,
    0,
  );
  const bad = spring.replace(
    /(<td>02 - 03<\/td>.*?<td>)0,00(<\/td><\/tr>)/,
    '$11,00$2',
  );
  assert.notEqual(bad, spring);
  assert.equal(
    parseMemo(bad).filter((p) => p.marketDate === '2026-03-29').length,
    0,
  );
  assert.throws(() => parseMemo(spring.replace('03 - 04', '03 - 05')));
  const autumn = fixture('2025-10-26'),
    extra = autumn.match(/<tr><td>02x.*?<\/tr>/)[0];
  assert.equal(
    parseMemo(autumn.replace(extra, extra + extra)).filter(
      (p) => p.marketDate === '2025-10-26',
    ).length,
    0,
  );
});

void test('the displayed repeated hour is distinct, with no zone suffix on ordinary dates or spring hours', () => {
  assert.equal(
    formatPlantTime('2026-10-25T00:30:00Z', 'en-GB'),
    '02:30 (UTC+2)',
  );
  assert.equal(
    formatPlantTime('2026-10-25T01:30:00Z', 'en-GB'),
    '02:30 (UTC+1)',
  );
  assert.equal(formatPlantTime('2026-10-25T02:30:00Z', 'en-GB'), '03:30');
  assert.equal(formatPlantTime('2026-03-29T00:30:00Z', 'en-GB'), '01:30');
  assert.equal(formatPlantTime('2026-03-29T01:30:00Z', 'en-GB'), '03:30');
  assert.equal(formatPlantTime('2026-10-13T08:30:00Z', 'en-GB'), '10:30');
  assert.match(
    formatPlantTime('2026-10-25T01:30:00Z', 'en-GB', true),
    /25\/10\/2026, 02:30 \(UTC\+1\)/,
  );
});

void test('manual receipt timestamps require offsets and normalize both occurrences without collisions', () => {
  const now = new Date('2026-10-25T04:00:00Z');
  const rows = [
    {
      start: '2026-10-25T02:00:00+02:00',
      observedAt: '2026-10-25T02:45:00+02:00',
      productionKwh: 10,
    },
    {
      start: '2026-10-25T02:00:00+01:00',
      observedAt: '2026-10-25T02:45:00+01:00',
      productionKwh: 20,
    },
  ];
  assert.deepEqual(
    validateReadings(rows, now).map((r) => r.start),
    ['2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z'],
  );
  assert.deepEqual(
    validateReadings(rows, now).map((r) => r.observedAt),
    ['2026-10-25T00:45:00.000Z', '2026-10-25T01:45:00.000Z'],
  );
  for (const observedAt of ['2026-10-25T02:45:00', null, 123])
    assert.throws(() => validateReadings([{ ...rows[0], observedAt }], now));
});

void test('23/25-hour counter imports, revenue totals and forecast scoring retain every real interval', () => {
  for (const day of ['2026-03-29', '2026-10-25']) {
    const slots = slotsForDay(day),
      from = Date.parse(slots[0].start),
      to = Date.parse(slots.at(-1).end),
      now = new Date(to + 3 * 3600000);
    const raw = [...slots.map((s) => s.start), slots.at(-1).end].map(
      (start, i) => ({
        devId: 1,
        collectTime: Date.parse(start),
        dataItemMap: { total_cap: 1000 + i * 10 },
      }),
    );
    const samples = parseCounterHistory(
      raw,
      [1],
      'total_cap',
      from,
      to,
      now.getTime(),
    );
    const rows = counterHours(samples, [1], day, 'production', now);
    assert.equal(rows.length, slots.length);
    assert.equal(
      rows.reduce((s, r) => s + r.productionKwh, 0),
      slots.length * 10,
    );
    const snapshot = {
      owner: 'test',
      plant: null,
      reports: [],
      syncs: [],
      fusionState: {},
      configured: false,
      savedAt: now.toISOString(),
      readings: rows.map((r) => ({
        start: r.start,
        production_kwh: r.productionKwh,
        export_kwh: 10,
        power_kw: null,
        observed_at: r.observedAt,
        source: 'test',
        updated_at: r.observedAt,
      })),
      prices: slots.map((s) => ({
        start: s.start,
        market_date: day,
        eur_cents: 10000,
        fetched_at: new Date(from - 86400000).toISOString(),
      })),
    };
    const dashboard = buildDashboard(
      snapshot,
      day,
      'day',
      undefined,
      now.getTime(),
    );
    assert.equal(dashboard.chart.length, slots.length);
    assert.equal(dashboard.totals.missing, 0);
    assert.equal(dashboard.totals.productionKwh, slots.length * 10);
    assert.ok(
      Math.abs(
        dashboard.totals.revenue -
          slots.length * 0.01 * (day.includes('-03-') ? 91.8 : 91.5),
      ) < 1e-9,
    );
    const forecasts = slots.map((s) => ({
      start: s.start,
      productionKwh: 10,
      issuedAt: new Date(from - 8 * 3600000).toISOString(),
      modelVersion: 'test',
    }));
    const comparison = attachForecastComparison(dashboard, {
      hours: forecasts,
      dayAheadHours: forecasts,
    });
    assert.equal(
      comparison.forecastComparison.dayAheadScore.pairedHours,
      slots.length,
    );
    assert.equal(comparison.forecastComparison.dayAheadScore.wapePercent, 0);
  }
});

void test('autumn rollover retains separate partial energy for both 02:00 occurrences', () => {
  const partials = ['2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z'].map(
    (start, i) => ({
      start,
      productionKwh: 10 + i,
      exportKwh: 8 + i,
      observedAt: new Date(Date.parse(start) + 1800000).toISOString(),
    }),
  );
  const retained = retainLiveHours(
    [partials[0]],
    [partials[1]],
    Date.parse('2026-10-25T02:05:00Z'),
  );
  assert.equal(retained.length, 2);
  assert.deepEqual(
    retained.map((r) => r.productionKwh),
    [10, 11],
  );
});

void test('the deployed push schedule accepts exactly one 21:00 delivery in both seasons and transition days', () => {
  const { crons } = JSON.parse(
    fs.readFileSync(new URL('../vercel.json', import.meta.url)),
  );
  const [minute, hours] = crons
    .find((c) => c.path === '/api/push/check')
    .schedule.split(' ');
  assert.equal(minute, '0');
  for (const day of [
    '2026-01-15',
    '2026-07-15',
    '2026-03-29',
    '2026-10-25',
    '2027-03-28',
    '2027-10-31',
  ]) {
    const accepted = hours
      .split(',')
      .map((h) => new Date(`${day}T${h}:00:00Z`))
      .filter(reportTime);
    assert.equal(accepted.length, 1);
    assert.equal(localHour(accepted[0].toISOString()), 21);
  }
});

void test('calendar boundaries and fold labels do not depend on the server or viewer timezone', () => {
  const program = `import { slotsForDay } from './lib/energy.ts'; import { formatPlantTime } from './lib/plant-time.ts'; console.log(JSON.stringify([slotsForDay('2026-03-29').map(s=>s.start),slotsForDay('2026-10-25').map(s=>s.start),formatPlantTime('2026-10-25T01:30:00Z','en-GB')]));`;
  const outputs = ['UTC', 'Europe/Skopje', 'America/New_York'].map((TZ) =>
    execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        './tests/register-ts.mjs',
        '--input-type=module',
        '-e',
        program,
      ],
      { env: { ...process.env, TZ }, encoding: 'utf8' },
    ),
  );
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[0], outputs[2]);
});
