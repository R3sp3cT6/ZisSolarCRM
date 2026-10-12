import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearZeroPersistence,
  measurementsKnownAt,
} from '../scripts/near-zero-persistence.mjs';
const settings = () => {
  const days = ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13'].map(
    (date) => ({
      date,
      hours: [8, 9, 10].map((h) => ({
        start: `${date}T${String(h).padStart(2, '0')}:00:00Z`,
        clearSky: 500,
        irradiance: 500,
      })),
    }),
  );
  return {
    targetDate: '2026-07-13',
    originAt: '2026-07-12T18:00:00Z',
    days,
    acKw: 875,
    known: new Map(
      days.flatMap((d) =>
        d.hours.map((h) => [h.start, { productionKwh: 0, index: 1 }]),
      ),
    ),
  };
};
void test('two complete previous days can flag near-zero response, without reading origin or target day', () => {
  const x = settings();
  for (const [s, r] of x.known) if (s >= '2026-07-12') r.productionKwh = 875;
  assert.equal(nearZeroPersistence(x).trigger, true);
  assert.deepEqual(
    nearZeroPersistence(x).evidence.map((d) => d.date),
    ['2026-07-10', '2026-07-11'],
  );
});
void test('missing, invalid, positive production or weak forecast radiation cannot masquerade as persistent shutdown', () => {
  for (const val of [null, NaN, -1, 876, 9]) {
    const x = settings();
    x.known.get('2026-07-11T09:00:00Z').productionKwh = val;
    assert.equal(nearZeroPersistence(x).trigger, false);
  }
  const missing = settings();
  missing.known.delete('2026-07-11T09:00:00Z');
  assert.equal(nearZeroPersistence(missing).trigger, false);
  const dark = settings();
  dark.days[1].hours[0].irradiance = 299;
  assert.equal(nearZeroPersistence(dark).trigger, false);
});
void test('receipt selection excludes target hindsight and incomplete-hour reports; uses latest valid received revision', () => {
  const originAt = '2026-07-12T18:00:00Z',
    start = '2026-07-11T09:00:00Z';
  const data = {
    actual: [{ start, productionKwh: 0 }],
    revisions: [
      { id: '1', start, productionKwh: 10, observedAt: '2026-07-11T09:30:00Z' },
      {
        id: '2',
        start,
        productionKwh: 500,
        observedAt: '2026-07-11T10:01:00Z',
      },
      { id: '3', start, productionKwh: 0, observedAt: '2026-07-13T10:00:00Z' },
    ],
  };
  assert.equal(
    measurementsKnownAt(data, 'receiptCausal', originAt).get(start)
      .productionKwh,
    500,
  );
  assert.equal(
    measurementsKnownAt(data, 'archiveReconstruction', originAt).get(start)
      .productionKwh,
    0,
  );
});
