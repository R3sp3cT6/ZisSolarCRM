import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotsForDay } from '../lib/energy.ts';
import { formatNumber } from '../lib/number-format.ts';
import {
  addDays,
  defaultForecastConfig,
  validateForecastConfig,
  makeForecast,
  predictPrice,
  productionProfile,
  priceBacktest,
  pvEnergy,
  aggregateForecast,
} from '../lib/forecast-model.ts';
import {
  parseForecastWeather,
  parseMetForecast,
} from '../lib/forecast-weather.ts';
import {
  clearSkyIrradiance,
  cloudTransmission,
  calibrateSolar,
  weatherAdjustedEnergy,
} from '../lib/forecast-solar.ts';

const config = defaultForecastConfig();
test('Macedonian and English number separators are deterministic across ICU locale support', () => {
  assert.equal(formatNumber(1234.5, 2, 'mk'), '1.234,50');
  assert.equal(formatNumber(1234.5, 2, 'en'), '1,234.50');
  assert.equal(formatNumber(null), '—');
});
const prices = (from, n) =>
  Array.from({ length: n }, (_, i) =>
    slotsForDay(addDays(from, i)).map((s) => ({
      start: s.start,
      eur_cents: (100 + i) * 100,
      fetched_at: '2026-01-01T00:00:00.000Z',
    })),
  ).flat();
const readings = (from, n) =>
  Array.from({ length: n }, (_, i) =>
    slotsForDay(addDays(from, i)).map((s) => ({
      start: s.start,
      production_kwh: s.hour >= 7 && s.hour <= 18 ? 100 : 0,
      export_kwh: s.hour >= 7 && s.hour <= 18 ? 90 : 0,
    })),
  ).flat();

test('future official prices win; late revisions unavailable at issuance never enter forecasts', () => {
  const p = prices('2026-09-01', 30),
    now = new Date('2026-09-28T06:00:00Z');
  p.push({
    start: slotsForDay('2026-10-01')[0].start,
    eur_cents: 99999,
    fetched_at: '2026-10-02T00:00:00.000Z',
  });
  const result = makeForecast({
    prices: p,
    readings: [],
    config,
    weather: [],
    now,
  });
  assert.equal(result.days[0].officialHours, 24);
  assert.equal(result.days[0].hours[0].memo, 128);
  assert.equal(result.days[2].hours[0].priceSource, 'forecast');
  assert.notEqual(result.days[2].hours[0].memo, 999.99);
  assert.equal(result.days[0].revenueEur, null);
});
test('forecast lag features respect the origin for all seven horizons', () => {
  const index = new Map();
  for (let i = 0; i < 40; i++)
    index.set(addDays('2026-09-01', i), new Map([[12, i < 28 ? 100 : 9999]]));
  for (let lead = 1; lead <= 7; lead++)
    assert.equal(
      predictPrice(index, addDays('2026-09-28', lead), 12, '2026-09-28'),
      100,
    );
  assert.equal(predictPrice(new Map(), '2026-09-28', 12, '2026-09-27'), null);
});
test('production requires seven complete days; missing production is never filled with zero', () => {
  const r = readings('2026-09-01', 7);
  assert.equal(productionProfile(r, '2026-09-08').profile.get(12), 100);
  r[5].production_kwh = null;
  assert.equal(productionProfile(r, '2026-09-08').profile.size, 0);
  assert.equal(
    productionProfile(readings('2026-09-01', 7), '2026-09-07').days,
    6,
  );
});
test('revenue uses exported kWh converted to MWh and allows negative contract prices', () => {
  const p = slotsForDay('2026-09-08').map((s) => ({
    start: s.start,
    eur_cents: 100,
    fetched_at: '2026-09-07T10:00:00.000Z',
  }));
  const result = makeForecast({
    prices: p,
    readings: readings('2026-09-01', 7),
    config,
    weather: [],
    now: new Date('2026-09-07T16:00:00Z'),
  });
  assert.equal(result.days[0].revenueEur, null); // only six completed days at issuance
  const second = makeForecast({
    prices: p.map((r) => ({
      ...r,
      start: new Date(Date.parse(r.start) + 86400000).toISOString(),
    })),
    readings: readings('2026-09-01', 7),
    config: {
      ...config,
      latitude: 41,
      longitude: 21,
      dcKwp: 1000,
      acKw: 875,
      tilt: 30,
      azimuth: 0,
      gamma: 0,
      lossPercent: 0,
      inverterEfficiency: 1,
    },
    weather: slotsForDay('2026-09-09').map((s) => ({
      start: s.start,
      irradiance: s.hour >= 7 && s.hour <= 18 ? 100 : 0,
      temperature: 25,
      irradianceKind: 'gti',
      cloudCover: 0,
      resolutionHours: 1,
    })),
    now: new Date('2026-09-08T16:00:00Z'),
  });
  assert.ok(Math.abs(second.days[0].revenueEur - 1.08 * (0.94 - 2.2)) < 1e-10);
  assert.equal(second.days[0].negativeSaleHours, 24);
});
test('DST days have distinct UTC starts, correct energy totals, and 23/25 hours', () => {
  for (const [date, previous, count] of [
    ['2026-03-29', '2026-03-28', 23],
    ['2026-10-25', '2026-10-24', 25],
  ]) {
    const r = makeForecast({
      prices: [],
      readings: [],
      config,
      weather: [],
      now: new Date(previous + 'T10:00:00Z'),
    });
    assert.equal(r.days[0].date, date);
    assert.equal(r.days[0].hours.length, count);
    assert.equal(new Set(r.days[0].hours.map((h) => h.start)).size, count);
  }
  const hours = slotsForDay('2026-10-25').map((s) => ({
    ...s,
    memo: 100,
    productionKwh: 1000,
    exportKwh: 1000,
    revenueEur: 91.8,
    priceSource: 'official',
    productionSource: 'weather',
  }));
  assert.equal(aggregateForecast('2026-10-25', hours).productionKwh, 25000);
  hours[3].productionKwh = null;
  assert.equal(aggregateForecast('2026-10-25', hours).productionKwh, null);
});
test('backtests use each repeated DST settlement price without averaging the actual target', () => {
  const p = prices('2026-09-01', 60).map((r) => ({ ...r, eur_cents: 10000 })),
    repeated = slotsForDay('2026-10-25').filter((s) => s.hour === 2);
  p.find((r) => r.start === repeated[0].start).eur_cents = 0;
  p.find((r) => r.start === repeated[1].start).eur_cents = 20000;
  const score = priceBacktest(p, '2026-10-26')[0];
  assert.ok(score.mae > 0);
  assert.ok(score.rmse > 0);
});
test('physical model clips at AC capacity and respects nighttime, units, and unknown settings', () => {
  const full = {
    ...config,
    latitude: 41,
    longitude: 21,
    dcKwp: 1000,
    acKw: 875,
    tilt: 30,
    azimuth: 0,
    lossPercent: 0,
    gamma: 0,
    inverterEfficiency: 1,
  };
  assert.equal(
    pvEnergy(
      { irradiance: 1000, temperature: 25, irradianceKind: 'gti' },
      full,
    ),
    875,
  );
  assert.equal(
    pvEnergy({ irradiance: 500, temperature: 25, irradianceKind: 'gti' }, full),
    500,
  );
  assert.equal(
    pvEnergy({ irradiance: 0, temperature: 25, irradianceKind: 'gti' }, full),
    0,
  );
  assert.equal(
    pvEnergy(
      { irradiance: 500, temperature: 25, irradianceKind: 'estimated-ghi' },
      full,
    ),
    null,
  );
  assert.equal(pvEnergy({ irradiance: 500, temperature: 25 }, config), null);
  assert.throws(() => validateForecastConfig({ ...full, latitude: 91 }));
  assert.throws(() => validateForecastConfig({ ...full, dcKwp: '1000' }));
});
test('weather average radiation shifts to preceding hour; nulls and wrong units are rejected', () => {
  const raw = {
    utc_offset_seconds: 0,
    hourly_units: {
      time: 'unixtime',
      global_tilted_irradiance: 'W/m²',
      temperature_2m: '°C',
    },
    hourly: {
      time: [Date.parse('2026-10-12T11:00:00Z') / 1000],
      global_tilted_irradiance: [500],
      temperature_2m: [20],
    },
  };
  assert.equal(parseForecastWeather(raw)[0].start, '2026-10-12T10:00:00.000Z');
  raw.hourly.global_tilted_irradiance = [null];
  assert.equal(parseForecastWeather(raw).length, 0);
  raw.hourly_units.temperature_2m = '°F';
  assert.throws(() => parseForecastWeather(raw));
});

const gps = { ...config, latitude: 41.068056, longitude: 21.036111, acKw: 875 };
const met = (points) => ({
  properties: {
    meta: {
      updated_at: '2026-10-11T10:00:00Z',
      units: { air_temperature: 'celsius', cloud_area_fraction: '%' },
    },
    timeseries: points.map(([time, cloud, temp = 20]) => ({
      time,
      data: {
        instant: {
          details: { air_temperature: temp, cloud_area_fraction: cloud },
        },
      },
    })),
  },
});
const metNow = new Date('2026-10-11T12:00:00Z');

test('solar geometry uses SunCalc degree units, night is zero, and seasons change daylight radiation', () => {
  assert.equal(clearSkyIrradiance('2026-10-12T00:00:00Z', gps), 0);
  const noon = clearSkyIrradiance('2026-10-12T10:00:00Z', gps);
  assert.ok(noon > 500 && noon < 850);
  assert.ok(
    clearSkyIrradiance('2026-06-21T10:00:00Z', gps) >
      clearSkyIrradiance('2026-12-21T10:00:00Z', gps),
  );
  assert.equal(cloudTransmission(0), 1);
  assert.equal(cloudTransmission(100), 0.25);
});

test('MET instant weather interpolates to hourly midpoints, preserves resolution and never extrapolates', () => {
  const raw = met([
    ['2026-10-12T09:00:00Z', 0, 10],
    ['2026-10-12T15:00:00Z', 100, 22],
  ]);
  const w = parseMetForecast(raw, gps, metNow);
  assert.equal(w.length, 6);
  assert.equal(w[0].start, '2026-10-12T09:00:00.000Z');
  assert.equal(w[0].temperature, 11);
  assert.ok(Math.abs(w[0].cloudCover - 100 / 12) < 1e-8);
  assert.ok(
    w.every(
      (h) => h.resolutionHours === 6 && h.irradianceKind === 'estimated-ghi',
    ),
  );
  assert.equal(w.at(-1).start, '2026-10-12T14:00:00.000Z');
  raw.properties.timeseries[1].data.instant.details.cloud_area_fraction = null;
  assert.equal(parseMetForecast(raw, gps, metNow).length, 0);
});

test('MET rejects stale, future, duplicate and wrong-unit data, and refuses to bridge oversized gaps', () => {
  const raw = met([
    ['2026-10-12T09:00:00Z', 0],
    ['2026-10-12T16:00:00Z', 100],
  ]);
  assert.equal(parseMetForecast(raw, gps, metNow).length, 0);
  assert.throws(() =>
    parseMetForecast(raw, gps, new Date('2026-10-13T12:00:00Z')),
  );
  assert.throws(() =>
    parseMetForecast(raw, gps, new Date('2026-10-10T12:00:00Z')),
  );
  raw.properties.timeseries[1].time = raw.properties.timeseries[0].time;
  assert.throws(() => parseMetForecast(raw, gps, metNow));
  raw.properties.meta.units.cloud_area_fraction = 'fraction';
  assert.throws(() => parseMetForecast(raw, gps, metNow));
});

test('clouds and heat reduce production, hourly energy stays within AC cap and missing weather stays missing', () => {
  const history = readings('2026-10-01', 10).map((r) => ({
    ...r,
    production_kwh: clearSkyIrradiance(r.start, gps),
    export_kwh: clearSkyIrradiance(r.start, gps) * 0.95,
  }));
  const p = productionProfile(history, '2026-10-11');
  const calibration = calibrateSolar(p.readings, p.days, gps);
  assert.ok(calibration.coefficients.length >= 5);
  assert.deepEqual(
    calibrateSolar(p.readings, p.days, { ...gps, acKw: 100 }).coefficients,
    calibration.coefficients,
  );
  const sunny = parseMetForecast(
    met([
      ['2026-10-12T10:00:00Z', 0],
      ['2026-10-12T11:00:00Z', 0],
    ]),
    gps,
    metNow,
  )[0];
  const cloudy = parseMetForecast(
    met([
      ['2026-10-12T10:00:00Z', 100],
      ['2026-10-12T11:00:00Z', 100],
    ]),
    gps,
    metNow,
  )[0];
  const sun = weatherAdjustedEnergy(sunny, gps, calibration),
    cloud = weatherAdjustedEnergy(cloudy, gps, calibration);
  assert.ok(sun > cloud * 2 && sun <= 875);
  assert.ok(
    weatherAdjustedEnergy({ ...sunny, temperature: 40 }, gps, calibration) <
      sun,
  );
  assert.equal(
    weatherAdjustedEnergy(sunny, { ...gps, acKw: 100 }, calibration),
    100,
  );
  assert.equal(
    weatherAdjustedEnergy({ ...sunny, irradiance: 0 }, gps, calibration),
    0,
  );
  const missing = makeForecast({
    prices: [],
    readings: history,
    config: gps,
    weather: [],
    now: metNow,
  });
  assert.equal(missing.days[0].productionKwh, null);
  assert.equal(missing.days[0].hours[12].productionSource, 'missing');
  const partial = makeForecast({
    prices: [],
    readings: history,
    config: gps,
    weather: [sunny],
    now: metNow,
  });
  assert.equal(partial.days[0].productionKwh, null);
  assert.ok(
    partial.days[0].hours.find((h) => h.start === sunny.start).productionKwh >
      0,
  );
});
