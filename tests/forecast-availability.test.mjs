import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  negativeMemoDecision,
  makeAvailabilityCandidate,
  ZIS_AVAILABILITY_POLICY,
} from '../lib/forecast-availability.ts';
const start = '2026-10-13T10:00:00.000Z',
  origin = '2026-10-12T18:10:00.000Z';
const price = (cents, received = '2026-10-12T12:00:00Z') => ({
  start,
  eur_cents: cents,
  fetched_at: received,
});
await test('strict negative MEMO is distinct from zero and negative net selling price; later prices and conflicting revisions stay unknown', () => {
  assert.equal(
    negativeMemoDecision([price(-1)], start, origin).state,
    'negative',
  );
  assert.equal(
    negativeMemoDecision([price(0)], start, origin).state,
    'nonnegative',
  );
  assert.equal(
    negativeMemoDecision([price(100)], start, origin).state,
    'nonnegative',
  );
  assert.equal(
    negativeMemoDecision([price(-200, '2026-10-12T18:11:00Z')], start, origin)
      .state,
    'unknown',
  );
  assert.equal(
    negativeMemoDecision([price(-1), price(1)], start, origin).state,
    'unknown',
  );
  assert.equal(
    negativeMemoDecision(
      [price(-1), price(1, '2026-10-12T16:00:00Z')],
      start,
      origin,
    ).state,
    'nonnegative',
  );
});
await test('candidate freezes a separate next-day forecast, retaining missing energy and the original weather prediction', () => {
  const hour = {
    start,
    end: '2026-10-13T11:00:00.000Z',
    memo: -1,
    priceSource: 'official',
    productionKwh: 400,
  };
  const forecast = {
    id: 'frozen-baseline',
    version: 'weather-solar-v3.2',
    issuedAt: origin,
    days: [{ date: '2026-10-13', hours: [hour] }],
  };
  const before = structuredClone(forecast);
  const candidate = makeAvailabilityCandidate(forecast, [price(-100)]);
  assert.equal(candidate.hours[0].predictionKwh, 0);
  assert.equal(candidate.hours[0].controlKwh, 400);
  assert.equal(candidate.hours[0].expectedShutdown, true);
  assert.equal(candidate.appliedToOfficial, false);
  assert.deepEqual(forecast, before);
  hour.productionKwh = null;
  assert.equal(
    makeAvailabilityCandidate(forecast, [price(-100)]).hours[0].predictionKwh,
    null,
  );
  hour.productionKwh = 400;
  hour.priceSource = 'forecast';
  assert.equal(
    makeAvailabilityCandidate(forecast, [price(-100)]).hours[0].predictionKwh,
    400,
  );
  assert.equal(
    makeAvailabilityCandidate(
      { ...forecast, issuedAt: '2026-10-11T18:00:00Z' },
      [price(-100)],
    ),
    null,
  );
  assert.equal(ZIS_AVAILABILITY_POLICY.physicalControl, false);
});
