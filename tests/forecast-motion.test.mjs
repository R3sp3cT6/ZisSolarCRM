import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gridTranslation,
  satelliteMotion,
  advectedIndex,
} from '../lib/forecast-satellite-motion.ts';

const pattern = (x, y) =>
  0.7 +
  0.25 * Math.sin(x * 1.19 + y * 0.42) +
  0.18 * Math.cos(y * 1.01 - x * 0.37);
const frame = (step, dx = 2, dy = -1) => ({
  slotTime: new Date(
    Date.parse('2026-09-09T09:00Z') + step * 900000,
  ).toISOString(),
  createdAt: new Date(
    Date.parse('2026-09-09T09:13Z') + step * 900000,
  ).toISOString(),
  receivedAt: new Date(
    Date.parse('2026-09-09T09:15Z') + step * 900000,
  ).toISOString(),
  latitudes: Array.from({ length: 25 }, (_, y) => 41.65 - y * 0.05),
  longitudes: Array.from({ length: 33 }, (_, x) => 20.25 + x * 0.05),
  csi: Array.from({ length: 25 }, (_, y) =>
    Array.from({ length: 33 }, (_, x) => pattern(x - step * dx, y - step * dy)),
  ),
});
void test('translation sign and backward sampling follow an approaching cloud field', () => {
  const vector = gridTranslation(frame(0), frame(1));
  assert.equal(vector.dx, 2);
  assert.equal(vector.dy, -1);
  const state = satelliteMotion(
    [frame(0), frame(1), frame(2)],
    new Date('2026-09-09T10:00Z'),
  );
  assert.equal(state.status, 'ready');
  const sample = advectedIndex(
    state,
    Date.parse(state.observedAt) + 900000,
    0.9,
  );
  const expected =
    0.9 * (1 - state.confidence) +
    pattern(16 - 3 * 2, 12 + 3) * state.confidence;
  assert.ok(Math.abs(sample.csi - expected) < 1e-10);
});
void test('flat clear skies and missing retrievals do not manufacture motion', () => {
  const a = frame(0),
    b = frame(1);
  a.csi = a.csi.map((row) => row.map(() => 1));
  b.csi = b.csi.map((row) => row.map(() => 1));
  assert.equal(gridTranslation(a, b), null);
  b.csi = b.csi.map((row) => row.map(() => null));
  assert.equal(gridTranslation(frame(0), b), null);
});
void test('future arrival, skipped frames and stale images cannot affect forecast', () => {
  const frames = [frame(0), frame(1), frame(2)];
  const now = new Date('2026-09-09T10:00Z');
  assert.notEqual(
    satelliteMotion(
      [
        ...frames.slice(0, 2),
        { ...frames[2], receivedAt: '2026-09-09T10:01Z' },
      ],
      now,
    ).status,
    'ready',
  );
  assert.notEqual(
    satelliteMotion([frame(0), frame(1), frame(3)], now).status,
    'ready',
  );
  assert.notEqual(
    satelliteMotion(frames, new Date('2026-09-09T11:00Z')).status,
    'ready',
  );
});
void test('edge escape and masked pixels fall back without extrapolating sunlight', () => {
  const state = satelliteMotion(
    [frame(0), frame(1), frame(2)],
    new Date('2026-09-09T10:00Z'),
  );
  assert.equal(
    advectedIndex(state, Date.parse(state.observedAt) - 1, 0.9).weight,
    0,
  );
  assert.equal(
    advectedIndex(
      { ...state, dx: 6 },
      Date.parse(state.observedAt) + 7 * 900000,
      0.9,
    ).csi,
    0.9,
  );
  state.grid.csi[13][14] = null;
  assert.equal(
    advectedIndex(state, Date.parse(state.observedAt) + 900000, 0.9).csi,
    0.9,
  );
});
