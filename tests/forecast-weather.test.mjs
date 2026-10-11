import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let entries, requests, respond, busy;
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (key) => entries.get(key) ?? null,
    cacheWrite: async (key, value) => entries.set(key, value),
    withCacheLock: async (key, work) =>
      busy ? { busy: true } : { busy: false, value: await work() },
  },
});
const { fetchForecastWeather } = await import('../lib/forecast-weather.ts');
const { defaultForecastConfig } = await import('../lib/forecast-model.ts');
const config = {
  ...defaultForecastConfig(),
  latitude: 41.068056,
  longitude: 21.036111,
  acKw: 875,
};
const now = new Date('2026-10-11T12:00:00Z');
const raw = {
  properties: {
    meta: {
      updated_at: '2026-10-11T10:00:00Z',
      units: { air_temperature: 'celsius', cloud_area_fraction: '%' },
    },
    timeseries: ['2026-10-12T10:00:00Z', '2026-10-12T11:00:00Z'].map(
      (time) => ({
        time,
        data: {
          instant: {
            details: { air_temperature: 20, cloud_area_fraction: 75 },
          },
        },
      }),
    ),
  },
};
const response = () =>
  new Response(JSON.stringify(raw), {
    headers: {
      expires: 'Sun, 11 Oct 2026 13:00:00 GMT',
      'last-modified': 'Sun, 11 Oct 2026 10:30:00 GMT',
    },
  });
beforeEach(() => {
  entries = new Map();
  requests = [];
  busy = false;
  respond = response;
  delete process.env.OPEN_METEO_API_KEY;
  globalThis.fetch = async (url, options) => {
    requests.push({
      url:
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      options,
    });
    return respond();
  };
});
test('MET works without paid key or panel geometry, identifies client and rounds coordinates', async () => {
  const result = await fetchForecastWeather(config, now);
  assert.equal(result.status, 'ready');
  assert.equal(result.provider, 'met-norway');
  assert.equal(result.hours[0].irradianceKind, 'estimated-ghi');
  assert.ok(requests[0].url.endsWith('lat=41.0681&lon=21.0361'));
  assert.match(
    requests[0].options.headers['User-Agent'],
    /ZisSolarCRM.*github/,
  );
  await fetchForecastWeather(config, new Date('2026-10-11T12:30:00Z'));
  assert.equal(requests.length, 1);
});
test('expired shared weather is conditionally revalidated with the original last-modified', async () => {
  const first = await fetchForecastWeather(config, now);
  respond = () =>
    new Response(null, {
      status: 304,
      headers: { expires: 'Sun, 11 Oct 2026 14:00:00 GMT' },
    });
  const next = await fetchForecastWeather(
    config,
    new Date('2026-10-11T13:01:00Z'),
  );
  assert.equal(
    requests[1].options.headers['If-Modified-Since'],
    'Sun, 11 Oct 2026 10:30:00 GMT',
  );
  assert.equal(next.fetchedAt, first.fetchedAt);
  assert.equal(next.hours.length, 1);
});
test('provider failure, missing location and stale source never manufacture weather', async () => {
  respond = () => new Response('', { status: 503 });
  assert.equal((await fetchForecastWeather(config, now)).status, 'failed');
  assert.deepEqual((await fetchForecastWeather(config, now)).hours, []);
  assert.equal(
    (await fetchForecastWeather({ ...config, latitude: null }, now)).status,
    'missing-settings',
  );
  respond = response;
  assert.equal(
    (await fetchForecastWeather(config, new Date('2026-10-13T12:00:00Z')))
      .status,
    'failed',
  );
  busy = true;
  assert.equal((await fetchForecastWeather(config, now)).status, 'failed');
});
