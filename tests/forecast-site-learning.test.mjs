import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultForecastConfig } from '../lib/forecast-model.ts';
import { slotsForDay } from '../lib/energy.ts';
import {
  SITE_FEATURES,
  SITE_LEARNING_VERSION,
  siteFeatures,
  siteForecast,
  sitePrediction,
  validSiteModel,
} from '../lib/forecast-site-learning.ts';
import { siteTrialScore } from '../lib/forecast-site-trial.ts';

const c = {
  ...defaultForecastConfig(),
  latitude: 41.068056,
  longitude: 21.036111,
  acKw: 875,
};
const now = new Date('2026-10-12T18:00:00Z');
const artifact = () => ({
  version: SITE_LEARNING_VERSION,
  method: 'catboost',
  trainedAt: '2026-10-12T12:00:00Z',
  trainingEnd: '2026-10-11T14:00:00Z',
  validUntil: '2026-10-19T12:00:00Z',
  latitude: c.latitude,
  longitude: c.longitude,
  acKw: 875,
  features: [...SITE_FEATURES],
  trainingHours: 300,
  trainingDays: 25,
  model: {
    bias: 0,
    scale: 1,
    trees: [
      {
        splits: [
          { feature: 0, border: 0.5 },
          { feature: 1, border: 0.3 },
        ],
        leaves: [0.1, 0.2, 0.3, 0.4],
      },
    ],
  },
});
const hours = (date) =>
  slotsForDay(date).map((h) => ({ start: h.start, irradiance: 400 }));

void test('features require exact local days including DST, unique UTC hours and finite GHI', () => {
  for (const day of ['2026-10-13', '2026-10-25', '2026-03-29'])
    assert.equal(siteFeatures(hours(day), c).length, slotsForDay(day).length);
  assert.equal(siteFeatures(hours('2026-10-13').slice(1), c).length, 0);
  assert.throws(() =>
    siteFeatures([...hours('2026-10-13'), hours('2026-10-13')[0]], c),
  );
  assert.throws(() =>
    siteFeatures([{ start: '2026-10-13T10:00:00.000Z', irradiance: NaN }], c),
  );
});
void test('portable oblivious trees use the trained feature order and leaf bit order', () => {
  const x = Array(SITE_FEATURES.length).fill(0);
  const a = artifact();
  assert.equal(sitePrediction(x, a), 87.5);
  x[0] = 0.6;
  assert.equal(sitePrediction(x, a), 175);
  x[1] = 0.4;
  assert.equal(sitePrediction(x, a), 350);
});
void test('stale, future, corrupt, wrong-site and changed-capacity artifacts fail closed', () => {
  assert.equal(validSiteModel(artifact(), c, now), true);
  for (const patch of [
    { latitude: 42 },
    { acKw: 900 },
    { features: [...SITE_FEATURES].reverse() },
    { trainedAt: '2026-10-13T00:00:00Z' },
    { validUntil: '2026-10-12T17:00:00Z' },
    { trainingEnd: '2026-10-12T12:00:00Z' },
    { model: { trees: [] } },
    { trainingHours: 119 },
  ])
    assert.equal(validSiteModel({ ...artifact(), ...patch }, c, now), false);
});
void test('night is zero, day is bounded, missing weather is missing', () => {
  const rows = hours('2026-10-13'),
    a = artifact();
  a.model.bias = 5;
  const prediction = siteForecast(rows, c, a, now);
  assert.equal(prediction[0].productionKwh, 0);
  assert.equal(prediction[12].productionKwh, 875);
  assert.deepEqual(siteForecast(rows.slice(1), c, a, now), []);
  assert.deepEqual(siteForecast(rows, c, a, new Date('2026-10-20')), []);
});
void test('live comparison keeps identical actuals and causal first issues; never scores missing as zero', () => {
  const row = {
    start: '2026-10-13T10:00:00.000Z',
    issuedAt: '2026-10-12T18:00:00.000Z',
    actualKwh: 100,
    productionKwh: 90,
    baselineKwh: 80,
  };
  const result = siteTrialScore(
    [
      row,
      { ...row, issuedAt: '2026-10-12T19:00:00.000Z', productionKwh: 100 },
      { ...row, start: '2026-10-13T11:00:00.000Z', productionKwh: null },
      {
        ...row,
        start: '2026-10-13T12:00:00.000Z',
        issuedAt: '2026-10-13T09:00:00.000Z',
      },
    ],
    new Date('2026-10-14'),
  );
  assert.equal(result.hours, 1);
  assert.equal(result.candidateWape, 10);
  assert.equal(result.baselineWape, 20);
  assert.equal(
    siteTrialScore([row], new Date('2026-10-13T10:30:00Z')).hours,
    0,
  );
});
