import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerHours } from '../lib/forecast-provider-hours.ts';
import {
  blendModels,
  commonModelPairs,
  selectWeights,
  scoreModel,
} from '../lib/forecast-multimodel.ts';

void test('native cumulative energy and cumulative means become individual hours without interpolation', () => {
  const fields = [1, 2, 3].map((lead, i) => ({
    startLead: 0,
    endLead: lead,
    value: [360000, 1080000, 2160000][i],
  }));
  assert.deepEqual(
    providerHours('2026-10-11T00:00:00Z', fields, 'arpege').map(
      (h) => h.irradiance,
    ),
    [100, 200, 300],
  );
  const means = fields.map((f) => ({
    ...f,
    value: f.value / (f.endLead * 3600),
  }));
  assert.deepEqual(
    providerHours('2026-10-11T00:00:00Z', means, 'gfs').map(
      (h) => h.irradiance,
    ),
    [100, 200, 300],
  );
  assert.equal(
    providerHours('2026-10-11T00:00:00Z', [fields[2]], 'arpege').length,
    0,
    'missing preceding cumulative value cannot be interpolated',
  );
  assert.throws(() =>
    providerHours('2026-10-11T00:00:00Z', [fields[0], fields[0]], 'arpege'),
  );
  assert.throws(() =>
    providerHours(
      '2026-10-11T00:00:00Z',
      [fields[0], { ...fields[1], value: 0 }],
      'arpege',
    ),
  );
});
void test('GFS accumulation blocks reset to an original single hour, not a negative difference', () => {
  const h = providerHours(
    '2026-10-11T00:00:00Z',
    [
      { startLead: 0, endLead: 6, value: 200 },
      { startLead: 6, endLead: 7, value: 100 },
      { startLead: 6, endLead: 8, value: 150 },
    ],
    'gfs',
  );
  assert.deepEqual(
    h.map((x) => x.irradiance),
    [100, 200],
  );
});
void test('missing sources never become zero or a silently reweighted ensemble', () => {
  assert.deepEqual(
    blendModels(
      { icon: 100, gfs: null, arpege: 80 },
      { icon: 1, gfs: 0, arpege: 0 },
    ),
    {
      icon: 100,
      gfs: null,
      arpege: 80,
      mean: null,
      median: null,
      learned: null,
    },
  );
  assert.equal(blendModels({ icon: 0, gfs: 30, arpege: 60 }, null).mean, 30);
  assert.throws(() =>
    blendModels({ icon: 1, gfs: 2, arpege: 3 }, { icon: 1, gfs: 1, arpege: 0 }),
  );
});
function history(days = 28) {
  const rows = [];
  for (let d = 0; d < days; d++)
    for (let h = 6; h < 19; h++) {
      const start = new Date(Date.UTC(2026, 8, 1 + d, h));
      rows.push({
        start: start.toISOString(),
        issuedAt: new Date(start.getTime() - 24 * 3600000).toISOString(),
        actualKwh: 100,
        values: blendModels({ icon: 120, gfs: 80, arpege: 160 }, null),
      });
    }
  return rows;
}
void test('common scores keep real zero outages, reject future observations and retain earliest issued pair', () => {
  const r = history(1)[0],
    outage = { ...r, actualKwh: 0 };
  const rows = commonModelPairs(
    [
      outage,
      { ...r, issuedAt: r.start },
      {
        ...r,
        issuedAt: new Date(Date.parse(r.issuedAt) + 3600000).toISOString(),
      },
    ],
    new Date('2026-10-01'),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actualKwh, 0);
  assert.equal(scoreModel(rows, 'icon').wape, null, 'no division by zero');
  assert.equal(commonModelPairs([r], new Date(r.start)).length, 0);
});
void test('weights require independent chronological validation, not one selected day', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.equal(selectWeights(history(1), now).status, 'collecting');
  const selection = selectWeights(history(), now);
  assert.equal(selection.status, 'validated-candidate');
  assert.equal(selection.trainingDays, 14);
  assert.equal(selection.validationDays, 14);
  assert.ok(selection.validation.candidate.wape < 1e-9);
  assert.ok(
    Math.abs(Object.values(selection.weights).reduce((a, b) => a + b, 0) - 1) <
      1e-9,
  );
  const future = {
    ...history()[0],
    start: '2026-10-02T08:00:00Z',
    actualKwh: 10000,
  };
  assert.deepEqual(
    selectWeights([...history(), future], now),
    selection,
    'future target cannot retune weights',
  );
});
void test('a blend that fails on the later validation days is not selected', () => {
  const rows = history();
  for (const row of rows.slice(14 * 13))
    row.values = blendModels({ icon: 100, gfs: 0, arpege: 0 }, null);
  const result = selectWeights(rows, new Date('2026-10-01T12:00:00Z'));
  assert.equal(result.status, 'not-better');
  assert.equal(result.weights, null);
  assert.equal(result.validation.bestIndividual, 'icon');
});
