import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let cache, requests, failRange;
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (k) => cache.get(k) ?? null,
    cacheWrite: async (k, v) => cache.set(k, v),
    withCacheLock: async (k, work) => ({ busy: false, value: await work() }),
  },
});
mock.module('../lib/forecast-provider-grib.ts', {
  namedExports: {
    arpegeSolarMessages: () => [],
    decodeProviderSolar: async (raw) => {
      const lead = raw.readUInt32LE();
      return {
        startLead: Math.floor((lead - 1) / 6) * 6,
        endLead: lead,
        value: 100,
        latitude: 41,
        longitude: 21,
      };
    },
  },
});
const { fetchModelSource } =
  await import('../lib/forecast-multimodel-sources.ts');
const now = new Date('2026-10-11T20:00:00Z'),
  config = { latitude: 41.068056, longitude: 21.036111 };
beforeEach(() => {
  cache = new Map();
  requests = [];
  failRange = false;
  mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(String(url));
    if (String(url).includes('data.gouv.fr'))
      return Response.json({
        resources: [{ url: 'https://untrusted.example/solar.grib2' }],
      });
    if (String(url).endsWith('.idx'))
      return new Response(
        '1:0:d=2026101112:DSWRF:surface:0-1 hour ave fcst:\n2:4:OTHER:surface:\n',
      );
    const raw = Buffer.alloc(4);
    raw.writeUInt32LE(Number(String(url).match(/f(\d{3})$/)[1]));
    assert.equal(options.headers.Range, 'bytes=0-3');
    return new Response(raw, {
      status: failRange ? 200 : 206,
      headers: {
        'content-range': 'bytes 0-3/100',
        'last-modified': 'Sun, 11 Oct 2026 16:00:00 GMT',
      },
    });
  });
});
void test('GFS original hourly fields cover the next local day and cached visitors do not redownload', async () => {
  const source = await fetchModelSource('gfs', config, now);
  assert.equal(source.status, 'ready');
  assert.equal(source.hours.length, 24);
  assert.equal(source.hours[0].start, '2026-10-11T22:00:00.000Z');
  assert.ok(source.hours.every((h) => h.irradiance === 100));
  const count = requests.length;
  assert.deepEqual(await fetchModelSource('gfs', config, now), source);
  assert.equal(requests.length, count);
});
void test('a range ignored by the provider fails closed and is negatively cached', async () => {
  failRange = true;
  const source = await fetchModelSource('gfs', config, now);
  assert.equal(source.status, 'unavailable');
  assert.deepEqual(source.hours, []);
  const count = requests.length;
  await fetchModelSource('gfs', config, now);
  assert.equal(requests.length, count);
});
void test('catalogue resources cannot redirect collection to an arbitrary host', async () => {
  assert.equal(
    (await fetchModelSource('arpege', config, now)).status,
    'unavailable',
  );
  assert.ok(
    requests.every((url) => url.startsWith('https://www.data.gouv.fr/')),
  );
});
