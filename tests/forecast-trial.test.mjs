import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconHours } from '../lib/forecast-icon.ts';
import {
  liveObservation,
  makeNowcast,
  trialPower,
} from '../lib/forecast-trial.ts';
import { satelliteQuality, parseSatellite } from '../lib/forecast-satellite.ts';
import { defaultForecastConfig } from '../lib/forecast-model.ts';
const config = { ...defaultForecastConfig(), acKw: 875 };
const origin = new Date('2026-10-11T10:11:00Z');
const hours = Array.from({ length: 5 }, (_, i) => ({
  start: `2026-10-11T${String(i + 9).padStart(2, '0')}:00:00.000Z`,
  baselineKwh: 200,
  iconKwh: 200,
}));
const samples = [5, 10].map((min) => ({
  measuredAt: `2026-10-11T10:${min === 5 ? '05' : '10'}:00.000Z`,
  receivedAt: '2026-10-11T10:11:00.000Z',
  powerKw: 100,
  totalKwh: 1000 + min,
  inverters: 8,
  allProducing: true,
}));
const make = (s = samples, now = origin) =>
  makeNowcast(hours, s, config, 'frozen-id', '2026-10-11T06:00:00Z', now);
test('ICON running means recover hourly energy and preserve interval totals', () => {
  const h = iconHours('2026-10-11T00:00:00Z', [
    { lead: 0, direct: 0, diffuse: 0 },
    { lead: 1, direct: 100, diffuse: 20 },
    { lead: 2, direct: 150, diffuse: 30 },
    { lead: 3, direct: 150, diffuse: 30 },
  ]);
  assert.deepEqual(
    h.map((v) => v.irradiance),
    [120, 240, 180],
  );
  assert.equal(
    h.reduce((s, v) => s + v.irradiance, 0),
    3 * 180,
  );
  assert.equal(h[0].start, '2026-10-11T00:00:00.000Z');
});
test('ICON cannot turn a gap into an hourly forecast', () => {
  assert.deepEqual(
    iconHours('2026-10-11T00:00:00Z', [
      { lead: 2, direct: 100, diffuse: 20 },
      { lead: 4, direct: 150, diffuse: 30 },
    ]),
    [],
  );
});
test('Huawei accepts complete simultaneous actual timestamps, rejects old/missing devices and retrieval-time substitutes', () => {
  const raw = [1, 2].map((devId) => ({
    devId,
    collectTime: Date.parse(samples[1].measuredAt),
    dataItemMap: { active_power: 50, total_cap: 1000 },
  }));
  assert.equal(liveObservation(raw, [1, 2], origin).powerKw, 100);
  assert.equal(liveObservation(raw.slice(1), [1, 2], origin), null);
  assert.equal(
    liveObservation(
      raw.map((r) => ({ ...r, collectTime: origin.getTime() })),
      [1, 2],
      origin,
    ),
    null,
  );
  assert.equal(
    liveObservation(raw, [1, 2], new Date(origin.getTime() + 20 * 60000)),
    null,
  );
  assert.equal(liveObservation([raw[0], raw[0]], [1, 2], origin), null);
});
test('nowcast contains only future quarters, decays correction and preserves its baseline', () => {
  const before = JSON.stringify({ hours, samples });
  const r = make();
  assert.equal(r.status, 'ready');
  assert.equal(r.hours.length, 4);
  assert.equal(r.correction.factor, 0.5);
  assert.ok(
    r.hours.every(
      (h) =>
        Date.parse(h.start) >= origin.getTime() &&
        h.predictedKwh >= 25 &&
        h.predictedKwh < 50 &&
        h.baselineKwh === 50,
    ),
  );
  assert.ok(r.hours[0].predictedKwh < r.hours[3].predictedKwh);
  assert.equal(JSON.stringify({ hours, samples }), before);
});
test('future measurements, receipt times and weather runs cannot improve an earlier forecast', () => {
  assert.equal(
    make(samples.map((s) => ({ ...s, receivedAt: '2026-10-11T10:12:00Z' })))
      .status,
    'insufficient-observations',
  );
  assert.equal(
    makeNowcast(hours, samples, config, 'id', '2026-10-11T12:00:00Z', origin)
      .status,
    'stale-weather',
  );
  assert.equal(
    makeNowcast(hours, samples, config, 'id', 'invalid', origin).status,
    'stale-weather',
  );
});
test('counter reset, stopped inverter and stale readings do not produce forecasts', () => {
  assert.equal(
    make([samples[0], { ...samples[1], totalKwh: 1 }]).status,
    'incomplete-or-stopped',
  );
  assert.equal(
    make([samples[0], { ...samples[1], allProducing: false }]).status,
    'incomplete-or-stopped',
  );
  assert.equal(make(samples, new Date('2026-10-11T10:30:00Z')).hours.length, 0);
});
test('missing hourly weather is never bridged and AC cap is respected', () => {
  assert.equal(
    trialPower([hours[0], hours[3]], Date.parse(hours[1].start)),
    null,
  );
  const high = hours.map((h) => ({ ...h, iconKwh: 800 }));
  const obs = samples.map((s) => ({ ...s, powerKw: 875 }));
  assert.ok(
    makeNowcast(
      high,
      obs,
      config,
      'id',
      '2026-10-11T06:00:00Z',
      origin,
    ).hours.every((h) => h.predictedKwh <= 875 / 4),
  );
});
test('official satellite quality bits distinguish clouds, night and failed retrievals', () => {
  assert.equal(satelliteQuality(9), 'good');
  assert.equal(satelliteQuality(133), 'good');
  assert.equal(satelliteQuality(173), 'night');
  for (const bad of [0, 255, 37, 77, 109, 197, 229])
    assert.equal(satelliteQuality(bad), 'rejected');
});
const das = `Attributes {\n    DSSF_TOT {\n        Float64 scale_factor 0.1;\n        String units "W m-2";\n        Int16 _FillValue -1;\n    }\n    FRACTION_DIFFUSE {\n        Float64 scale_factor 0.01;\n    }\n    time {\n        String units "seconds since 2026-10-11T12:00:00Z";\n    }\n    NC_GLOBAL {\n        String date_created "2026-10-11T12:18:25Z";\n        String name "MDSSFTD";\n    }\n}`;
const ascii =
  '---------------------------------------------\n' +
  [
    ['DSSF_TOT', 4423],
    ['FRACTION_DIFFUSE', 53],
    ['quality_flag', 9],
  ]
    .map(
      ([name, v]) =>
        `${name}.${name}[1][1][1]\n[0][0], ${v}\n\n${name}.time[1]\n0\n\n${name}.lat[1]\n41.050003\n\n${name}.lon[1]\n21.050003\n`,
    )
    .join('\n');
const parse = (d = das, a = ascii) =>
  parseSatellite(
    d,
    a,
    '2026-10-11T12:00:00.000Z',
    41.068056,
    21.036111,
    '2026-10-11T12:25:00Z',
  );
test('LSA NetCDF scales real Resen sample, validates coordinates/time/units', () => {
  const s = parse();
  assert.equal(s.ghi, 442.3);
  assert.equal(s.diffuseFraction, 0.53);
  assert.equal(s.quality, 'good');
  assert.throws(() => parse(das.replace('W m-2', 'J m-2')));
  assert.throws(() => parse(das, ascii.replaceAll('41.050003', '42.050003')));
  assert.throws(() => parse(das.replace('12:00:00Z', '13:00:00Z')));
});
test('missing satellite irradiance is null and never a false zero', () => {
  assert.equal(parse(das, ascii.replace('4423', '-1')).ghi, null);
});
