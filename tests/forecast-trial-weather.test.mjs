import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrialHours } from '../lib/forecast-trial-weather.ts';
import {
  TRIAL_VERSION,
  makeNowcast,
  trialPower,
} from '../lib/forecast-trial.ts';
import { defaultForecastConfig } from '../lib/forecast-model.ts';

const now = new Date('2026-10-11T10:11Z');
const config = {
  ...defaultForecastConfig(),
  acKw: 875,
  latitude: 41.068056,
  longitude: 21.036111,
};
const calibration = {
  samples: 100,
  days: 14,
  coefficients: [
    { hour: 7, factor: 1000 },
    { hour: 17, factor: 1000 },
  ],
};
const at = (h) => `2026-10-11T${String(h).padStart(2, '0')}:00:00.000Z`;
const icon = Array.from({ length: 9 }, (_, i) => ({
  start: at(i + 7),
  irradiance: 400,
  diffuse: 100,
}));
const weather = icon
  .filter((h) => h.start >= at(10))
  .map((h) => ({
    ...h,
    temperature: 20,
    windSpeed: 2,
    cloudCover: null,
    irradianceKind: 'modeled-ghi',
    resolutionHours: 1,
  }));
const previous = {
  config,
  version: TRIAL_VERSION,
  issuedAt: '2026-10-11T06:20:00.000Z',
  hours: icon.map((h) => ({
    start: h.start,
    baselineKwh: 100,
    iconKwh: 999,
    weather: { temperature: 18, windSpeed: 1 },
  })),
};
const build = (prior = previous, w = weather) =>
  buildTrialHours(icon, w, new Map(), config, calibration, prior, now);

void test('a fresh weather update retains the preceding midpoint required for Huawei normalization', () => {
  const missing = build(null),
    fixed = build();
  const observations = [5, 10].map((m) => ({
    measuredAt: `2026-10-11T10:${String(m).padStart(2, '0')}:00.000Z`,
    receivedAt: now.toISOString(),
    powerKw: 200,
    totalKwh: 1000 + m,
    inverters: 8,
    allProducing: true,
  }));
  assert.equal(
    trialPower(missing.hours, Date.parse(observations[0].measuredAt)),
    null,
  );
  assert.equal(
    makeNowcast(
      missing.hours,
      observations,
      config,
      'test',
      '2026-10-11T06:00Z',
      now,
    ).status,
    'low-sun',
  );
  assert.equal(
    makeNowcast(
      fixed.hours,
      observations,
      config,
      'test',
      '2026-10-11T06:00Z',
      now,
    ).status,
    'ready',
  );
  assert.deepEqual(
    fixed.retained.map((r) => r.start),
    [at(8), at(9)],
  );
  assert.ok(
    fixed.hours.find((h) => h.start === at(9)).iconKwh < 500,
    'old prediction must be recomputed using current ICON',
  );
  assert.deepEqual(
    fixed.hours.filter((h) => h.start >= at(10)),
    missing.hours,
    'future and day-ahead predictions are unchanged',
  );
});
void test('missing, future, stale and incompatible context cannot invent past weather', () => {
  for (const prior of [
    null,
    { ...previous, issuedAt: '2026-10-11T10:12Z' },
    { ...previous, issuedAt: '2026-10-10T12:00Z' },
    { ...previous, version: 'old' },
    { ...previous, config: { ...config, version: 'different' } },
  ]) {
    assert.equal(build(prior).retained.length, 0);
  }
  assert.equal(
    build({
      ...previous,
      hours: previous.hours.map((h) => ({
        ...h,
        weather: { temperature: NaN },
      })),
    }).retained.length,
    0,
  );
  assert.equal(
    build({
      ...previous,
      hours: previous.hours.map((h) => ({
        ...h,
        weather: { temperature: 20, windSpeed: Infinity },
      })),
    }).retained.length,
    0,
  );
});
void test('fresh overlapping weather wins and previous future hours are never substituted', () => {
  const overlap = { ...weather[0], start: at(9), temperature: 21 };
  const result = build(previous, [
    overlap,
    ...weather.filter((h) => h.start !== at(11)),
  ]);
  assert.equal(
    result.hours.find((h) => h.start === at(9)).weather.temperature,
    21,
  );
  assert.equal(
    result.retained.some((h) => h.start === at(9)),
    false,
  );
  assert.equal(
    result.hours.some((h) => h.start === at(11)),
    false,
  );
});
