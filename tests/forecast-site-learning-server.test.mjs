import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultForecastConfig, addDays } from '../lib/forecast-model.ts';
import { localDate, slotsForDay } from '../lib/energy.ts';
import {
  buildSiteTrial,
  siteModel,
} from '../lib/forecast-site-learning-server.ts';
const c = {
  ...defaultForecastConfig(),
  latitude: siteModel.latitude,
  longitude: siteModel.longitude,
  acKw: siteModel.acKw,
};
const now = new Date(Date.parse(siteModel.trainedAt) + 1000),
  date = addDays(localDate(now), 1);
const baseline = new Map(slotsForDay(date).map((h) => [h.start, 100]));
const source = () => ({
  provider: 'gfs',
  status: 'ready',
  runAt: localDate(now) + 'T06:00:00.000Z',
  fetchedAt: siteModel.trainedAt,
  nativeResolutionHours: 1,
  hours: slotsForDay(date).map((h) => ({ start: h.start, irradiance: 400 })),
  fields: [],
  files: [],
});
void test('real portable artifact produces a bounded prospective local-day trial', () => {
  const view = buildSiteTrial(source(), c, date, baseline, [], now);
  assert.equal(view.status, 'ready');
  assert.equal(view.hours.length, 24);
  assert.ok(
    view.hours.every(
      (h) =>
        h.productionKwh >= 0 &&
        h.productionKwh <= c.acKw &&
        h.baselineKwh === 100,
    ),
  );
  assert.equal(view.score.candidateWape, null);
});
void test('missing, non-hourly, corrupt, stale or different-site inputs cannot produce a trial', () => {
  const sources = [
    { ...source(), hours: source().hours.slice(1) },
    { ...source(), nativeResolutionHours: 3 },
    { ...source(), fetchedAt: new Date(now.getTime() + 3600000).toISOString() },
    { ...source(), status: 'unavailable' },
    {
      ...source(),
      hours: source().hours.map((h, i) =>
        i === 12 ? { ...h, irradiance: NaN } : h,
      ),
    },
  ];
  for (const s of sources) {
    const v = buildSiteTrial(s, c, date, baseline, [], now);
    assert.equal(v.status, 'source-unavailable');
    assert.ok(v.hours.every((h) => h.productionKwh === null));
  }
  assert.equal(
    buildSiteTrial(source(), { ...c, latitude: 42 }, date, baseline, [], now)
      .status,
    'model-unavailable',
  );
  assert.equal(
    buildSiteTrial(
      source(),
      c,
      date,
      baseline,
      [],
      new Date(Date.parse(siteModel.validUntil) + 1000),
    ).status,
    'model-unavailable',
  );
});
