import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
let entries, requests, offline;
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (key) => entries.get(key) ?? null,
    cacheWrite: async (key, value) => entries.set(key, value),
    withCacheLock: async (_, work) => ({ busy: false, value: await work() }),
  },
});
const { latestSilamRun, parseSilamCsv, fetchAtmosphere } =
  await import('../lib/forecast-atmosphere.ts');
const { applyAtmosphere, parseMetForecast } =
  await import('../lib/forecast-weather.ts');
const {
  aerosolIrradianceFactor,
  solisReferenceGhi,
  cellTemperature,
  weatherAdjustedEnergy,
} = await import('../lib/forecast-solar.ts');
const { defaultForecastConfig } = await import('../lib/forecast-model.ts');
const config = {
  ...defaultForecastConfig(),
  latitude: 41.068056,
  longitude: 21.036111,
  acKw: 875,
};
const now = new Date('2026-10-11T12:00:00Z');
const issued = '2026-10-11T00:00:00Z';
const path = (time) =>
  `silam_glob_v6_1_sfc/runs/silam_glob_v6_1_sfc_RUN_${time}`;
const catalog = [issued, '2026-10-10T00:00:00Z']
  .map((time) => `<dataset urlPath="${path(time)}" />`)
  .join('');
const csv =
  'time,station,latitude[unit="degrees_north"],longitude[unit="degrees_east"],ocd_part_w550[unit=""],ocd_dust_w550[unit=""]\n2026-10-12T11:00:00Z,point,41.000,21.000,0.3,0.1\n2026-10-12T13:00:00Z,point,41.000,21.000,0.2,0.04';
beforeEach(() => {
  entries = new Map();
  requests = [];
  offline = false;
  globalThis.fetch = async (url) => {
    const address =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    requests.push(address);
    return new Response(
      offline ? '' : address.includes('catalog.xml') ? catalog : csv,
      { status: offline ? 503 : 200 },
    );
  };
});
test('SILAM accepts only a fresh allowlisted run, refusing future, stale and foreign paths', () => {
  assert.equal(latestSilamRun(catalog, now).issuedAt, issued);
  assert.throws(() => latestSilamRun(catalog, new Date('2026-10-14')));
  assert.throws(() =>
    latestSilamRun(`<dataset urlPath="${path('2026-10-12T00:00:00Z')}"/>`, now),
  );
  assert.throws(() =>
    latestSilamRun('<dataset urlPath="https://example.com/secret"/>', now),
  );
});
test('SILAM end-labelled hourly means align to start hours without filling gaps or summing dust twice', () => {
  const parsed = parseSilamCsv(csv, config, issued);
  assert.equal(parsed.latitude, 41);
  assert.equal(parsed.hours[0].start, '2026-10-12T10:00:00.000Z');
  assert.equal(parsed.hours[1].start, '2026-10-12T12:00:00.000Z');
  assert.equal(parsed.hours[0].total, 0.3);
  assert.equal(parsed.hours[0].dust, 0.1);
  assert.throws(() =>
    parseSilamCsv(csv.replaceAll('21.000', '22.000'), config, issued),
  );
  assert.throws(() =>
    parseSilamCsv(csv.replace('unit=""', 'unit="mg/m3"'), config, issued),
  );
  assert.throws(() =>
    parseSilamCsv(csv.replace('13:00:00Z', '11:00:00Z'), config, issued),
  );
  assert.throws(() => parseSilamCsv(csv, config, '2026-10-01T00:00:00Z'));
  assert.equal(
    parseSilamCsv(csv.replace(',0.3,', ',-9.9999898E14,'), config, issued).hours
      .length,
    1,
  );
  assert.equal(
    parseSilamCsv(csv.replace(',0.3,', ',,'), config, issued).hours.length,
    1,
  );
});
test('free FMI source is shared for six hours, bounded by run freshness, and outages degrade without fake AOD', async () => {
  const first = await fetchAtmosphere(config, now);
  assert.equal(first.source.status, 'ready');
  assert.equal(first.source.issuedAt, issued);
  assert.equal(requests.length, 2);
  assert.ok(
    requests[1].startsWith(
      'https://thredds.silam.fmi.fi/thredds/ncss/grid/' + path(issued),
    ),
  );
  await fetchAtmosphere(config, new Date('2026-10-11T17:59:00Z'));
  assert.equal(requests.length, 2);
  offline = true;
  const failed = await fetchAtmosphere(
    config,
    new Date('2026-10-11T18:01:00Z'),
  );
  assert.equal(failed.source.status, 'unavailable');
  assert.deepEqual(failed.hours, []);
  await fetchAtmosphere(config, new Date('2026-10-11T18:05:00Z'));
  assert.equal(requests.length, 3); // cached failure, no retry storm
  assert.equal(
    (await fetchAtmosphere(config, new Date('2026-10-14'))).source.status,
    'unavailable',
  );
});
test('Solis sensitivity reduces GHI for aerosol loading, permits cleaner air, and rejects extrapolation', () => {
  const start = '2026-10-12T10:00:00Z';
  assert.equal(aerosolIrradianceFactor(start, config, 0.1), 1);
  assert.ok(aerosolIrradianceFactor(start, config, 0.3) < 1);
  assert.ok(aerosolIrradianceFactor(start, config, 0.01) > 1);
  assert.equal(solisReferenceGhi(-3, 0.2), 0);
  assert.equal(solisReferenceGhi(40, 1), null);
  assert.equal(solisReferenceGhi(40, -0.1), null);
  assert.equal(aerosolIrradianceFactor('invalid', config, 0.2), null);
});
test('aerosols change production only within their horizon and never attenuate provider GTI twice', () => {
  const hours = [10, 11, 12].map((h) => ({
    start: `2026-10-12T${h}:00:00.000Z`,
    irradiance: 600,
    temperature: 20,
    irradianceKind: 'estimated-ghi',
  }));
  const aod = parseSilamCsv(csv, config, issued).hours;
  const changed = applyAtmosphere(hours, aod, config);
  assert.ok(changed[0].irradiance < 600);
  assert.equal(changed[1].irradiance, 600);
  assert.equal(changed[1].aerosolOpticalDepth, null);
  assert.equal(changed[0].aerosolOpticalDepth, 0.3);
  assert.deepEqual(
    applyAtmosphere([{ ...hours[0], irradianceKind: 'gti' }], aod, config),
    [{ ...hours[0], irradianceKind: 'gti' }],
  );
  const calibration = {
    samples: 30,
    days: 7,
    coefficients: [
      { hour: 8, factor: 700 },
      { hour: 16, factor: 700 },
    ],
  };
  assert.ok(
    weatherAdjustedEnergy(changed[0], config, calibration) <
      weatherAdjustedEnergy(hours[0], config, calibration),
  );
  assert.equal(
    applyAtmosphere(
      [{ ...hours[0], irradiance: 0, start: '2026-10-12T00:00:00.000Z' }],
      [{ start: '2026-10-12T00:00:00.000Z', total: 0.3, dust: 0.1 }],
      config,
    )[0].irradiance,
    0,
  );
});
test('wind cooling affects temperature and power while preserving NOCT fallback and AC cap', () => {
  assert.equal(cellTemperature(20, 800, config), 45);
  assert.equal(cellTemperature(20, 0, config, 5), 20);
  assert.ok(
    cellTemperature(20, 800, config, 5) < cellTemperature(20, 800, config, 0),
  );
  const w = { start: '2026-10-12T10:00:00Z', irradiance: 600, temperature: 30 };
  const calibration = {
    samples: 30,
    days: 7,
    coefficients: [
      { hour: 8, factor: 700 },
      { hour: 16, factor: 700 },
    ],
  };
  assert.ok(
    weatherAdjustedEnergy({ ...w, windSpeed: 5 }, config, calibration) >
      weatherAdjustedEnergy({ ...w, windSpeed: 0 }, config, calibration),
  );
  assert.ok(
    weatherAdjustedEnergy(
      { ...w, windSpeed: 50 },
      { ...config, acKw: 100 },
      calibration,
    ) <= 100,
  );
});
test('MET layers overlap, fog is a proxy, missing optional data stays null and rainfall retains six-hour resolution', () => {
  const raw = {
    properties: {
      meta: {
        updated_at: issued,
        units: {
          air_temperature: 'celsius',
          cloud_area_fraction: '%',
          cloud_area_fraction_low: '%',
          cloud_area_fraction_medium: '%',
          cloud_area_fraction_high: '%',
          fog_area_fraction: '%',
          relative_humidity: '%',
          wind_speed: 'm/s',
          precipitation_amount: 'mm',
        },
      },
      timeseries: [9, 15].map((h) => ({
        time: `2026-10-12T${String(h).padStart(2, '0')}:00:00Z`,
        data: {
          instant: {
            details: {
              air_temperature: 20,
              cloud_area_fraction: 50,
              cloud_area_fraction_low: 80,
              cloud_area_fraction_medium: 70,
              cloud_area_fraction_high: 60,
              fog_area_fraction: 90,
              relative_humidity: 98,
              wind_speed: 4,
            },
          },
          next_6_hours: { details: { precipitation_amount: 6 } },
        },
      })),
    },
  };
  const hours = parseMetForecast(raw, config, now);
  assert.equal(hours.length, 6);
  assert.equal(hours[0].cloudLow, 80);
  assert.equal(hours[0].cloudCover, 50);
  assert.equal(hours[0].precipitationMm, 1);
  assert.equal(hours[0].precipitationResolutionHours, 6);
  assert.equal(hours[0].humidity, 98);
  const withoutFog = structuredClone(raw);
  for (const row of withoutFog.properties.timeseries)
    delete row.data.instant.details.fog_area_fraction;
  const missing = parseMetForecast(withoutFog, config, now);
  assert.equal(missing[0].fogCover, null);
  assert.ok(missing[0].irradiance > hours[0].irradiance);
  withoutFog.properties.meta.units.wind_speed = 'km/h';
  assert.equal(parseMetForecast(withoutFog, config, now)[0].windSpeed, null);
});
