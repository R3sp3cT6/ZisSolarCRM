import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  gfsWeather,
  reconstructDay,
  backtestOrigin,
  backtestScores,
} from '../lib/forecast-backtest.ts';
import { defaultForecastConfig, addDays } from '../lib/forecast-model.ts';
import { clearSkyIrradiance } from '../lib/forecast-solar.ts';
import { slotsForDay } from '../lib/energy.ts';
import { attachForecastComparison } from '../lib/forecast-comparison.ts';
import { buildDashboard } from '../lib/dashboard.ts';
const config = {
  ...defaultForecastConfig(),
  latitude: 41.068056,
  longitude: 21.036111,
  acKw: 875,
};
const day = '2026-10-01';
function archive(cloud = 0) {
  const { weatherRunAt } = backtestOrigin(day);
  const f = (value, units) => ({
    value,
    units,
    latitude: 41,
    longitude: 21,
    distanceKm: 8,
    sha256: 'test',
    byteRange: '0-9',
  });
  return {
    day,
    provider: 'NOAA GFS',
    gridDegrees: 0.25,
    resolutionHours: 3,
    latitude: config.latitude,
    longitude: config.longitude,
    fetchedAt: '2026-10-11T15:00:00Z',
    points: Array.from({ length: 10 }, (_, i) => ({
      runAt: weatherRunAt,
      validAt: new Date(
        Date.parse(weatherRunAt) + (9 + 3 * i) * 3600000,
      ).toISOString(),
      sourceUrl: 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/test',
      indexSha256: 'test',
      fields: {
        cloud: f(cloud, '%'),
        temperature: f(283.15, 'K'),
        u: f(3, 'm s**-1'),
        v: f(4, 'm s**-1'),
      },
    })),
  };
}
void test('GFS replay uses archived prior-day runs, midpoint interpolation and valid units, without bridging gaps', () => {
  const clear = gfsWeather(archive(), config),
    overcast = gfsWeather(archive(100), config);
  assert.equal(clear.length, 24);
  assert.equal(clear[0].start, slotsForDay(day)[0].start);
  assert.equal(clear[12].temperature, 10);
  assert.equal(clear[12].windSpeed, 5);
  assert.equal(overcast[12].irradiance, clear[12].irradiance * 0.25);
  assert.equal(clear[0].irradiance, 0);
  const missing = archive();
  missing.points.splice(4, 1);
  assert.ok(gfsWeather(missing, config).length < 24);
  const wrongRun = archive();
  wrongRun.points[0].runAt = '2026-10-01T12:00:00Z';
  assert.throws(() => gfsWeather(wrongRun, config));
  const wrongUnit = archive();
  wrongUnit.points[0].fields.cloud.units = 'fraction';
  assert.throws(() => gfsWeather(wrongUnit, config));
});
void test('replay calibration excludes target and unfinished origin days, and never fills insufficient history', () => {
  const history = Array.from({ length: 14 }, (_, i) =>
    addDays('2026-09-30', -1 - i),
  ).flatMap((d) =>
    slotsForDay(d).map((s) => ({
      start: s.start,
      production_kwh: clearSkyIrradiance(s.start, config) * 0.8,
      export_kwh: null,
    })),
  );
  const original = reconstructDay(archive(), history, config);
  assert.equal(original.day.historyDays, 14);
  assert.ok(original.day.productionKwh > 0);
  const injected = [
    ...history,
    ...slotsForDay('2026-09-30'),
    ...slotsForDay(day),
  ].map((r) =>
    'production_kwh' in r
      ? r
      : { start: r.start, production_kwh: 999999, export_kwh: 999999 },
  );
  assert.deepEqual(reconstructDay(archive(), injected, config), original);
  assert.equal(reconstructDay(archive(), [], config).day.productionKwh, null);
});
void test('historical simulation stays labelled, does not overwrite prospective predictions or actual totals', () => {
  const start = slotsForDay(day)[12].start;
  const base = buildDashboard(
    {
      owner: 'o',
      plant: null,
      readings: [],
      prices: [],
      reports: [],
      syncs: [],
      fusionState: {},
      configured: false,
      savedAt: '',
    },
    day,
    'day',
  );
  const backtest = {
    id: 'back',
    createdAt: '2026-10-11T15:00:00Z',
    modelVersion: 'replay',
    fromDate: day,
    toDate: day,
    source: 'NOAA GFS',
    days: [
      {
        date: day,
        historyDays: 14,
        productionKwh: 300,
        hours: [{ start, productionKwh: 300, ...backtestOrigin(day) }],
      },
    ],
  };
  const replay = attachForecastComparison(base, { hours: [], backtest });
  assert.equal(replay.chart[12].forecastKind, 'backtest');
  assert.equal(replay.forecastComparison.backtestHours, 1);
  assert.deepEqual(replay.totals, base.totals);
  const combined = attachForecastComparison(base, {
    backtest,
    hours: [
      {
        start,
        productionKwh: 200,
        issuedAt: '2026-09-30T18:00:00Z',
        modelVersion: 'real',
      },
    ],
  });
  assert.equal(combined.chart[12].forecastProductionKwh, 200);
  assert.equal(combined.chart[12].forecastKind, 'forecast');
  assert.equal(combined.forecastComparison.backtestHours, 0);
  backtest.days[0].hours[0].originAt = start;
  assert.equal(
    attachForecastComparison(base, { hours: [], backtest }).forecastComparison
      .coveredHours,
    0,
  );
});
void test('error metrics exclude missing, incomplete and double-zero hours; WAPE is not an accuracy percentage', () => {
  const rows = [
    { start: 'a', productionKwh: 100 },
    { start: 'b', productionKwh: 100 },
    { start: 'night', productionKwh: 0 },
    { start: 'missing', productionKwh: null },
    { start: 'live', productionKwh: 10, partial: true },
  ];
  const hours = [
    { start: 'a', productionKwh: 120 },
    { start: 'b', productionKwh: 70 },
    { start: 'night', productionKwh: 0 },
    { start: 'missing', productionKwh: 999 },
    { start: 'live', productionKwh: 999 },
  ];
  assert.deepEqual(backtestScores(rows, hours), {
    hours: 2,
    actualKwh: 200,
    predictedKwh: 190,
    totalDifferenceKwh: -10,
    totalDifferencePercent: -5,
    matchPercent: 75,
    maeKwh: 25,
    rmseKwh: Math.sqrt(650),
    biasKwh: -5,
    wapePercent: 25,
  });
  assert.equal(
    backtestScores(
      [{ start: 'a', productionKwh: 0 }],
      [{ start: 'a', productionKwh: 5 }],
    ).wapePercent,
    null,
  );
});
void test('match score uses hourly absolute errors, clamps at zero and needs positive actual production', () => {
  const score = backtestScores(
    [
      { start: 'a', productionKwh: 100 },
      { start: 'b', productionKwh: 100 },
    ],
    [
      { start: 'a', productionKwh: 150 },
      { start: 'b', productionKwh: 50 },
    ],
  );
  assert.equal(score.actualKwh, score.predictedKwh);
  assert.equal(score.totalDifferenceKwh, 0);
  assert.equal(score.totalDifferencePercent, 0);
  assert.equal(score.wapePercent, 50, 'equal daily totals are not zero hourly error');
  assert.equal(
    score.matchPercent,
    50,
    'opposing hourly errors must not cancel',
  );
  assert.equal(
    backtestScores(
      [{ start: 'a', productionKwh: 100 }],
      [{ start: 'a', productionKwh: 300 }],
    ).matchPercent,
    0,
  );
  assert.equal(
    backtestScores(
      [{ start: 'a', productionKwh: 100 }],
      [{ start: 'a', productionKwh: 100 }],
    ).matchPercent,
    100,
  );
  assert.equal(
    backtestScores(
      [{ start: 'a', productionKwh: 0 }],
      [{ start: 'a', productionKwh: 20 }],
    ).matchPercent,
    null,
  );
  assert.equal(backtestScores([], []).predictedKwh, null);
  assert.equal(
    backtestScores(
      [{ start: 'a', productionKwh: -10 }],
      [{ start: 'a', productionKwh: 20 }],
    ).hours,
    0,
  );
});
const cache = new Map(),
  requested = [];
let queries = 0;
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (key) => cache.get(key) ?? null,
    cacheWrite: async (key, value) => cache.set(key, value),
    withCacheLock: async (key, work) => ({ busy: false, value: await work() }),
  },
});
mock.module('../db/index.ts', {
  namedExports: {
    db: () => ({
      prepare: () => ({
        bind: (owner) => ({
          first: async () => {
            queries++;
            requested.push(owner);
            return { payload: { id: 'backtest-' + owner } };
          },
        }),
      }),
    }),
  },
});
const { readBacktest } = await import('../lib/forecast-backtest-server.ts');
void test('historical replay uses a shared owner-bound cache and zero SQL on repeat reads', async () => {
  assert.equal((await readBacktest('a')).id, 'backtest-a');
  assert.equal(queries, 1);
  await readBacktest('a');
  assert.equal(queries, 1);
  cache.set('forecast-backtest:v1:b', {
    owner: 'a',
    backtest: { id: 'private-a' },
  });
  assert.equal((await readBacktest('b')).id, 'backtest-b');
  assert.deepEqual(requested, ['a', 'b']);
});
