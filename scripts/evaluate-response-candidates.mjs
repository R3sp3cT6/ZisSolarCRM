// Offline research only: no SQL writes, no replacement of chart forecasts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getTimes } from 'suncalc';
import {
  reconstructDay,
  backtestOrigin,
  backtestScores,
} from '../lib/forecast-backtest.ts';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import {
  satelliteScanOffset,
  satelliteCorrection,
  instantClearSky,
} from '../lib/forecast-satellite-nowcast.ts';
import { localDate } from '../lib/energy.ts';
import {
  parseSatelliteGrid,
  satelliteMotion,
  advectedIndex,
} from '../lib/forecast-satellite-motion.ts';
const arg = (key, fallback) =>
  process.argv.includes(key)
    ? process.argv[process.argv.indexOf(key) + 1]
    : fallback;
const phase = arg('--phase', 'development'),
  to = arg('--to', '2026-09-20');
const latency = Number(arg('--latency-minutes', '2'));
assert.ok([2, 10].includes(latency));
const codePaths = [
  'scripts/evaluate-response-candidates.mjs',
  'lib/forecast-satellite-motion.ts',
  'lib/forecast-satellite-nowcast.ts',
  'lib/forecast-solar.ts',
  'lib/forecast-backtest.ts',
  'lib/forecast-hourly-calibration.ts',
];
const codeHashes = Object.fromEntries(
  codePaths.map((path) => [
    path,
    createHash('sha256').update(fs.readFileSync(path)).digest('hex'),
  ]),
);
assert.ok(phase === 'development' || phase === 'holdout');
assert.ok(
  phase === 'holdout' || to <= '2026-09-20',
  'Reserved dates require an explicit frozen evaluation',
);
if (phase === 'holdout') {
  assert.equal(to, '2026-09-30');
  const frozen = JSON.parse(
    fs.readFileSync('docs/forecast-response-frozen.json', 'utf8'),
  );
  assert.deepEqual(
    frozen.codeHashes,
    codeHashes,
    'Freeze method before any reserved-date scores',
  );
}
const input = JSON.parse(
  fs.readFileSync(
    'work/forecast-research/response-research-inputs.json',
    'utf8',
  ),
);
const c = input.config,
  hash = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const outages = JSON.parse(
  fs.readFileSync('docs/forecast-confirmed-outages.json', 'utf8'),
);
const outageDates = new Set(outages.events.map((e) => e.date));
const canonical = (x) => new Date(x).toISOString();
const revisions = input.revisions.map((r) => ({
  ...r,
  start: canonical(r.start),
}));
const actual = new Map(
  input.actual.map((r) => [canonical(r.start), r.productionKwh]),
);
function knownAt(time) {
  const known = new Map();
  for (const r of revisions)
    if (
      Date.parse(r.observedAt) < time &&
      Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
    )
      known.set(r.start, r);
  return known;
}
const days = [];
for (
  let day = Date.parse('2026-09-09');
  day <= Date.parse(to);
  day += 86400000
) {
  const date = new Date(day).toISOString().slice(0, 10),
    path = 'work/forecast-research/gfs-september/' + date + '.json',
    rad =
      'work/forecast-research/gfs-september-radiation/' +
      date +
      '-radiation.json';
  assert.ok(
    fs.existsSync(path) && fs.existsSync(rad),
    'Incomplete GFS archive: ' + date,
  );
  const archive = JSON.parse(fs.readFileSync(path, 'utf8'));
  archive.radiation = JSON.parse(fs.readFileSync(rad, 'utf8'));
  const origin = backtestOrigin(date).originAt;
  const known = [...knownAt(Date.parse(origin)).values()].map((r) => ({
    start: r.start,
    production_kwh: r.productionKwh,
    export_kwh: null,
  }));
  const result = reconstructDay(archive, known, c);
  assert.equal(result.day.hours.length, 24, date);
  assert.ok(
    result.day.hours.every((h) => h.productionKwh !== null),
    'Incomplete forecast: ' + date,
  );
  days.push({ ...result, date });
}
const forecasts = days.flatMap((d) =>
  d.day.hours.map((h) => ({
    start: h.start,
    baseKwh: h.productionKwh,
    originAt: h.originAt,
    source: 'historical',
  })),
);
const weather = new Map(
  days.flatMap((d) => d.inputs.weather.map((w) => [w.start, w])),
);
const offset = satelliteScanOffset(41.050003, 21.050003) * 1000;
const points = new Map();
const grids = new Map();
for (let day = Date.parse('2026-09-09'); day <= Date.parse(to); day += 86400000)
  for (let hour = 3; hour <= 17; hour++)
    for (const minute of [0, 15, 30]) {
      const stamp = new Date(day + hour * 3600000 + minute * 60000)
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 12);
      const path = 'work/forecast-research/satellite-grids/' + stamp + '.json';
      assert.ok(fs.existsSync(path), 'Incomplete grid archive: ' + stamp);
      const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
      assert.equal(
        createHash('sha256')
          .update(raw.attributes + '\n' + raw.ascii)
          .digest('hex'),
        raw.sha256,
      );
      const grid = parseSatelliteGrid(raw, c);
      grids.set(Date.parse(grid.slotTime), {
        ...grid,
        receivedAt: new Date(
          Date.parse(grid.createdAt) + latency * 60000,
        ).toISOString(),
      });
    }
for (const filename of fs.readdirSync(
  'work/forecast-research/satellite-replay',
)) {
  if (
    !/^202609\d{6}\.json$/.test(filename) ||
    filename.slice(0, 8) > to.replaceAll('-', '')
  )
    continue;
  const p = JSON.parse(
    fs.readFileSync(
      'work/forecast-research/satellite-replay/' + filename,
      'utf8',
    ),
  );
  points.set(Date.parse(p.slotTime), p);
}
const valid = (p) =>
  p &&
  p.ghi !== null &&
  Number.isFinite(p.ghi) &&
  p.ghi >= 0 &&
  p.ghi <= 1500 &&
  ['good', 'night'].includes(p.quality) &&
  Math.abs(p.latitude - c.latitude) < 0.026 &&
  Math.abs(p.longitude - c.longitude) < 0.026;
function solarBin(at) {
  const h =
    12 +
    (at - getTimes(new Date(at), c.latitude, c.longitude).solarNoon.getTime()) /
      3600000;
  return h < 10 ? 0 : h < 14 ? 1 : 2;
}
function irradianceAt(at) {
  const slot = Math.floor((at - offset) / 900000) * 900000,
    a = points.get(slot),
    b = points.get(slot + 900000);
  if (!valid(a) || !valid(b)) return null;
  const f = (at - slot - offset) / 900000;
  return {
    ghi: a.ghi + f * (b.ghi - a.ghi),
    availableAt:
      Math.max(Date.parse(a.createdAt), Date.parse(b.createdAt)) + 120000,
  };
}
const integrated = new Map();
for (const [start, w] of weather) {
  const samples = Array.from({ length: 12 }, (_, j) =>
    irradianceAt(Date.parse(start) + (j + 0.5) * 300000),
  );
  if (samples.some((s) => !s)) continue;
  integrated.set(start, {
    samples,
    availableAt: Math.max(...samples.map((s) => s.availableAt)),
    weather: w,
  });
}
function observedEnergy(start, calibration) {
  const entry = integrated.get(start);
  if (!entry) return null;
  let value = 0;
  for (let j = 0; j < 12; j++)
    value +=
      weatherAdjustedEnergy(
        {
          ...entry.weather,
          start: new Date(
            Date.parse(start) + (j + 0.5) * 300000 - 1800000,
          ).toISOString(),
          irradiance: entry.samples[j].ghi,
          irradianceKind: 'modeled-ghi',
        },
        c,
        calibration,
      ) / 12;
  return value;
}
function fit(pairs) {
  const sorted = pairs
      .map((p) => ({ ratio: p.actual / p.base, weight: p.base }))
      .sort((a, b) => a.ratio - b.ratio),
    half = sorted.reduce((s, p) => s + p.weight, 0) / 2;
  let sum = 0;
  for (const p of sorted) {
    sum += p.weight;
    if (sum >= half) return Math.min(1.5, Math.max(0.5, p.ratio));
  }
  return 1;
}
function responseAt(at, calibration) {
  const known = knownAt(at),
    pairs = [];
  for (const [start, entry] of integrated) {
    if (
      Date.parse(start) + 3600000 > at ||
      Date.parse(start) < at - 14 * 86400000 ||
      entry.availableAt >= at
    )
      continue;
    // Exclude the unfinished origin day; use only causally available revisions.
    if (localDate(start) >= localDate(at)) continue;
    const real = known.get(start)?.productionKwh;
    if (real == null || !Number.isFinite(real) || real < 0) continue;
    const base = observedEnergy(start, calibration);
    if (base === null || base < 10) continue;
    pairs.push({
      start,
      base,
      actual: real,
      bin: solarBin(Date.parse(start) + 1800000),
    });
  }
  const nDays = new Set(pairs.map((p) => localDate(p.start))).size;
  if (pairs.length < 30 || nDays < 3)
    return {
      status: 'insufficient',
      factor: 1,
      bins: [1, 1, 1],
      hours: pairs.length,
      days: nDays,
    };
  const factor = fit(pairs),
    bins = [0, 1, 2].map((bin) => {
      const subset = pairs.filter((p) => p.bin === bin);
      if (subset.length < 10) return factor;
      const weight = subset.length / (subset.length + 30);
      return factor * (1 - weight) + fit(subset) * weight;
    });
  return { status: 'ready', factor, bins, hours: pairs.length, days: nDays };
}
const rows = [],
  diagnostic = [],
  calibrations = [];
for (const d of days) {
  const origin = Date.parse(backtestOrigin(d.date).originAt),
    v32 = calibrateHourly(forecasts, revisions, new Date(origin), c.acKw);
  const response = responseAt(origin, d.inputs.calibration);
  calibrations.push({ date: d.date, response, v32 });
  for (const h of d.day.hours) {
    const real = actual.get(h.start);
    if (real == null) continue;
    const at = Date.parse(h.start),
      w = weather.get(h.start),
      baseline = Math.min(c.acKw, h.productionKwh * v32.factor);
    const factor = response.factor,
      binFactor = response.bins[solarBin(at + 1800000)];
    const preceding = [45, 30].flatMap((lag) => {
      const p = points.get(at - lag * 60000);
      return p
        ? [
            {
              ...p,
              receivedAt: new Date(
                Date.parse(p.createdAt) + latency * 60000,
              ).toISOString(),
            },
          ]
        : [];
    });
    const state = satelliteCorrection(preceding, c, new Date(at));
    const motion = satelliteMotion(
      [60, 45, 30].flatMap((lag) => {
        const grid = grids.get(at - lag * 60000);
        return grid ? [grid] : [];
      }),
      new Date(at),
    );
    const model = {
      v32: baseline,
      dayResponse: Math.min(c.acKw, h.productionKwh * factor),
      dayBins: Math.min(c.acKw, h.productionKwh * binFactor),
      satellite: 0,
      satelliteResponse: 0,
      satelliteBins: 0,
      motion: 0,
    };
    let weight = 0;
    let motionWeight = 0;
    for (let j = 0; j < 12; j++) {
      const time = at + (j + 0.5) * 300000;
      const blend =
        state.status === 'ready'
          ? 0.75 *
            Math.max(
              0,
              1 - (time - Date.parse(state.observedAt)) / 60000 / 120,
            ) *
            state.stability
          : 0;
      const sat = blend
        ? weatherAdjustedEnergy(
            {
              ...w,
              start: new Date(time - 1800000).toISOString(),
              irradiance: instantClearSky(time, c) * state.clearSkyIndex,
              irradianceKind: 'modeled-ghi',
            },
            c,
            d.inputs.calibration,
          )
        : baseline;
      model.satellite +=
        Math.min(c.acKw, baseline * (1 - blend) + sat * blend) / 12;
      model.satelliteResponse +=
        Math.min(c.acKw, baseline * (1 - blend) + sat * factor * blend) / 12;
      model.satelliteBins +=
        Math.min(
          c.acKw,
          baseline * (1 - blend) + sat * response.bins[solarBin(time)] * blend,
        ) / 12;
      const advected =
        state.status === 'ready'
          ? advectedIndex(motion, time, state.clearSkyIndex)
          : { csi: 0, weight: 0 };
      const moved =
        advected.weight > 0
          ? weatherAdjustedEnergy(
              {
                ...w,
                start: new Date(time - 1800000).toISOString(),
                irradiance: instantClearSky(time, c) * advected.csi,
                irradianceKind: 'modeled-ghi',
              },
              c,
              d.inputs.calibration,
            )
          : sat;
      model.motion +=
        Math.min(c.acKw, baseline * (1 - blend) + moved * blend) / 12;
      motionWeight += (advected.weight * blend) / 12;
      weight += blend / 12;
    }
    const obs = observedEnergy(h.start, d.inputs.calibration);
    if (obs !== null && (obs > 0 || real > 0))
      diagnostic.push({
        start: h.start,
        actual: real,
        observedRadiationEnergy: obs,
        corrected: obs * factor,
        binned: obs * binFactor,
      });
    if (real > 0 || Object.values(model).some((v) => v > 0))
      rows.push({
        start: h.start,
        actual: real,
        weight,
        motionWeight,
        motionStatus: motion.status,
        ...model,
      });
  }
}
const keys = [
  'v32',
  'dayResponse',
  'dayBins',
  'satellite',
  'satelliteResponse',
  'satelliteBins',
  'motion',
];
const score = (part, key) =>
  backtestScores(
    part.map((r) => ({ start: r.start, productionKwh: r.actual })),
    part.map((r) => ({ start: r.start, productionKwh: r[key] })),
  );
const totals = (part) =>
  Object.fromEntries(keys.map((key) => [key, score(part, key)]));
const selected = rows.filter(
  (r) => phase !== 'holdout' || localDate(r.start) >= '2026-09-21',
);
const audit = {
  checkedAt: new Date().toISOString(),
  phase,
  latencyMinutes: latency,
  codeHashes,
  from: localDate(selected[0]?.start),
  to,
  sourceCoverage: {
    days: days.length,
    rawPoints: points.size,
    integratedHours: integrated.size,
    pairedHours: selected.length,
    regionalGrids: grids.size,
    motionHours: selected.filter((r) => r.motionWeight > 0).length,
  },
  totals: totals(selected),
  // Confirmed AFTER these dates; never used as historical forecast input.
  excludingConfirmedOutageDays: {
    dates: [...outageDates],
    reason:
      'Secondary diagnostic excludes entire confirmed affected days; exact outage boundaries are unknown. Primary totals above retain every paired hour.',
    totals: totals(
      selected.filter((r) => !outageDates.has(localDate(r.start))),
    ),
  },
  days: days
    .filter((d) => phase !== 'holdout' || d.date >= '2026-09-21')
    .map((d) => ({
      date: d.date,
      ...totals(selected.filter((r) => localDate(r.start) === d.date)),
    })),
  diagnostic:
    phase === 'development'
      ? {
          rows: diagnostic,
          raw: score(diagnostic, 'observedRadiationEnergy'),
          corrected: score(diagnostic, 'corrected'),
          binned: score(diagnostic, 'binned'),
          excludingConfirmedOutageDays: score(
            diagnostic.filter((r) => !outageDates.has(localDate(r.start))),
            'observedRadiationEnergy',
          ),
        }
      : null,
  calibrations,
  rows: selected,
  inputHashes: {
    revisions: hash(revisions),
    actual: hash(input.actual),
    satellite: hash([...points.values()]),
    weather: hash([...weather.values()]),
  },
};
fs.writeFileSync(
  'work/forecast-research/response-' +
    phase +
    (latency === 2 ? '' : '-latency10') +
    '.json',
  JSON.stringify(audit, null, 2),
);
console.log(
  JSON.stringify({
    phase,
    coverage: audit.sourceCoverage,
    totals: Object.fromEntries(
      Object.entries(audit.totals).map(([k, v]) => [
        k,
        { wape: v.wapePercent, bias: v.totalDifferencePercent },
      ]),
    ),
    diagnostic:
      audit.diagnostic &&
      Object.fromEntries(
        Object.entries(audit.diagnostic).filter(([key]) => key !== 'rows'),
      ),
  }),
);
