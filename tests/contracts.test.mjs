import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_SCHEDULE,
  LEGACY_CONTRACT,
  OCTOBER_CONTRACT,
  contractFor,
} from '../lib/contracts.ts';
import { salePrice, revenue, slotsForDay } from '../lib/energy.ts';
import { buildDashboard } from '../lib/dashboard.ts';
import { energyReportCsv } from '../lib/energy-report.ts';
import { aggregateForecast, revalueForecast } from '../lib/forecast-model.ts';

const before = '2026-09-30T21:00:00.000Z',
  after = '2026-09-30T22:00:00.000Z';
void test('October contract starts at local midnight, including UTC hours still in September', () => {
  assert.equal(contractFor(before).version, LEGACY_CONTRACT.version);
  assert.equal(contractFor(after).version, OCTOBER_CONTRACT.version);
  assert.equal(salePrice(100, before), 91.8);
  assert.equal(salePrice(100, after), 91.5);
  assert.equal(revenue(500, 100, after), 45.75);
  assert.equal(revenue(0, 100, after), 0);
  assert.equal(salePrice(0, after), -2.5);
  assert.ok(salePrice(2.5, before) > 0 && salePrice(2.5, after) < 0);
  assert.ok(Math.abs(salePrice(-20, after) + 21.3) < 1e-12);
  assert.equal(contractFor('2026-11-01').version, OCTOBER_CONTRACT.version);
});

const snapshot = () => ({
  owner: 'owner',
  plant: null,
  contracts: [...CONTRACT_SCHEDULE],
  readings: [before, after].map((start) => ({
    start,
    production_kwh: 1100,
    export_kwh: 1000,
    power_kw: null,
    observed_at: start,
    updated_at: start,
    source: 'measured',
  })),
  prices: [before, after].map((start) => ({
    start,
    market_date: start === before ? '2026-09-30' : '2026-10-01',
    eur_cents: 10000,
    fetched_at: start,
  })),
  reports: [],
  syncs: [],
  fusionState: {},
  configured: false,
  savedAt: '2026-10-11T00:00:00Z',
});
const now = Date.parse('2026-10-11T00:00:00Z');
void test('calendar, rows, mixed-year totals, CSV and current price all use the delivery contract', () => {
  const base = snapshot();
  const sept = buildDashboard(base, '2026-09-30', 'month', undefined, now);
  const oct = buildDashboard(base, '2026-10-01', 'month', undefined, now);
  const year = buildDashboard(base, '2026-10-01', 'year', undefined, now);
  assert.equal(sept.totals.revenue, 91.8);
  assert.equal(oct.totals.revenue, 91.5);
  assert.ok(Math.abs(year.totals.revenue - 183.3) < 1e-12);
  assert.equal(year.periodContracts.length, 2);
  assert.equal(oct.periodContracts.length, 1);
  assert.equal(oct.contract.fixedEurMwh, 2.5);
  assert.equal(sept.contract.fixedEurMwh, 2.2);
  assert.equal(
    oct.dailyRevenue.find((r) => r.day === '2026-09-30').revenue,
    91.8,
  );
  assert.equal(
    oct.dailyRevenue.find((r) => r.day === '2026-10-01').revenue,
    91.5,
  );
  assert.equal(oct.market[0].sale, 91.5);
  const csv = energyReportCsv(year.rows, 'unused-fallback').split('\n');
  assert.equal(csv[1].split(',')[7], LEGACY_CONTRACT.version);
  assert.equal(csv[2].split(',')[7], OCTOBER_CONTRACT.version);
  const current = buildDashboard(
    base,
    '2026-09-30',
    'day',
    undefined,
    Date.parse(after),
  );
  assert.equal(current.contract.fixedEurMwh, 2.2);
  assert.equal(current.currentPrice.sale, 91.5);
});

void test('missing export is not counted as revenue and does not become a measured zero', () => {
  const base = snapshot();
  base.readings[1].export_kwh = null;
  const data = buildDashboard(base, '2026-10-01', 'day', undefined, now);
  assert.equal(data.rows[0].revenue, null);
  assert.equal(data.totals.revenue, null);
  assert.equal(data.rows[0].estimate, (1100 / 1000) * 91.5);
});

void test('both repeated October DST hours retain separate earnings under the new terms', () => {
  const repeated = slotsForDay('2026-10-25').filter((s) => s.hour === 2);
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0].start, repeated[1].start);
  assert.equal(
    repeated.reduce((total, s) => total + revenue(1000, 100, s.start), 0),
    183,
  );
});

void test('archived forecast financial views are repriced while as-issued production and inputs remain intact', () => {
  const days = ['2026-09-30', '2026-10-01'].map((date) => {
    const hours = slotsForDay(date).map((s) => ({
      ...s,
      memo: 2.5,
      priceSource: 'official',
      productionKwh: 1000,
      exportKwh: 900,
      powerKw: 1000,
      productionSource: 'weather',
      weather: null,
      revenueEur: revenue(900, 2.5, s.start, [LEGACY_CONTRACT]),
    }));
    return aggregateForecast(date, hours, [LEGACY_CONTRACT]);
  });
  const original = {
    id: 'saved-run',
    issuedAt: '2026-09-29T12:00:00Z',
    version: 'weather-test',
    contract: LEGACY_CONTRACT,
    days,
  };
  const frozen = structuredClone(original);
  const corrected = revalueForecast(original, CONTRACT_SCHEDULE);
  assert.deepEqual(original, frozen);
  assert.equal(corrected.id, original.id);
  assert.equal(corrected.issuedAt, original.issuedAt);
  assert.equal(corrected.days[0].revenueEur, original.days[0].revenueEur);
  assert.ok(
    Math.abs(
      corrected.days[1].revenueEur - original.days[1].revenueEur + 21.6 * 0.3,
    ) < 1e-9,
  );
  assert.equal(corrected.days[1].productionKwh, original.days[1].productionKwh);
  assert.equal(corrected.days[1].negativeSaleHours, 24);
  assert.equal(corrected.pricingAdjusted, true);
  assert.equal(corrected.asIssuedContractVersion, LEGACY_CONTRACT.version);
  assert.equal(revalueForecast(corrected, CONTRACT_SCHEDULE), corrected);
});
