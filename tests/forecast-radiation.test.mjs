import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  hourlyRadiation,
  parseGfsRadiation,
  GFS_RADIATION_FIELD as field,
} from '../lib/forecast-radiation.ts';
import { defaultForecastConfig } from '../lib/forecast-model.ts';
let cache,
  requests,
  fail = false;
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (k) => cache.get(k) ?? null,
    cacheWrite: async (k, v) => cache.set(k, v),
    withCacheLock: async (k, fn) => ({ busy: false, value: await fn() }),
  },
});
const { fetchRadiation, latestGfsRun } =
  await import('../lib/forecast-radiation-server.ts');
const { applyRadiation, applyAtmosphere } =
  await import('../lib/forecast-weather.ts');
const config = {
  ...defaultForecastConfig(),
  latitude: 41.068056,
  longitude: 21.036111,
  acKw: 875,
};
const run = '2026-10-11T06:00:00Z',
  now = new Date('2026-10-11T12:00:00Z');
const catalog = 'GFS_Global_0p25deg_20261011_0600.grib2';
const das = `${field} { String units "W.m-2"; String coordinates "reftime time lat lon "; }
time { String bounds "time_bounds"; }
time_bounds { String units "Hour since ${run}"; }`;
const bounds = 'time_bounds[2][2]\n[0], 0.0, 3.0\n[1], 0.0, 6.0\n';
const csv = `time,latitude[unit="degrees_north"],longitude[unit="degrees_east"],${field}[unit="W.m-2"]
2026-10-11T07:30:00Z,41.0,21.0,200
2026-10-11T09:00:00Z,41.0,21.0,300`;
const intervals = [
  { start: run, end: '2026-10-11T09:00:00Z', value: 200 },
  { start: run, end: '2026-10-11T12:00:00Z', value: 300 },
];
beforeEach(() => {
  cache = new Map();
  requests = [];
  fail = false;
  globalThis.fetch = async (url) => {
    const href =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    requests.push(href);
    return fail
      ? new Response('', { status: 503 })
      : new Response(
          href.includes('catalog')
            ? catalog
            : href.includes('.das')
              ? das
              : href.includes('.ascii')
                ? bounds
                : csv,
        );
  };
});
test('GFS interval means de-average correctly and conserve energy when allocated to hours', () => {
  const hours = hourlyRadiation(intervals, config);
  assert.equal(hours.length, 6);
  assert.ok(
    Math.abs(hours.slice(0, 3).reduce((s, h) => s + h.irradiance, 0) - 600) <
      1e-8,
  );
  assert.ok(
    Math.abs(hours.slice(3).reduce((s, h) => s + h.irradiance, 0) - 1200) <
      1e-8,
  );
  assert.notEqual(hours[0].irradiance, hours[1].irradiance);
  assert.equal(hourlyRadiation([intervals[1]], config).length, 0);
  assert.throws(() => hourlyRadiation([...intervals, intervals[0]], config));
  const bad = [intervals[0], { ...intervals[1], value: 30 }];
  assert.equal(hourlyRadiation(bad, config).length, 3);
});
test('NCSS midpoint labels require verified original CF bounds, correct units and nearby coordinates', () => {
  const parsed = parseGfsRadiation(csv, das, bounds, run, config);
  assert.equal(parsed.hours[0].start, '2026-10-11T06:00:00.000Z');
  assert.equal(parsed.hours.at(-1).start, '2026-10-11T11:00:00.000Z');
  for (const [a, b, c] of [
    [csv.replaceAll('W.m-2', 'J.m-2'), das, bounds],
    [csv, das.replaceAll('2026-10-11', '2026-10-10'), bounds],
    [csv, das, ''],
    [csv.replaceAll('41.0', '42.0'), das, bounds],
    [csv.replace('07:30', '08:00'), das, bounds],
  ])
    assert.throws(() => parseGfsRadiation(a, b, c, run, config));
});
test('night stays zero; invalid or oversized radiation cannot become production', () => {
  assert.ok(
    hourlyRadiation(
      [
        {
          start: '2026-10-11T00:00:00Z',
          end: '2026-10-11T03:00:00Z',
          value: 0,
        },
      ],
      config,
    ).every((h) => h.irradiance === 0),
  );
  assert.throws(() =>
    hourlyRadiation([{ ...intervals[0], value: NaN }], config),
  );
  assert.throws(() =>
    hourlyRadiation([{ ...intervals[0], value: 1900 }], config),
  );
  assert.throws(() =>
    hourlyRadiation([{ ...intervals[0], end: '2026-10-11T09:30:00Z' }], config),
  );
});

test('renumbered CF time1 axis is followed after a GFS run update; wrong bounds fail closed', async () => {
  const changed=das.replaceAll('time_bounds','time1_bounds').replaceAll('reftime time lat','reftime time1 lat').replace('time {','time1 {');
  const changedBounds=bounds.replaceAll('time_bounds','time1_bounds');
  assert.equal(parseGfsRadiation(csv,changed,changedBounds,run,config).hours.length,6);
  assert.throws(()=>parseGfsRadiation(csv,changed,bounds,run,config));
  globalThis.fetch=async url=>{
    const href=String(url);requests.push(href);
    return new Response(href.includes('catalog')?catalog:href.includes('.das')?changed:href.includes('.ascii?time1_bounds')?changedBounds:csv);
  };
  assert.equal((await fetchRadiation(config,now)).source.status,'ready');
  assert.ok(requests.some(r=>r.endsWith('.ascii?time1_bounds')));
});
test('provider picks an explicit fresh run; external catalog cannot change request origin', () => {
  const found = latestGfsRun(
    catalog + ' GFS_Global_0p25deg_20261012_0000.grib2 https://evil.test/Best',
    now,
  );
  assert.equal(found.issuedAt, run);
  assert.ok(found.path.startsWith('grib/NCEP/GFS/'));
  assert.throws(() => latestGfsRun(catalog, new Date('2026-10-13T06:00:00Z')));
});
test('radiation uses shared cache; raw metadata and bounds survive, and source failure is cached briefly', async () => {
  const first = await fetchRadiation(config, now);
  assert.equal(first.source.status, 'ready');
  assert.equal(requests.length, 4);
  assert.equal(first.raw.bounds, bounds);
  assert.deepEqual(
    await fetchRadiation(config, new Date('2026-10-11T13:00:00Z')),
    first,
  );
  assert.equal(requests.length, 4);
  cache.clear();
  requests = [];
  fail = true;
  assert.equal(
    (await fetchRadiation(config, now)).source.status,
    'unavailable',
  );
  await fetchRadiation(config, new Date('2026-10-11T12:10:00Z'));
  assert.equal(requests.length, 1);
});
test('GFS flux is not attenuated twice, GTI stays intact, gaps keep the labelled cloud fallback', () => {
  const weather = [
    {
      start: 'a',
      irradiance: 60,
      irradianceKind: 'estimated-ghi',
      aerosolFactor: 0.8,
      resolutionHours: 1,
    },
    { start: 'b', irradiance: 300, irradianceKind: 'gti', resolutionHours: 1 },
    {
      start: 'c',
      irradiance: 100,
      irradianceKind: 'estimated-ghi',
      resolutionHours: 6,
    },
  ];
  const merged = applyRadiation(
    weather,
    [
      { start: 'a', irradiance: 400 },
      { start: 'b', irradiance: 450 },
    ],
    run,
  );
  assert.equal(merged[0].irradiance, 400);
  assert.equal(merged[0].aerosolFactor, null);
  assert.equal(merged[0].irradianceKind, 'modeled-ghi');
  assert.deepEqual(merged[1], weather[1]);
  assert.deepEqual(merged[2], weather[2]);
  assert.deepEqual(
    applyAtmosphere(merged.slice(0, 1), [], config),
    merged.slice(0, 1),
  );
});
