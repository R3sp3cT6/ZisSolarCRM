import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotsForDay } from '../lib/energy.ts';
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
import { parseForecastWeather } from '../lib/forecast-weather.ts';

const config = defaultForecastConfig();
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
    config,
    weather: [],
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
  assert.equal(pvEnergy({ irradiance: 1000, temperature: 25 }, full), 875);
  assert.equal(pvEnergy({ irradiance: 500, temperature: 25 }, full), 500);
  assert.equal(pvEnergy({ irradiance: 0, temperature: 25 }, full), 0);
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
