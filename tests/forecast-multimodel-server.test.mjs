import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, slotsForDay } from '../lib/energy.ts';
import { addDays, defaultForecastConfig } from '../lib/forecast-model.ts';
import { TRIAL_VERSION } from '../lib/forecast-trial.ts';
let user, cache, queries, calls, failWrite, unavailable, retained;
mock.module('../lib/auth.ts', {
  namedExports: {
    getUser: async () => user,
    authLimit: async () => true,
    sameOrigin: (r) => r.headers.get('origin') === new URL(r.url).origin,
  },
});
mock.module('../lib/shared-cache.ts', {
  namedExports: {
    cacheRead: async (k) => cache.get(k) ?? null,
    cacheWrite: async (k, v) => cache.set(k, v),
    withCacheLock: async (k, work) => ({ busy: false, value: await work() }),
  },
});
mock.module('../lib/forecast-multimodel-sources.ts', {
  namedExports: {
    fetchModelSource: async (provider, c, now) => {
      calls.push(provider);
      const missing = unavailable === provider;
      return {
        provider,
        ...(retained === provider ? { retainedAfterFailure: true } : {}),
        status: missing ? 'unavailable' : 'ready',
        runAt: new Date(now.getTime() - 6 * 3600000).toISOString(),
        fetchedAt: now.toISOString(),
        hours: missing
          ? []
          : slotsForDay(addDays(localDate(now), 1)).map((h) => ({
              start: h.start,
              irradiance: 400,
            })),
        fields: [],
        files: [],
      };
    },
  },
});
mock.module('../db/index.ts', {
  namedExports: {
    db: () => ({
      prepare: (sql) => ({
        bind(...args) {
          queries.push({ sql, args });
          return {
            first: async () => {
              if (
                sql ===
                'SELECT payload FROM forecast_trials WHERE owner=? AND run_key=?'
              ) {
                const q = queries.findLast(
                  (q) =>
                    q.sql.startsWith('INSERT INTO forecast_trials') &&
                    q.args[1] === args[0] &&
                    q.args[2] === args[1],
                );
                return q ? { payload: JSON.parse(q.args[6]) } : null;
              }
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (failWrite) throw Error('SQL failed');
            },
          };
        },
      }),
    }),
  },
});
const { runModels, readModels, handleModelsGet, handleModelsPost } =
  await import('../lib/forecast-multimodel-server.ts');
beforeEach(() => {
  user = { userId: 'admin', plantOwner: 'plant', role: 'admin' };
  queries = [];
  calls = [];
  cache = new Map();
  failWrite = false;
  unavailable = null;
  retained = null;
  const now = new Date();
  const config = {
    ...defaultForecastConfig(),
    latitude: 41.068056,
    longitude: 21.036111,
    acKw: 875,
  };
  cache.set('trial-context:plant', {
    version: TRIAL_VERSION,
    issuedAt: now.toISOString(),
    weatherRunAt: new Date(now.getTime() - 6 * 3600000).toISOString(),
    config,
    calibration: {
      days: 14,
      samples: 100,
      coefficients: [
        { hour: 7, factor: 1000 },
        { hour: 17, factor: 1000 },
      ],
    },
    hours: slotsForDay(addDays(localDate(now), 1)).map((h) => ({
      start: h.start,
      iconKwh: 100,
      baselineKwh: 90,
      weather: { temperature: 20, windSpeed: 2 },
    })),
  });
});
void test('a retained complete source keeps its provenance in the archived inputs and visible status', async () => {
  retained = 'arpege';
  const view = await runModels('plant');
  assert.equal(view.complete, true);
  assert.equal(view.sources.arpege.retainedAfterFailure, true);
  assert.equal(view.sources.gfs.retainedAfterFailure, undefined);
  const write = queries.find((q) =>
    q.sql.startsWith('INSERT INTO forecast_trials'),
  );
  const input = JSON.parse(write.args[7]);
  assert.equal(input.arpege.retainedAfterFailure, true);
  assert.equal(input.arpege.runAt, view.sources.arpege.runAt);
  assert.equal(input.arpege.fetchedAt, view.sources.arpege.fetchedAt);
});
void test('all native sources and outcomes are archived; repeat and warm reads use cache', async () => {
  const view = await runModels('plant');
  assert.equal(view.complete, true);
  assert.equal(view.selection.status, 'collecting');
  assert.equal(view.hours.length, slotsForDay(view.date).length);
  assert.deepEqual(calls.sort(), ['arpege', 'gfs']);
  const inserted = queries.find((q) =>
    q.sql.startsWith('INSERT INTO forecast_trials'),
  );
  assert.deepEqual(JSON.parse(inserted.args[6]), view);
  assert.ok(JSON.parse(inserted.args[7]).context);
  calls = [];
  queries = [];
  assert.deepEqual(await runModels('plant'), view);
  assert.equal(queries.length, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(await readModels('plant'), view);
  assert.equal(queries.length, 0);
});
void test('a missing model is explicit, gets no blend, and leaves the ICON forecast intact', async () => {
  unavailable = 'arpege';
  const view = await runModels('plant');
  assert.equal(view.complete, false);
  assert.ok(
    view.hours.every(
      (h) =>
        h.values.mean === null &&
        h.values.arpege === null &&
        h.values.icon === 100,
    ),
  );
});
void test('SQL failures cannot claim a new cached forecast; wrong owner never receives a cached view', async () => {
  failWrite = true;
  await assert.rejects(runModels('plant'), /SQL failed/);
  assert.equal(cache.get('forecast-models:v1:plant').view, null);
  cache.set('forecast-models:v1:another', {
    owner: 'plant',
    view: { secret: 'wrong owner' },
  });
  assert.equal(await readModels('another'), null);
});
void test('anonymous and ordinary users cannot trigger collection; same-origin admin is required', async () => {
  const request = (origin) =>
    new Request('https://example.com/api/forecast-models', {
      method: 'POST',
      headers: { origin },
    });
  user = null;
  assert.equal((await handleModelsGet()).status, 401);
  assert.equal(
    (await handleModelsPost(request('https://example.com'))).status,
    401,
  );
  user = { userId: 'viewer', plantOwner: 'plant', role: 'viewer' };
  assert.equal(
    (await handleModelsPost(request('https://example.com'))).status,
    403,
  );
  user.role = 'admin';
  assert.equal(
    (await handleModelsPost(request('https://wrong.example'))).status,
    403,
  );
  assert.equal(calls.length, 0);
});
void test('stale or future context cannot seed a prospective run', async () => {
  const context = cache.get('trial-context:plant');
  for (const delta of [60000, -19 * 3600000]) {
    context.issuedAt = new Date(Date.now() + delta).toISOString();
    await assert.rejects(runModels('plant'), /Refresh the ICON/);
  }
  assert.equal(calls.length, 0);
});
