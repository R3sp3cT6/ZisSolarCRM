import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
let user, queries, cache, limited, failWrite;
let forecastSource, weatherSource, iconSource;
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
      if (forecastSource) return forecastSource;
      throw Error('Unexpected source read');
    },
  },
});
mock.module('../lib/forecast-weather.ts', {
  namedExports: {
    fetchForecastWeather: async () => {
      if (weatherSource) return weatherSource;
      throw Error('Unexpected weather fetch');
    },
  },
});
mock.module('../lib/forecast-icon-server.ts', {
  namedExports: {
    fetchIcon: async () => {
      if (iconSource) return iconSource;
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
            first: async () => {
              if (sql.includes("inputs->'context' AS context")) {
                const insert = queries.findLast(
                  (q) =>
                    q.sql.startsWith('INSERT INTO forecast_trials') &&
                    q.args[1] === args[0] &&
                    q.args[2] === args[1],
                );
                if (insert) {
                  const { view, context } = JSON.parse(insert.args[7]);
                  return { view, context };
                }
              }
              return null;
            },
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
const { readTrial, handleTrialGet, handleTrialPost, runTrial } =
  await import('../lib/forecast-trial-server.ts');
const { recordLiveTrial, recordHistoricalTrial, flushTrialPending } =
  await import('../lib/forecast-trial-live.ts');
void test('partial inverter statuses are queued without SQL and preserved across failed flushes', async () => {
  const at = Date.parse('2026-09-12T10:00Z'),
    now = new Date('2026-10-12T12:00Z');
  const raw = [
    {
      devId: 1,
      collectTime: at,
      dataItemMap: { active_power: 0, inverter_state: 768, total_cap: 1000 },
    },
  ];
  await recordHistoricalTrial('plant', raw, [1, 2], now);
  const first = structuredClone(cache.get('trial-pending:plant'));
  assert.equal(first.observations.length, 0);
  assert.equal(first.inverterSamples.length, 1);
  assert.equal(queries.length, 0);
  await recordHistoricalTrial(
    'plant',
    raw,
    [1, 2],
    new Date(now.getTime() + 10000),
  );
  assert.deepEqual(cache.get('trial-pending:plant'), first);
  failWrite = true;
  await assert.rejects(flushTrialPending('plant'));
  assert.deepEqual(cache.get('trial-pending:plant'), first);
  failWrite = false;
  await flushTrialPending('plant');
  const insert = queries.find((q) =>
    q.sql.includes('INSERT INTO forecast_inverter_samples'),
  );
  assert.deepEqual(JSON.parse(insert.args[1]), first.inverterSamples);
  assert.match(
    insert.sql,
    /ON CONFLICT\(owner,device_id,measured_at\) DO NOTHING/,
  );
  assert.deepEqual(cache.get('trial-pending:plant'), {
    observations: [],
    runs: [],
  });
  assert.equal(cache.has('trial-observations:plant'), false);
});
beforeEach(() => {
  user = { userId: 'admin', plantOwner: 'plant', role: 'admin' };
  queries = [];
  cache = new Map();
  limited = false;
  failWrite = false;
  forecastSource = weatherSource = iconSource = null;
});

void test('trial refresh preserves prior thermal context and archives its provenance', async () => {
  const { defaultForecastConfig } = await import('../lib/forecast-model.ts');
  const { localDate, slotsForDay } = await import('../lib/energy.ts');
  const { addDays } = await import('../lib/forecast-model.ts');
  const { TRIAL_VERSION } = await import('../lib/forecast-trial.ts');
  const now = new Date(),
    current = Math.floor(now.getTime() / 3600000) * 3600000;
  const config = {
    ...defaultForecastConfig(),
    latitude: 41.068056,
    longitude: 21.036111,
    acKw: 875,
  };
  const tomorrow = addDays(localDate(now), 1),
    slots = slotsForDay(tomorrow);
  const end = Date.parse(slots.at(-1).start);
  const hours = Array.from(
    { length: (end - current) / 3600000 + 4 },
    (_, i) => ({
      start: new Date(current + (i - 3) * 3600000).toISOString(),
      irradiance: 400,
      diffuse: 100,
    }),
  );
  const calibration = {
    days: 14,
    samples: 100,
    coefficients: [
      { hour: 7, factor: 1000 },
      { hour: 17, factor: 1000 },
    ],
  };
  forecastSource = {
    config,
    forecast: {
      id: 'baseline',
      config,
      calibration,
      days: [
        {
          date: tomorrow,
          hours: slots.map((s) => ({ ...s, productionKwh: 100 })),
        },
      ],
    },
  };
  weatherSource = {
    raw: {},
    issuedAt: now.toISOString(),
    hours: hours
      .filter((h) => Date.parse(h.start) >= current)
      .map((h) => ({
        ...h,
        temperature: 20,
        windSpeed: 2,
        cloudCover: null,
        irradianceKind: 'modeled-ghi',
        resolutionHours: 1,
      })),
  };
  iconSource = {
    status: 'ready',
    runAt: new Date(current - 6 * 3600000).toISOString(),
    hours,
  };
  const oldIssuedAt = new Date(current - 4 * 3600000).toISOString();
  cache.set('trial-context:plant', {
    version: TRIAL_VERSION,
    config,
    issuedAt: oldIssuedAt,
    hours: hours.map((h) => ({
      ...h,
      iconKwh: 999,
      baselineKwh: 100,
      weather: { temperature: 18, windSpeed: 1 },
    })),
  });
  const result = await runTrial('plant');
  assert.equal(result.dayAhead.hours.length, slots.length);
  const context = cache.get('trial-context:plant');
  assert.equal(context.retainedThermalHistory.length, 2);
  assert.equal(context.retainedThermalHistory[0].contextIssuedAt, oldIssuedAt);
  assert.equal(
    context.hours[0].start,
    new Date(current - 2 * 3600000).toISOString(),
  );
  const saved = queries.find(
    (q) =>
      q.sql.startsWith('INSERT INTO forecast_trials') &&
      q.args[4] === 'day-ahead',
  );
  assert.deepEqual(
    JSON.parse(saved.args[7]).context.retainedThermalHistory,
    context.retainedThermalHistory,
  );
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

void test('historical evaluation gaps queue without SQL or altering live forecast inputs', async () => {
  const now = new Date('2026-10-11T12:00Z'),
    at = Date.parse('2026-10-10T10:00Z');
  const rows = [1, 2].map((devId) => ({
    devId,
    collectTime: at,
    dataItemMap: { active_power: 50, total_cap: 200 },
  }));
  const original = {
    measuredAt: new Date(at).toISOString(),
    receivedAt: '2026-10-10T10:01:00.000Z',
    powerKw: 100,
    totalKwh: 400,
    inverters: 2,
    allProducing: true,
  };
  cache.set('trial-pending:plant', { observations: [original], runs: [] });
  await recordHistoricalTrial('plant', rows, [1, 2], now);
  await recordHistoricalTrial(
    'plant',
    rows.map((r) => ({ ...r, collectTime: at + 300000 })),
    [1, 2],
    now,
  );
  assert.equal(queries.length, 0);
  const saved = cache.get('trial-pending:plant').observations;
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0], original);
  assert.equal(saved[1].receivedAt, now.toISOString());
  assert.equal(saved[1].source, 'history');
  assert.equal(cache.has('trial-observations:plant'), false);
  assert.equal(cache.has('trial-intraday:plant'), false);
});

void test('fresh timestamped history seeds one future-only nowcast with both samples and original receipts', async () => {
  const now = new Date('2026-10-12T12:11:00Z');
  mock.timers.enable({ apis: ['Date'], now: now.getTime() });
  try {
    const { TRIAL_VERSION } = await import('../lib/forecast-trial.ts');
    const { defaultForecastConfig } = await import('../lib/forecast-model.ts');
    cache.set('trial-context:plant', {
      version: TRIAL_VERSION,
      issuedAt: '2026-10-12T11:00:00Z',
      baselineId: 'baseline',
      weatherRunAt: '2026-10-12T06:00:00Z',
      config: { ...defaultForecastConfig(), acKw: 875 },
      calibration: { days: 14, samples: 100, coefficients: [] },
      hours: [11, 12, 13, 14].map((h) => ({
        start: `2026-10-12T${h}:00:00.000Z`,
        iconKwh: 200,
        baselineKwh: 200,
      })),
    });
    const rows = [0, 5, 10].flatMap((minute, index) =>
      [1, 2].map((devId) => ({
        devId,
        collectTime: Date.parse('2026-10-12T12:00:00Z') + minute * 60000,
        dataItemMap: {
          active_power: 50,
          total_cap: 1000 + index * 5,
          inverter_state: 512,
        },
      })),
    );
    await recordHistoricalTrial('plant', rows, [1, 2], now);
    const pending = structuredClone(cache.get('trial-pending:plant'));
    assert.equal(pending.observations.length, 3);
    assert.equal(pending.inverterSamples.length, 6);
    assert.equal(pending.runs.length, 1);
    assert.equal(pending.runs[0].run.status, 'ready');
    assert.equal(pending.runs[0].run.kind, 'intraday');
    assert.equal(pending.runs[0].run.correction.observations, 2);
    assert.equal(pending.runs[0].run.correction.factor, 0.5);
    assert.ok(
      pending.runs[0].run.hours.every(
        (h) => Date.parse(h.start) >= now.getTime(),
      ),
    );
    assert.ok(
      pending.runs[0].inputs.observations.every(
        (s) => s.source === 'history' && s.receivedAt === now.toISOString(),
      ),
    );
    assert.equal(cache.get('trial-observations:plant').length, 3);
    await recordHistoricalTrial(
      'plant',
      rows,
      [1, 2],
      new Date(now.getTime() + 1000),
    );
    assert.deepEqual(
      cache.get('trial-pending:plant'),
      pending,
      'repeated history cannot reissue or rewrite receipt',
    );
    assert.equal(queries.length, 0);
  } finally {
    mock.timers.reset();
  }
});

void test('trial ingestion rejects future, backdated and expired observations and future context', async () => {
  const now = new Date('2026-10-12T12:11:00Z');
  const base = {
    measuredAt: '2026-10-12T12:05:00Z',
    receivedAt: now.toISOString(),
    powerKw: 100,
    totalKwh: 1000,
    inverters: 2,
    allProducing: true,
  };
  await recordLiveTrial(
    'plant',
    [
      { ...base, measuredAt: 'invalid' },
      { ...base, receivedAt: '2026-10-12T12:12:00Z' },
      { ...base, receivedAt: '2026-10-12T12:04:00Z' },
      { ...base, measuredAt: '2026-10-12T11:55:00Z' },
    ],
    now,
  );
  assert.equal(cache.size, 0);
  const { TRIAL_VERSION } = await import('../lib/forecast-trial.ts');
  cache.set('trial-context:plant', {
    version: TRIAL_VERSION,
    issuedAt: '2026-10-12T12:12:00Z',
  });
  await recordLiveTrial('plant', base, now);
  assert.equal(cache.get('trial-pending:plant').observations.length, 1);
  assert.equal(cache.has('trial-intraday:plant'), false);
  assert.equal(queries.length, 0);
});
