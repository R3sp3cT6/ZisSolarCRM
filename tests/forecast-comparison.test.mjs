import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  firstForecasts,
  dayAheadForecasts,
  attachForecastComparison,
} from '../lib/forecast-comparison.ts';
import { buildDashboard } from '../lib/dashboard.ts';
import { slotsForDay } from '../lib/energy.ts';

let entries, view, calls, rows, busy, failed;
mock.module('../lib/forecast-server.ts', {
  namedExports: { readForecast: async (owner) => ({ owner, forecast: view }) },
});
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (key) => entries.get(key) ?? null,
    cacheWrite: async (key, value) => {
      entries.set(key, value);
    },
    withCacheLock: async (key, work) =>
      busy ? { busy: true } : { busy: false, value: await work() },
  },
});
mock.module('../db/index.ts', {
  namedExports: {
    db: () => ({
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            calls.push({ sql, args });
            if (failed) throw Error('private connection failure');
            return { results: rows };
          },
        }),
      }),
    }),
  },
});
mock.module('../lib/forecast-backtest-server.ts', {
  namedExports: { readBacktest: async () => null },
});
const { readForecastComparison } =
  await import('../lib/forecast-comparison-server.ts');
const day = '2026-10-12';
const prediction = (
  start = slotsForDay(day)[12].start,
  productionKwh = 400,
  issuedAt = '2026-10-11T12:00:00Z',
) => ({ start, productionKwh, issuedAt, modelVersion: 'weather-test' });
function dashboard(date = day, period = 'day') {
  return buildDashboard(
    {
      owner: 'owner',
      plant: null,
      readings: [],
      prices: [],
      reports: [],
      syncs: [],
      fusionState: {},
      configured: false,
      savedAt: '2026-10-11T12:00:00Z',
    },
    date,
    period,
  );
}
beforeEach(() => {
  entries = new Map();
  calls = [];
  rows = [{ ...prediction(), cohort: 'first' }];
  busy = false;
  failed = false;
  view = { id: 'run-1', issuedAt: '2026-10-11T12:00:00Z' };
});

void test('comparison freezes the first valid forecast and rejects hindsight, unknowns and invalid values', () => {
  const hour = prediction();
  const result = firstForecasts([
    { ...hour, productionKwh: 999, issuedAt: hour.start },
    { ...hour, productionKwh: 900, issuedAt: '2026-10-12T09:00:00Z' },
    hour,
    { ...hour, productionKwh: null, issuedAt: '2026-10-10T00:00:00Z' },
    { ...hour, productionKwh: -1, issuedAt: '2026-10-10T00:00:00Z' },
    { ...hour, productionKwh: NaN },
    { ...hour, start: 'invalid' },
  ]);
  assert.equal(result.size, 1);
  assert.equal(result.get(hour.start).productionKwh, 400);
});

void test('forecast-only hours extend the chart without changing real production, revenue or totals', () => {
  const base = dashboard();
  const hour = prediction();
  const result = attachForecastComparison(base, { hours: [hour] });
  assert.equal(result.chart.length, 24);
  assert.equal(result.chart[12].forecastProductionKwh, 400);
  assert.equal(result.chart[12].productionKwh, null);
  assert.equal(result.chart[12].revenue, null);
  assert.equal(result.chart[11].forecastProductionKwh, null);
  assert.deepEqual(result.totals, base.totals);
  assert.equal(result.forecastComparison.status, 'partial');
  assert.equal(
    attachForecastComparison(base, { hours: [] }).forecastComparison.status,
    'missing',
  );
});

void test('strip evaluation separates simulation and forecast, using only paired completed hours in the selected range', () => {
  const date = '2026-10-01',
    base = dashboard(date),
    slots = slotsForDay(date);
  const [a, b, current, future] = slots.slice(10, 14).map((s) => s.start);
  base.generatedAt = new Date(Date.parse(current) + 1800000).toISOString();
  base.rows = [a, b, current, future].map((start) => ({
    start,
    productionKwh: 100,
    partial: false,
  }));
  const result = attachForecastComparison(base, {
    hours: [a, current, future].map((start) =>
      prediction(start, 90, '2026-09-30T12:00:00Z'),
    ),
    backtest: {
      id: 'sim',
      createdAt: '2026-10-11T15:00:00Z',
      modelVersion: 'replay',
      fromDate: date,
      toDate: date,
      source: 'NOAA GFS',
      days: [
        {
          date,
          historyDays: 14,
          productionKwh: 150,
          hours: [a, b].map((start) => ({
            start,
            productionKwh: 75,
            originAt: '2026-09-30T18:00:00Z',
            weatherRunAt: '2026-09-30T12:00:00Z',
          })),
        },
      ],
    },
  });
  const [forecast, simulation] = result.forecastComparison.evaluations;
  assert.equal(forecast.hours, 1);
  assert.equal(forecast.actualKwh, 100);
  assert.equal(forecast.predictedKwh, 90);
  assert.equal(forecast.matchPercent, 90);
  assert.equal(simulation.hours, 1);
  assert.equal(simulation.predictedKwh, 75);
  assert.equal(simulation.matchPercent, 75);
  assert.deepEqual(result.totals, base.totals);
});

void test('daily aggregation keeps missing forecast hours unknown, preserves zero and handles both DST transitions', () => {
  for (const [date, count] of [
    ['2026-03-29', 23],
    ['2026-10-25', 25],
  ]) {
    const hours = slotsForDay(date).map((s) =>
      prediction(s.start, 10, '2026-01-01T00:00:00Z'),
    );
    const hourly = attachForecastComparison(dashboard(date), { hours });
    assert.equal(hourly.chart.length, count);
    assert.equal(new Set(hourly.chart.map((p) => p.key)).size, count);
    assert.equal(hourly.forecastComparison.status, 'complete');
    const month = attachForecastComparison(dashboard(date, 'month'), { hours });
    assert.equal(
      month.chart.find((p) => p.key === date).forecastProductionKwh,
      count * 10,
    );
    const partial = attachForecastComparison(dashboard(date, 'month'), {
      hours: hours.slice(1),
    });
    assert.equal(
      partial.chart.find((p) => p.key === date).forecastProductionKwh,
      null,
    );
  }
  assert.equal(
    attachForecastComparison(dashboard(), {
      hours: [prediction(slotsForDay(day)[0].start, 0)],
    }).chart[0].forecastProductionKwh,
    0,
  );
});

void test('monthly points require a complete calendar month and never sum incomplete days as a full month', () => {
  const hours = [];
  for (let n = 1; n <= 28; n++)
    hours.push(
      ...slotsForDay(`2026-02-${String(n).padStart(2, '0')}`).map((s) =>
        prediction(s.start, 1, '2026-01-01T00:00:00Z'),
      ),
    );
  const base = dashboard('2026-02-12', 'year');
  assert.equal(
    attachForecastComparison(base, { hours }).chart[1].forecastProductionKwh,
    672,
  );
  assert.equal(
    attachForecastComparison(base, { hours: hours.slice(1) }).chart[1]
      .forecastProductionKwh,
    null,
  );
});

void test('warm shared comparison reads use zero SQL, new saved runs invalidate by revision, and owner data is isolated', async () => {
  rows.push({ ...prediction(undefined, 450), cohort: 'day-ahead' });
  const read = await readForecastComparison('owner');
  assert.deepEqual(read.hours, [prediction()]);
  assert.deepEqual(read.dayAheadHours, [prediction(undefined, 450)]);
  assert.equal(calls.length, 1);
  await readForecastComparison('owner');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['owner', view.issuedAt]);
  assert.match(calls[0].sql, /r\.issued_at < \(h.value->>'start'\)/);
  assert.match(calls[0].sql, /productionSource.*weather.*weather-history/);
  assert.match(calls[0].sql, /r\.issued_at ASC/);
  assert.match(calls[0].sql, /interval '18 hours'/);
  assert.match(calls[0].sql, /ORDER BY d.value->>'date', r.issued_at DESC/);
  view = { ...view, id: 'run-2' };
  await readForecastComparison('owner');
  assert.equal(calls.length, 2);
  entries.set('forecast-comparison:v2:other:run-2', {
    owner: 'owner',
    revision: 'run-2',
    hours: rows,
  });
  rows = [];
  assert.deepEqual((await readForecastComparison('other')).hours, []);
  assert.equal(calls.at(-1).args[0], 'other');
});

void test('no saved run avoids SQL; a busy cache or failed storage does not hide measured data', async () => {
  view = null;
  assert.deepEqual(await readForecastComparison('owner'), {
    hours: [],
    dayAheadHours: [],
  });
  assert.equal(calls.length, 0);
  view = { id: 'run-1', issuedAt: '2026-10-11T12:00:00Z' };
  busy = true;
  assert.equal((await readForecastComparison('owner')).unavailable, true);
  assert.equal(calls.length, 0);
  busy = false;
  failed = true;
  const result = await readForecastComparison('owner');
  assert.equal(
    attachForecastComparison(dashboard(), result).forecastComparison.status,
    'unavailable',
  );
});

void test('day-ahead cutoff rejects same-day, too-early and after-cutoff runs across local midnight and DST', () => {
  for (const date of ['2026-03-29', '2026-10-25']) {
    const previous = date === '2026-03-29' ? '2026-03-28' : '2026-10-24';
    const start = slotsForDay(date)[0].start;
    const eligible = prediction(start, 100, previous + 'T18:00:00Z');
    assert.equal(dayAheadForecasts([eligible]).size, 1);
    for (const issuedAt of [
      previous + 'T18:00:00.001Z',
      previous + 'T23:00:00Z', // next local day even though UTC date is unchanged
      new Date(Date.parse(previous + 'T12:00:00Z') - 86400000).toISOString(),
      'invalid',
    ])
      assert.equal(dayAheadForecasts([{ ...eligible, issuedAt }]).size, 0);
  }
});

void test('primary day-ahead score cannot borrow perfect same-day predictions or simulations; outages remain errors', () => {
  const base = dashboard();
  const slots = slotsForDay(day);
  const [a, b, c] = slots.slice(10, 13).map((s) => s.start);
  base.generatedAt = '2026-10-13T00:00:00Z';
  base.rows = [
    { start: a, productionKwh: 100 },
    { start: b, productionKwh: 0 },
    { start: c, productionKwh: 100 },
  ];
  const hours = [
    prediction(a, 100, '2026-10-12T06:00:00Z'),
    prediction(b, 0, '2026-10-12T06:00:00Z'),
    prediction(c, 100, '2026-10-12T06:00:00Z'),
  ];
  const result = attachForecastComparison(base, {
    hours,
    dayAheadHours: [prediction(a, 90), prediction(b, 50)],
  });
  assert.equal(result.forecastComparison.dayAheadScore.wapePercent, 60);
  assert.equal(result.forecastComparison.dayAheadScore.matchPercent, 40);
  assert.equal(result.forecastComparison.dayAheadScore.pairedHours, 2);
  assert.equal(result.forecastComparison.dayAheadScore.completedHours, 24);
  assert.equal(result.forecastComparison.evaluations[0].wapePercent, 0);
  assert.equal(
    attachForecastComparison(base, { hours }).forecastComparison.dayAheadScore
      .matchPercent,
    null,
  );
});

void test('retained incomplete past hours stay visible but never enter day-ahead accuracy', () => {
  const base=dashboard(),[a,b]=slotsForDay(day).slice(10,12).map(s=>s.start);
  base.generatedAt='2026-10-13T00:00:00Z';
  base.rows=[{start:a,productionKwh:100,partial:true},{start:b,productionKwh:100,partial:false}];
  const result=attachForecastComparison(base,{hours:[],dayAheadHours:[prediction(a,100),prediction(b,80)]});
  assert.equal(result.rows[0].productionKwh,100);
  assert.equal(result.forecastComparison.dayAheadScore.pairedHours,1);
  assert.equal(result.forecastComparison.dayAheadScore.wapePercent,20);
});
