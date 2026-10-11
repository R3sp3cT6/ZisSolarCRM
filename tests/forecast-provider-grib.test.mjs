import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  arpegeSolarMessages,
  decodeProviderSolar,
} from '../lib/forecast-provider-grib.ts';
const config = { latitude: 41.068056, longitude: 21.036111 };
void test('real ecCodes decoder selects the correct grid cell and preserves provider energy units', async () => {
  const arpege = fs.readFileSync(
    new URL('./fixtures/arpege-solar-test.grib2', import.meta.url),
  );
  const gfs = fs.readFileSync(
    new URL('./fixtures/gfs-solar-test.grib2', import.meta.url),
  );
  const a = await decodeProviderSolar(
    arpege,
    config,
    '2026-10-11T12:00:00Z',
    'arpege',
  );
  const g = await decodeProviderSolar(
    gfs,
    config,
    '2026-10-11T12:00:00Z',
    'gfs',
  );
  assert.equal(a.value, 360000);
  assert.equal(g.value, 300);
  assert.equal(a.startLead, 0);
  assert.equal(a.endLead, 1);
  assert.ok(Math.abs(a.latitude - 41.1) < 1e-8);
  await assert.rejects(
    decodeProviderSolar(arpege, config, '2026-10-11T06:00:00Z', 'arpege'),
  );
  await assert.rejects(
    decodeProviderSolar(arpege, config, '2026-10-11T12:00:00Z', 'gfs'),
  );
  await assert.rejects(
    decodeProviderSolar(
      arpege,
      { latitude: 50, longitude: 21 },
      '2026-10-11T12:00:00Z',
      'arpege',
    ),
  );
});
void test('GRIB packages reject truncation and skip net radiation instead of misreading it as downward solar', () => {
  const frame = fs.readFileSync(
    new URL('./fixtures/arpege-solar-test.grib2', import.meta.url),
  );
  assert.equal(
    [...arpegeSolarMessages(Buffer.concat([frame, frame]))].length,
    2,
  );
  assert.throws(() => [
    ...arpegeSolarMessages(frame.subarray(0, frame.length - 1)),
  ]);
  const net = Buffer.from(frame);
  let offset = 16;
  while (net[offset + 4] !== 4) offset += net.readUInt32BE(offset);
  net[offset + 10] = 9; // WMO surface net shortwave, not downward shortwave.
  assert.equal([...arpegeSolarMessages(net)].length, 0);
});
