import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotsForDay } from '../lib/energy.ts';
import {
  addDays,
  makeForecast,
  defaultForecastConfig,
} from '../lib/forecast-model.ts';
import { clearSkyIrradiance } from '../lib/forecast-solar.ts';
import {
  calibrateHourly,
  fitHourlyFactor,
} from '../lib/forecast-hourly-calibration.ts';

function fixture(actualFactor = 0.8) {
  const predictions = [],
    revisions = [];
  for (let i = 0; i < 12; i++) {
    const day = addDays('2026-09-20', i);
    for (const s of slotsForDay(day)) {
      const base = s.hour >= 7 && s.hour < 19 ? 100 : 0;
      predictions.push({
        start: s.start,
        baseKwh: base,
        originAt: addDays(day, -1) + 'T18:00:00Z',
        source: 'historical',
      });
      revisions.push({
        start: s.start,
        productionKwh: base * actualFactor,
        observedAt: new Date(Date.parse(s.start) + 2 * 3600000).toISOString(),
      });
    }
  }
  return { predictions, revisions, now: new Date('2026-10-03T08:00:00Z') };
}
test('L1 calibration minimizes hourly absolute error rather than matching the daily sum', () => {
  const pairs = [
    { baseKwh: 100, actual: 70 },
    { baseKwh: 100, actual: 70 },
    { baseKwh: 100, actual: 200 },
  ];
  assert.equal(fitHourlyFactor(pairs), 0.7);
  assert.notEqual(fitHourlyFactor(pairs), 340 / 300);
  assert.equal(fitHourlyFactor([{ baseKwh: 10, actual: 1000 }]), 1.3);
  assert.equal(fitHourlyFactor([]), 1);
});
test('chronological validation accepts a persistent bias and rejects a harmful correction', () => {
  const x = fixture();
  const c = calibrateHourly(x.predictions, x.revisions, x.now);
  assert.equal(c.status, 'accepted');
  assert.equal(c.factor, 0.8);
  assert.equal(c.validation.baselineWape, 25);
  assert.equal(c.validation.candidateWape, 0);
  assert.equal(c.source, 'historical');
  const changed = x.revisions.map((r) => ({
    ...r,
    productionKwh:
      r.start >= '2026-09-25T00:00:00Z' && r.productionKwh
        ? 100
        : r.productionKwh,
  }));
  assert.equal(
    calibrateHourly(x.predictions, changed, x.now).status,
    'rejected',
  );
});
test('missing daylight, short history and unfinished days cannot approve calibration', () => {
  const x = fixture();
  assert.equal(
    calibrateHourly(x.predictions.slice(0, 48), x.revisions, x.now).status,
    'insufficient',
  );
  const missing = x.revisions.filter((r) => !r.start.includes('T10:00'));
  assert.equal(calibrateHourly(x.predictions, missing, x.now).trainingHours, 0);
  const future = x.predictions.map((p) => ({
    ...p,
    start: p.start.replace('2026-09', '2027-09'),
  }));
  assert.equal(calibrateHourly(future, x.revisions, x.now).factor, 1);
});
test('late measurement revisions never leak into earlier fold fitting or earlier issued models', () => {
  const x = fixture();
  const c = calibrateHourly(x.predictions, x.revisions, x.now);
  const late = x.revisions.map((r) => ({
    ...r,
    productionKwh: 900,
    observedAt: '2026-10-04T00:00:00Z',
  }));
  assert.deepEqual(
    calibrateHourly(x.predictions, [...x.revisions, ...late], x.now),
    c,
  );
  const earlier = x.revisions.map((r) => ({
    ...r,
    productionKwh: r.productionKwh ? 90 : 0,
    observedAt: '2026-10-02T23:00:00Z',
  }));
  const revised = calibrateHourly(
    x.predictions,
    [...x.revisions, ...earlier],
    x.now,
  );
  assert.equal(revised.candidateFactor, 0.9);
  assert.equal(
    revised.validation.candidateWape,
    100 / 9,
    'fold fit used .8, not the later .9 revision',
  );
});
test('first day-ahead prospective baseline wins over replay and later forecast revisions', () => {
  const x = fixture();
  const live = x.predictions.map((p) => ({
    ...p,
    baseKwh: p.baseKwh * 0.8,
    source: 'prospective',
  }));
  const revised = live.map((p) => ({
    ...p,
    baseKwh: 999,
    originAt: p.originAt.replace('18:00', '19:00'),
  }));
  const c = calibrateHourly(
    [...x.predictions, ...revised, ...live],
    x.revisions,
    x.now,
  );
  assert.equal(c.source, 'prospective');
  assert.equal(c.factor, 1);
  assert.equal(c.status, 'rejected');
});
test('accepted correction affects only next-day GFS empirical hours and preserves raw baseline and AC cap', () => {
  const config = {
    ...defaultForecastConfig(),
    latitude: 41.068056,
    longitude: 21.036111,
    acKw: 875,
  };
  const readings = Array.from({ length: 20 }, (_, i) =>
    slotsForDay(addDays('2026-09-10', i)).map((s) => ({
      start: s.start,
      production_kwh: clearSkyIrradiance(s.start, config) * 0.6,
      export_kwh: clearSkyIrradiance(s.start, config) * 0.59,
    })),
  ).flat();
  const weather = Array.from({ length: 2 }, (_, i) =>
    slotsForDay(addDays('2026-10-01', i)).map((s) => ({
      ...s,
      irradiance: clearSkyIrradiance(s.start, config),
      temperature: 20,
      cloudCover: 0,
      irradianceKind: 'modeled-ghi',
      resolutionHours: 3,
    })),
  ).flat();
  const input = {
    config,
    readings,
    prices: [],
    weather,
    now: new Date('2026-09-30T08:00:00Z'),
  };
  const base = makeForecast(input),
    corrected = makeForecast({
      ...input,
      hourlyCalibration: { status: 'accepted', factor: 0.8 },
    });
  assert.ok(base.days[0].productionKwh > 0);
  assert.ok(
    Math.abs(
      corrected.days[0].productionKwh - base.days[0].productionKwh * 0.8,
    ) < 1e-8,
  );
  assert.equal(corrected.days[1].productionKwh, base.days[1].productionKwh);
  corrected.days[0].hours.forEach((h, i) => {
    assert.equal(h.baseProductionKwh, base.days[0].hours[i].productionKwh);
    assert.ok(h.productionKwh <= 875);
  });
  const fallback = makeForecast({
    ...input,
    weather: weather.map((w) => ({ ...w, irradianceKind: 'estimated-ghi' })),
    hourlyCalibration: { status: 'accepted', factor: 0.8 },
  });
  assert.equal(fallback.days[0].productionKwh, base.days[0].productionKwh);
});
