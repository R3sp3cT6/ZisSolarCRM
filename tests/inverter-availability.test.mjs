import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inverterSamples,
  inverterCondition,
  inverterInterruptions,
} from '../lib/inverter-availability.ts';
const origin = new Date('2026-09-12T12:00:00Z');
const raw = (minute, state = 768, power = 0, id = 1) => ({
  devId: id,
  collectTime: Date.parse(
    `2026-09-12T10:${String(minute).padStart(2, '0')}:00Z`,
  ),
  dataItemMap: {
    inverter_state: state,
    active_power: power,
    total_cap: 1000,
    open_time: 1789193033.0000002,
    close_time: null,
  },
});
void test('retains partial device evidence, zeros, unknown fields and genuine receipt', () => {
  const result = inverterSamples([raw(0)], [1, 2], origin);
  assert.equal(result.length, 1);
  assert.equal(result[0].powerKw, 0);
  assert.equal(result[0].stateCode, 768);
  assert.equal(result[0].receivedAt, origin.toISOString());
  assert.equal(result[0].startupAt, new Date(1789193033000).toISOString());
  assert.equal(result[0].shutdownAt, null);
  const missing = inverterSamples(
    [{ ...raw(0), dataItemMap: { active_power: 0 } }],
    [1],
    origin,
  )[0];
  assert.equal(inverterCondition(missing), 'unknown');
  assert.equal(missing.stateCode, null);
  assert.equal(missing.totalKwh, null);
  assert.deepEqual(inverterSamples([raw(0)], [1, 1], origin), []);
});
void test('rejects future, stale-live, foreign and duplicate points without losing other devices', () => {
  assert.deepEqual(
    inverterSamples([raw(0)], [1], new Date('2026-09-12T09:59Z')),
    [],
  );
  assert.deepEqual(inverterSamples([raw(0)], [1], origin, 'live'), []);
  assert.deepEqual(inverterSamples([raw(0, 768, 0, 2)], [1], origin), []);
  const result = inverterSamples(
    [raw(0), raw(0, 512, 30), raw(0, 512, 30, 2)],
    [1, 2],
    origin,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].deviceId, 2);
});
void test('zero output and nighttime are not reported shutdowns; inconsistent codes remain visible', () => {
  const states = inverterSamples(
    [raw(0, 512), raw(5, 40960), raw(10, 768), raw(15, 768, 50), raw(20, 9999)],
    [1],
    origin,
  );
  assert.deepEqual(states.map(inverterCondition), [
    'zero-without-shutdown',
    'no-irradiation',
    'reported-shutdown',
    'inconsistent',
    'unknown',
  ]);
});
void test('power limiting and self derating remain distinct from shutdown and ordinary production', () => {
  const samples = inverterSamples(
    [raw(0, 513), raw(5, 513, 0.014), raw(10, 514, 20), raw(15, 512, 30)],
    [1],
    origin,
  );
  assert.deepEqual(samples.map(inverterCondition), [
    'power-limited',
    'power-limited',
    'self-derating',
    'producing',
  ]);
  assert.deepEqual(inverterInterruptions(samples), []);
  assert.equal(inverterInterruptions(samples, 'power-limited')[0].samples, 2);
});
void test('bounds a five-minute shutdown/resumption, never bridges gaps or incomplete edges', () => {
  const samples = inverterSamples(
    [
      raw(0, 512, 50),
      raw(5),
      raw(10),
      raw(15, 512, 40),
      raw(25),
      raw(35),
      raw(40, 512, 20),
    ],
    [1],
    origin,
  );
  const events = inverterInterruptions(samples);
  assert.equal(events.length, 3);
  assert.equal(events[0].startAfter, samples[0].measuredAt);
  assert.equal(events[0].firstObserved, samples[1].measuredAt);
  assert.equal(events[0].lastObserved, samples[2].measuredAt);
  assert.equal(events[0].resumedBy, samples[3].measuredAt);
  assert.equal(events[1].startAfter, null);
  assert.equal(events[1].resumedBy, null);
  assert.equal(events[2].resumedBy, samples.at(-1).measuredAt);
  const gap = inverterInterruptions(
    inverterSamples([raw(0), raw(10, 512, 20)], [1], origin),
  )[0];
  assert.equal(gap.resumedBy, null);
  assert.equal(gap.nextProductionObservedAt, '2026-09-12T10:10:00.000Z');
});
void test('raw event times preserve units, reject sentinels/future times and cannot supply gap boundaries', () => {
  const row = raw(0);
  row.dataItemMap.open_time = 1789193033000;
  row.dataItemMap.close_time = 4294967295;
  const result = inverterSamples([row], [1], origin)[0];
  assert.equal(result.startupAt, new Date(1789193033000).toISOString());
  assert.equal(result.shutdownRaw, 4294967295);
  assert.equal(result.shutdownAt, null);
  assert.equal(inverterInterruptions([result])[0].startAfter, null);
});
