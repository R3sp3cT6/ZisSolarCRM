// Read-only comparison of native hourly GFS radiation with the frozen v3.1
// replay. Changes only radiation resolution, preserving run, plant calibration,
// temperature/wind and paired actual hours. Never publishes a forecast.
// node --env-file=<runtime-env> --conditions=react-server
//   --experimental-transform-types --import ./tests/register-ts.mjs
//   scripts/diagnose-hourly-radiation.mjs <day> <archive-directory> <output.json>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import { backtestScores } from '../lib/forecast-backtest.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import { localDate } from '../lib/energy.ts';

const [day, directory, output] = process.argv.slice(2);
assert.match(day ?? '', /^\d{4}-\d{2}-\d{2}$/);
assert.ok(
  directory && output,
  'Expected day, archive directory and output path',
);
const now = new Date();
const raw = fs.readFileSync(
  path.join(directory, day + '-radiation-hourly.json'),
  'utf8',
);
const archive = JSON.parse(raw);
assert.equal(archive.day, day);
assert.equal(archive.provider, 'NOAA GFS');
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { payload, inputs } = await db()
  .prepare(
    "SELECT payload,inputs FROM forecast_backtests WHERE owner=? AND model_version='weather-solar-v3.1-gfs-dswrf-replay-v1' ORDER BY created_at DESC LIMIT 1",
  )
  .bind(owner)
  .first();
const baseline = payload.days.find((d) => d.date === day);
const source = inputs.days.find((d) => d.date === day);
assert.ok(baseline && source, 'No frozen replay for selected day');
const observed = (
  await db()
    .prepare(
      'SELECT start,production_kwh FROM readings WHERE owner=? AND start>=? AND start<? ORDER BY start',
    )
    .bind(
      owner,
      baseline.hours[0].start,
      new Date(Date.parse(baseline.hours.at(-1).start) + 3600000).toISOString(),
    )
    .all()
).results;
const intervals = archive.intervals;
const seen = new Set();
for (const v of intervals) {
  assert.equal(Date.parse(v.runAt), Date.parse(baseline.hours[0].weatherRunAt));
  assert.equal(v.units, 'W m**-2');
  assert.ok(Math.abs(v.latitude - inputs.config.latitude) <= 0.13);
  assert.ok(Math.abs(v.longitude - inputs.config.longitude) <= 0.13);
  assert.ok(Number.isFinite(v.value) && v.value >= 0 && v.value <= 1800);
  const a = Date.parse(v.start),
    b = Date.parse(v.end),
    duration = (b - a) / 3600000;
  assert.ok(a % 3600000 === 0 && b % 3600000 === 0);
  assert.ok(Number.isInteger(duration) && duration >= 1 && duration <= 6);
  const key = a + ':' + b;
  assert.ok(!seen.has(key), 'Repeated interval');
  seen.add(key);
}
const hourly = new Map();
for (const v of intervals) {
  const end = Date.parse(v.end),
    duration = (end - Date.parse(v.start)) / 3600000;
  const previous =
    duration === 1
      ? null
      : intervals.find(
          (p) => p.start === v.start && Date.parse(p.end) === end - 3600000,
        );
  if (duration !== 1 && !previous) continue;
  // GFS provides running means within six-hour blocks, not instant samples.
  const ghi = duration * v.value - (duration - 1) * (previous?.value ?? 0);
  assert.ok(ghi >= -0.5 && ghi <= 1800, 'Invalid recovered hourly radiation');
  const start = new Date(end - 3600000).toISOString();
  assert.ok(!hourly.has(start), 'Repeated hour');
  hourly.set(start, Math.max(0, ghi));
}
let conservationMaxWhM2 = 0,
  checkedIntervals = 0;
for (const v of source.archive.radiation.intervals) {
  const duration = (Date.parse(v.end) - Date.parse(v.start)) / 3600000;
  const values = Array.from({ length: duration }, (_, i) =>
    hourly.get(new Date(Date.parse(v.start) + i * 3600000).toISOString()),
  );
  if (values.some((g) => g === undefined)) continue;
  const difference = Math.abs(
    values.reduce((sum, g) => sum + g, 0) - v.value * duration,
  );
  assert.ok(
    difference <= 1,
    'Native hours do not conserve archived radiation energy',
  );
  conservationMaxWhM2 = Math.max(conservationMaxWhM2, difference);
  checkedIntervals++;
}
assert.ok(checkedIntervals >= 8, 'Too few independent interval checks');
const candidate = source.weather.map((w) => ({
  start: w.start,
  productionKwh: hourly.has(w.start)
    ? weatherAdjustedEnergy(
        { ...w, irradiance: hourly.get(w.start) },
        inputs.config,
        source.calibration,
      )
    : null,
}));
assert.ok(
  candidate.every((h) => h.productionKwh !== null),
  'Missing candidate hours',
);
const actual = observed
  .filter(
    (r) =>
      localDate(r.start) === day &&
      Date.parse(r.start) + 3600000 <= now.getTime(),
  )
  .map((r) => ({
    start: new Date(r.start).toISOString(),
    productionKwh: r.production_kwh,
  }));
const rows = baseline.hours.map((h) => ({
  start: h.start,
  localHour: new Date(h.start).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Skopje',
    hour: '2-digit',
    minute: '2-digit',
  }),
  actualKwh: actual.find((a) => a.start === h.start)?.productionKwh ?? null,
  baselineKwh: h.productionKwh,
  nativeHourlyKwh:
    candidate.find((p) => p.start === h.start)?.productionKwh ?? null,
  baselineGhi:
    source.weather.find((w) => w.start === h.start)?.irradiance ?? null,
  nativeHourlyGhi: hourly.get(h.start) ?? null,
}));
const audit = {
  checkedAt: now.toISOString(),
  day,
  baselineReplayId: payload.id,
  baseline: backtestScores(actual, baseline.hours),
  candidate: backtestScores(actual, candidate),
  conservation: {
    checkedIntervals,
    maximumDifferenceWhM2: conservationMaxWhM2,
  },
  rows,
  inputs: {
    config: inputs.config,
    calibration: source.calibration,
    weather: source.weather,
    archive,
  },
  archiveSha256: createHash('sha256').update(raw).digest('hex'),
  limitations: [
    'One selected difficult day; retrospective diagnostic, not an independent model validation.',
    'Same prior-day GFS run, solar coefficients, temperature/wind and actual hours; only radiation temporal resolution changes.',
    'No measured irradiance at the plant: weather error cannot be isolated fully from plant response or shading.',
    'No production model, historical curve, measurement, price or database record was changed.',
  ],
};
fs.writeFileSync(output, JSON.stringify(audit, null, 2) + '\n');
console.log(
  JSON.stringify({
    day,
    baseline: audit.baseline,
    candidate: audit.candidate,
    conservation: audit.conservation,
  }),
);
