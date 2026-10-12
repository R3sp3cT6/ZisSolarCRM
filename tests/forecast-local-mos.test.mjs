import test from 'node:test';
import assert from 'node:assert/strict';
import { mosTraining, localMos } from '../lib/forecast-local-mos.ts';
const now = new Date('2026-10-12T18:00:00Z');
const target = {
  start: '2026-10-13T10:00:00.000Z',
  originAt: now.toISOString(),
  baseKwh: 200,
  solarHour: 12,
  csi: 0.8,
  clearSky: 500,
};
const rows = Array.from({ length: 12 }, (_, d) =>
  Array.from({ length: 5 }, (_, h) => {
    const start = new Date(
      Date.parse('2026-10-11T08:00:00Z') - d * 86400000 + h * 3600000,
    ).toISOString();
    return {
      ...target,
      start,
      originAt: new Date(Date.parse(start) - 86400000).toISOString(),
      observedAt: new Date(Date.parse(start) + 7200000).toISOString(),
      revisionId: d * 5 + h,
      actualKwh: 180,
      solarHour: 10 + h,
    };
  }),
).flat();
test('local L1 learns bounded bias; identity data remains identity', () => {
  const r = localMos(rows, target, now, 875);
  assert.equal(r.status, 'ready');
  assert.equal(r.productionKwh, 180);
  assert.equal(r.factor, 0.9);
  assert.equal(
    localMos(
      rows.map((r) => ({ ...r, actualKwh: 200 })),
      target,
      now,
      875,
    ).factor,
    1,
  );
  assert.equal(
    localMos(
      rows.map((r) => ({ ...r, actualKwh: 0 })),
      target,
      now,
      875,
    ).factor,
    0.85,
  );
  assert.equal(
    localMos(
      rows.map((r) => ({ ...r, actualKwh: 800 })),
      target,
      now,
      875,
    ).factor,
    1.15,
  );
});
test('future receipts/target truths/unfinished origin day cannot change fit', () => {
  const expected = localMos(rows, target, now, 875);
  const corrupt = [
    ...rows,
    ...rows.map((r) => ({
      ...r,
      start: '2026-10-12T10:00:00.000Z',
      actualKwh: 875,
    })),
    ...rows.map((r) => ({
      ...r,
      observedAt: '2026-10-14T00:00:00Z',
      actualKwh: 875,
    })),
    { ...rows[0], start: target.start, actualKwh: 875 },
  ];
  assert.deepEqual(localMos(corrupt, target, now, 875), expected);
});
test('insufficient independent days, missing training, low light keep exact baseline', () => {
  assert.equal(
    localMos(rows.slice(0, 15), target, now, 875).status,
    'insufficient',
  );
  assert.equal(localMos([], target, now, 875).productionKwh, 200);
  assert.equal(
    localMos(rows, { ...target, baseKwh: 0, clearSky: 0 }, now, 875)
      .productionKwh,
    0,
  );
  assert.equal(
    localMos(rows, { ...target, csi: NaN }, now, 875).status,
    'invalid',
  );
});
test('causal revision selection retains completed valid revision before partial/future update', () => {
  const h = rows[0];
  const revisions = [
    { id: 'a', start: h.start, observedAt: h.observedAt, productionKwh: 180 },
    {
      id: 'partial',
      start: h.start,
      observedAt: new Date(Date.parse(h.start) + 1800000).toISOString(),
      productionKwh: 800,
    },
    {
      id: 'future',
      start: h.start,
      observedAt: '2026-10-14T00:00:00Z',
      productionKwh: 875,
    },
  ];
  const fit = mosTraining([h], revisions, now, 875);
  assert.equal(fit.length, 1);
  assert.equal(fit[0].revisionId, 'a');
  assert.equal(fit[0].actualKwh, 180);
  assert.deepEqual(
    mosTraining(
      [h],
      [
        ...revisions,
        {
          id: 'null',
          start: h.start,
          observedAt: new Date(Date.parse(h.observedAt) + 1000).toISOString(),
          productionKwh: null,
        },
      ],
      now,
      875,
    ),
    [],
  );
});
