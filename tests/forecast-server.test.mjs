import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_SCHEDULE } from '../lib/contracts.ts';
mock.module('../lib/contracts-server.ts', {
  namedExports: { readContracts: async () => CONTRACT_SCHEDULE },
});
let user,
  cache,
  queries,
  limited,
  dbFailure,
  cacheFailure,
  locked,
  records,
  config;
mock.module('../lib/auth.ts', {
  namedExports: {
    getUser: async (fresh) => {
      if (fresh === true) queries.push(['auth-fresh']);
      return user;
    },
    authLimit: async () => !limited,
    sameOrigin: (r) => r.headers.get('origin') === new URL(r.url).origin,
  },
});
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async () => cache,
    cacheWrite: async (k, v) => {
      if (cacheFailure) throw Error('private cache secret');
      cache = v;
    },
    withCacheLock: async (k, work) =>
      locked ? { busy: true } : { busy: false, value: await work() },
  },
});
mock.module('../lib/forecast-weather.ts', {
  namedExports: {
    fetchForecastWeather: async () => ({
      status: 'unconfigured',
      hours: [],
      fetchedAt: null,
      raw: null,
    }),
  },
});
let gridCalls = 0;
const gridSnapshot = {
  status: 'available',
  receivedAt: '2026-10-12T17:57:11.427Z',
  notices: [],
  publishedAt: null,
  applicability: 'unconfirmed',
  appliedToForecast: false,
};
mock.module('../lib/grid-outages-server.ts', {
  namedExports: {
    fetchGridOutages: async () => {
      gridCalls++;
      return gridSnapshot;
    },
  },
});
mock.module('../db/index.ts', {
  namedExports: {
    db: () => ({
      prepare: (sql) => ({
        bind(...args) {
          queries.push([sql, ...args]);
          return {
            first: async () => {
              if (dbFailure) throw Error('private database secret');
              if (sql.includes('forecast_settings'))
                return config ? { config } : null;
              if (sql.includes('SELECT count')) return { hours: 0, mae: null };
              if (sql.includes('SELECT payload'))
                return records.length ? { payload: records.at(-1) } : null;
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (dbFailure) throw Error('private database secret');
              if (sql.startsWith('INSERT INTO forecast_runs'))
                records.push(JSON.parse(args[5]));
              if (sql.startsWith('INSERT INTO forecast_settings'))
                config = JSON.parse(args[1]);
            },
          };
        },
      }),
    }),
  },
});
const {
  handleForecastGet,
  handleForecastPost,
  handleForecastCron,
  runForecast,
  forecastCronTime,
} = await import('../lib/forecast-server.ts');
const { defaultForecastConfig } = await import('../lib/forecast-model.ts');
const req = (body = { action: 'refresh' }, origin = 'https://example.com') =>
  new Request('https://example.com/api/forecast', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  user = { userId: 'user', plantOwner: 'assigned', role: 'admin' };
  cache = null;
  queries = [];
  limited = false;
  dbFailure = false;
  cacheFailure = false;
  locked = false;
  records = [];
  config = null;
  gridCalls = 0;
});
await test('anonymous, viewer and foreign-origin writes fail before source or SQL reads', async () => {
  user = null;
  assert.equal((await handleForecastPost(req())).status, 401);
  user = { role: 'viewer' };
  assert.equal((await handleForecastPost(req())).status, 403);
  user.role = 'admin';
  assert.equal(
    (await handleForecastPost(req({}, 'https://foreign.example'))).status,
    403,
  );
  assert.ok(queries.every((q) => q[0] === 'auth-fresh'));
});
await test('a warm cache read does not wake SQL and another owner cache is never exposed', async () => {
  cache = {
    owner: 'assigned',
    config: defaultForecastConfig(),
    forecast: null,
  };
  assert.equal((await handleForecastGet()).status, 200);
  assert.equal(queries.length, 0);
  cache = {
    owner: 'other',
    config: { private: 'other-owner' },
    forecast: null,
  };
  const result = await (await handleForecastGet()).json();
  assert.ok(!JSON.stringify(result).includes('other-owner'));
  assert.ok(!('owner' in result));
  assert.ok(queries.length > 0);
});
await test('request owner is ignored, SQL binds assigned plant, and repeated runs deduplicate', async () => {
  const result = await handleForecastPost(
    req({ action: 'refresh', owner: 'foreign' }),
  );
  assert.equal(result.status, 200);
  assert.equal(records.length, 1);
  const inserted = queries.find((q) =>
    q[0].startsWith('INSERT INTO forecast_runs'),
  );
  assert.deepEqual(JSON.parse(inserted[7]).gridOutages, gridSnapshot);
  assert.equal('gridOutages' in records[0], false);
  assert.ok(!JSON.stringify(queries).includes('foreign'));
  await handleForecastPost(req());
  assert.equal(records.length, 1);
  assert.equal(cache.owner, 'assigned');
  assert.equal(gridCalls, 1);
});
await test('invalid settings, limits and locks return actionable status codes', async () => {
  assert.equal(
    (await handleForecastPost(req({ action: 'configure', config: {} }))).status,
    400,
  );
  limited = true;
  assert.equal((await handleForecastPost(req())).status, 429);
  limited = false;
  locked = true;
  assert.equal((await handleForecastPost(req())).status, 409);
});
await test('failed cache publication never reports success and persistence remains retryable', async () => {
  cacheFailure = true;
  const result = await handleForecastPost(req());
  assert.equal(result.status, 503);
  assert.ok(!(await result.text()).includes('secret'));
  assert.equal(records.length, 1);
  cacheFailure = false;
  await runForecast('assigned');
  assert.equal(records.length, 1);
  assert.equal(cache.forecast.id, records[0].id);
});
await test('cron is authenticated and exits before SQL outside local schedule in both seasons', async () => {
  process.env.CRON_SECRET = 'test-cron';
  process.env.FUSIONSOLAR_OWNER = 'assigned';
  assert.equal(
    (
      await handleForecastCron(
        new Request('https://example.com/api/forecast-sync'),
      )
    ).status,
    401,
  );
  assert.equal(forecastCronTime(new Date('2026-07-11T06:20:00Z')), true);
  assert.equal(forecastCronTime(new Date('2026-12-11T07:20:00Z')), true);
  const r = await handleForecastCron(
    new Request('https://example.com/api/forecast-sync', {
      headers: { authorization: 'Bearer test-cron' },
    }),
    new Date('2026-07-11T07:20:00Z'),
  );
  assert.deepEqual(await r.json(), { skipped: true });
  assert.equal(queries.length, 0);
});
