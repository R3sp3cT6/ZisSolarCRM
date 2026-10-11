import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let user, queries, cache, limited, failWrite;
mock.module('../lib/auth.ts', {
  namedExports: {
    getUser: async () => user,
    authLimit: async () => !limited,
    sameOrigin: (r) => r.headers.get('origin') === new URL(r.url).origin,
  },
});
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    sharedCache: () => true,
    cacheRead: async (k) => cache.get(k) ?? null,
    cacheWrite: async (k, v) => cache.set(k, v),
    withCacheLock: async (k, work) => ({ busy: false, value: await work() }),
  },
});
mock.module('../lib/forecast-server.ts', {
  namedExports: {
    readForecast: async () => {
      throw Error('Unexpected source read');
    },
  },
});
mock.module('../lib/forecast-weather.ts', {
  namedExports: {
    fetchForecastWeather: async () => {
      throw Error('Unexpected weather fetch');
    },
  },
});
mock.module('../lib/forecast-icon-server.ts', {
  namedExports: {
    fetchIcon: async () => {
      throw Error('Unexpected ICON fetch');
    },
  },
});
mock.module('../lib/forecast-satellite-server.ts', {
  namedExports: {
    fetchSatellite: async () => ({ status: 'unconfigured', points: [] }),
  },
});
mock.module('../db/index.ts', {
  namedExports: {
    db: () => ({
      prepare: (sql) => ({
        bind(...args) {
          queries.push({ sql, args });
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => {
              if (failWrite) throw Error('Database failure');
            },
          };
        },
      }),
    }),
  },
});
const { readTrial, handleTrialGet, handleTrialPost } =
  await import('../lib/forecast-trial-server.ts');
const { recordLiveTrial, flushTrialPending } =
  await import('../lib/forecast-trial-live.ts');
beforeEach(() => {
  user = { userId: 'admin', plantOwner: 'plant', role: 'admin' };
  queries = [];
  cache = new Map();
  limited = false;
  failWrite = false;
});
const req = (origin) =>
  new Request('https://example.com/api/forecast-trial', {
    method: 'POST',
    headers: { origin: origin ?? 'https://example.com' },
  });
void test('trial write rejects anonymous, viewers, foreign origin and rate limit before any source access', async () => {
  user = null;
  assert.equal((await handleTrialGet()).status, 401);
  assert.equal((await handleTrialPost(req())).status, 401);
  user = { userId: 'v', plantOwner: 'plant', role: 'viewer' };
  assert.equal((await handleTrialPost(req())).status, 403);
  user.role = 'admin';
  assert.equal(
    (await handleTrialPost(req('https://evil.example'))).status,
    403,
  );
  limited = true;
  assert.equal((await handleTrialPost(req())).status, 429);
  assert.equal(queries.length, 0);
});
void test('warm reads are owner-bound and perform zero SQL queries', async () => {
  const view = {
    dayAhead: null,
    intraday: null,
    satellite: { status: 'ready', points: [] },
    icon: { status: 'ready' },
    scores: [],
  };
  cache.set('forecast-trial:v34:plant', { owner: 'plant', view });
  assert.deepEqual(await readTrial('plant'), view);
  assert.equal(queries.length, 0);
  cache.set('forecast-trial:v34:other', { owner: 'plant', view });
  assert.notDeepEqual(await readTrial('other'), view);
  assert.ok(queries.every((q) => q.args[0] === 'other'));
});
void test('Huawei samples queue without SQL and a failed archive remains retryable', async () => {
  const now = new Date('2026-10-11T12:01:00Z'),
    sample = {
      measuredAt: '2026-10-11T12:00:00Z',
      receivedAt: now.toISOString(),
      powerKw: 300,
      totalKwh: 100,
      inverters: 8,
      allProducing: true,
    };
  await recordLiveTrial('plant', sample, now);
  await recordLiveTrial('plant', sample, now);
  assert.equal(queries.length, 0);
  assert.equal(cache.get('trial-pending:plant').observations.length, 1);
  failWrite = true;
  await assert.rejects(flushTrialPending('plant'));
  assert.equal(cache.get('trial-pending:plant').observations.length, 1);
  failWrite = false;
  await flushTrialPending('plant');
  assert.equal(cache.get('trial-pending:plant').observations.length, 0);
  assert.ok(queries.every((q) => q.args[0] === 'plant'));
});
