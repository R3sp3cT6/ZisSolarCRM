import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrateSatelliteBlend,
  adaptiveSatellitePower,
} from '../lib/forecast-satellite-adaptive.ts';
const pairs = Array.from({ length: 8 }, (_, d) =>
  Array.from({ length: 12 }, (_, h) => {
    const time = Date.parse('2026-09-01T05:00Z') + d * 86400000 + h * 3600000;
    return {
      start: new Date(time).toISOString(),
      end: new Date(time + 3600000).toISOString(),
      issuedAt: new Date(time).toISOString(),
      availableAt: new Date(time + 3600000).toISOString(),
      actualKwh: 200,
      candidates: { 0.5: 125, 1: 150, 1.5: 175, 2: 200 },
    };
  }),
).flat();
const now = new Date('2026-09-09T05:00Z');
void test('causal weight learning accepts a consistent independently refitted improvement', () => {
  const c = calibrateSatelliteBlend(pairs, now);
  assert.equal(c.status, 'accepted');
  assert.equal(c.strength, 2);
  assert.equal(c.validationDays, 3);
  assert.equal(c.trainingIntervals, 96);
  assert.equal(c.baselineMaeKwh, 50);
  assert.equal(c.candidateMaeKwh, 0);
});
void test('future revisions and unfinished origin-day measurements cannot change calibration', () => {
  const future = pairs.map((p) => ({
    ...p,
    availableAt: '2026-10-01T00:00Z',
    actualKwh: 0,
  }));
  assert.deepEqual(
    calibrateSatelliteBlend([...pairs, ...future], now),
    calibrateSatelliteBlend(pairs, now),
  );
  const current = pairs.slice(0, 12).map((p) => ({
    ...p,
    start: p.start.replace('09-01', '09-09'),
    end: p.end.replace('09-01', '09-09'),
    issuedAt: p.issuedAt.replace('09-01', '09-09'),
    availableAt: p.availableAt.replace('09-01', '09-09'),
    actualKwh: 0,
  }));
  const late = new Date('2026-09-09T19:00Z');
  assert.deepEqual(
    calibrateSatelliteBlend([...pairs, ...current], late),
    calibrateSatelliteBlend(pairs, late),
  );
});
void test('a newer null revision invalidates earlier production and does not become a zero', () => {
  const invalid = pairs
    .slice(0, 12)
    .map((p) => ({ ...p, actualKwh: null, availableAt: '2026-09-08T23:00Z' }));
  const c = calibrateSatelliteBlend([...pairs, ...invalid], now);
  assert.equal(c.trainingIntervals, 84);
  assert.equal(c.trainingDays, 7);
});
void test('insufficient data and no incremental benefit retain the existing blend', () => {
  assert.equal(calibrateSatelliteBlend(pairs.slice(0, 24), now).strength, 1);
  const same = pairs.map((p) => ({
    ...p,
    candidates: { '.5': 200, 0.5: 200, 1: 200, 1.5: 200, 2: 200 },
  }));
  assert.equal(calibrateSatelliteBlend(same, now).strength, 1);
  assert.notEqual(calibrateSatelliteBlend(same, now).status, 'accepted');
});
void test('reweighting stays convex and bounded, while missing satellite stays exact fallback', () => {
  assert.deepEqual(
    adaptiveSatellitePower(400, { powerKw: 280, weight: 0.6 }, 2, 875),
    { powerKw: 210, weight: 0.95 },
  );
  assert.deepEqual(
    adaptiveSatellitePower(400, { powerKw: 400, weight: 0 }, 2, 875),
    { powerKw: 400, weight: 0 },
  );
  assert.equal(
    adaptiveSatellitePower(400, { powerKw: 280, weight: 0.6 }, 1, 875).powerKw,
    280,
  );
});
