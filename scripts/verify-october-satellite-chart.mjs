import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '../db/index.ts';
import { getCachedDashboard } from '../lib/solar-cache.ts';
import { readForecast } from '../lib/forecast-server.ts';
import { withDatabaseUsage } from '../lib/database-usage.ts';
import { backtestScores } from '../lib/forecast-backtest.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { role } = await db().prepare('SELECT current_user AS role').first();
assert.equal(role, 'zis_app_runtime');
const { payload } = await db()
  .prepare(
    'SELECT payload FROM forecast_backtests WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 1',
  )
  .bind(owner)
  .first();
assert.equal(payload.method, 'satellite-hour-ahead');
await getCachedDashboard(owner, '2026-10-11', 'day');
const days = [];
const response = await withDatabaseUsage(async () => {
  for (const day of payload.days) {
    const view = await getCachedDashboard(owner, day.date, 'day');
    assert.equal(
      view.forecastComparison.backtestMethod,
      'satellite-hour-ahead',
    );
    const actual = view.rows.filter(
      (r) => Date.parse(r.start) + 3600000 <= Date.parse(view.generatedAt),
    );
    const chartHours = view.chart
      .filter((h) => h.forecastKind === 'backtest')
      .map((h) => ({ start: h.key, productionKwh: h.forecastProductionKwh }));
    const chartScore = backtestScores(actual, chartHours);
    assert.equal(
      chartScore.wapePercent,
      view.forecastComparison.backtestScore.wapePercent,
    );
    assert.equal(
      chartScore.predictedKwh,
      view.forecastComparison.backtestScore.predictedKwh,
    );
    assert.equal(
      view.chart.filter((h) => h.forecastProductionKwh !== null).length,
      24,
    );
    days.push({
      date: day.date,
      pairedHours: chartScore.hours,
      wape: chartScore.wapePercent,
      score: chartScore.matchPercent,
      predictedMwh: chartScore.predictedKwh / 1000,
    });
  }
  const month = await getCachedDashboard(owner, '2026-10-01', 'month');
  assert.ok(
    month.chart.slice(0, 11).every((h) => h.forecastProductionKwh !== null),
  );
  return Response.json({ monthScore: month.forecastComparison.backtestScore });
});
const queries = Number(response.headers.get('X-ZIS-Database-Queries'));
assert.equal(queries, 0);
const official = await readForecast(owner);
assert.equal(official.forecast.version, 'weather-solar-v3.2');
const receipt = {
  checkedAt: new Date().toISOString(),
  deployment: process.argv[2] ?? null,
  runtimeRole: role,
  replayId: payload.id,
  warmDashboardSqlQueries: queries,
  official: official.forecast.version,
  days,
  ...(await response.json()),
};
fs.writeFileSync(
  'docs/october-satellite-chart-release.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
