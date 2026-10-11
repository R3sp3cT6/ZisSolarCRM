// Exploratory follow-up: September holdout has already been inspected. Every
// fit remains causal, but this report must never claim independent validation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  reconstructDay,
  backtestOrigin,
  backtestScores,
} from '../lib/forecast-backtest.ts';
import {
  satelliteCorrection,
  satellitePower,
} from '../lib/forecast-satellite-nowcast.ts';
import {
  adaptiveSatellitePower,
  calibrateSatelliteBlend,
  SATELLITE_STRENGTHS,
} from '../lib/forecast-satellite-adaptive.ts';
import { localDate } from '../lib/energy.ts';
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const input = read('work/forecast-research/response-research-inputs.json'),
  c = input.config;
const reports = ['development', 'holdout'].map((s) =>
  read('work/forecast-research/response-' + s + '.json'),
);
const baselineRows = new Map(
  reports.flatMap((r) => r.rows.map((v) => [v.start, v])),
);
const october = read('work/forecast-research/satellite-replay-full.json');
for (const r of october.audit.rows)
  baselineRows.set(r.start, {
    start: r.start,
    actual: r.actualKwh,
    v32: r.baselineKwh,
    satellite: r.predictedKwh,
  });
const rows = [],
  training = [],
  details = [];
for (
  let day = Date.parse('2026-09-09');
  day <= Date.parse('2026-10-11');
  day += 86400000
) {
  const date = new Date(day).toISOString().slice(0, 10),
    origin = Date.parse(backtestOrigin(date).originAt);
  const known = new Map();
  for (const r of input.revisions)
    if (
      Date.parse(r.observedAt) < origin &&
      Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
    )
      known.set(new Date(r.start).toISOString(), r);
  let replay;
  if (date >= '2026-10-01')
    replay = {
      day: october.inputs.replay.payload.days.find((d) => d.date === date),
      inputs: october.inputs.replay.inputs.days.find((d) => d.date === date),
    };
  else {
    const archive = read(
      'work/forecast-research/gfs-september/' + date + '.json',
    );
    archive.radiation = read(
      'work/forecast-research/gfs-september-radiation/' +
        date +
        '-radiation.json',
    );
    replay = reconstructDay(
      archive,
      [...known].map(([start, r]) => ({
        start,
        production_kwh: r.productionKwh,
        export_kwh: null,
      })),
      c,
    );
  }
  const weather = new Map(replay.inputs.weather.map((w) => [w.start, w]));
  for (const h of replay.day.hours) {
    const base = baselineRows.get(h.start);
    if (!base) continue;
    const at = Date.parse(h.start),
      points = [45, 30].flatMap((lag) => {
        const stamp = new Date(at - lag * 60000)
            .toISOString()
            .replace(/[-:T]/g, '')
            .slice(0, 12),
          path = 'work/forecast-research/satellite-replay/' + stamp + '.json';
        if (!fs.existsSync(path)) return [];
        const p = read(path);
        return [
          {
            ...p,
            receivedAt: new Date(
              Date.parse(p.createdAt) + 120000,
            ).toISOString(),
          },
        ];
      });
    const state = satelliteCorrection(points, c, new Date(at)),
      alternatives = Object.fromEntries(SATELLITE_STRENGTHS.map((s) => [s, 0]));
    for (let j = 0; j < 12; j++) {
      const time = at + (j + 0.5) * 300000,
        sat = satellitePower(
          time,
          base.v32,
          weather.get(h.start),
          c,
          replay.inputs.calibration,
          state,
        );
      for (const s of SATELLITE_STRENGTHS)
        alternatives[s] +=
          adaptiveSatellitePower(base.v32, sat, s, c.acKw).powerKw / 12;
    }
    assert.ok(
      Math.abs(alternatives[1] - base.satellite) < 1e-8,
      'v3.4 equality',
    );
    const calibration = calibrateSatelliteBlend(training, new Date(at));
    rows.push({
      start: h.start,
      actual: base.actual,
      v32: base.v32,
      satellite: base.satellite,
      adaptive: alternatives[calibration.strength],
      strength: calibration.strength,
      candidates: alternatives,
    });
    details.push({ start: h.start, calibration });
    for (const revision of input.revisions.filter(
      (r) => Date.parse(r.start) === at,
    ))
      training.push({
        start: h.start,
        end: new Date(at + 3600000).toISOString(),
        issuedAt: h.start,
        availableAt: new Date(revision.observedAt).toISOString(),
        actualKwh: revision.productionKwh,
        candidates: alternatives,
      });
  }
}
const score = (part, key) =>
  backtestScores(
    part.map((r) => ({ start: r.start, productionKwh: r.actual })),
    part.map((r) => ({ start: r.start, productionKwh: r[key] })),
  );
const totals = (part) =>
  Object.fromEntries(
    ['v32', 'satellite', 'adaptive'].map((k) => [k, score(part, k)]),
  );
const dates = [...new Set(rows.map((r) => localDate(r.start)))];
const audit = {
  checkedAt: new Date().toISOString(),
  kind: 'exploratory-causal-replay-not-independent',
  from: dates[0],
  to: dates.at(-1),
  totals: totals(rows),
  days: dates.map((date) => ({
    date,
    ...totals(rows.filter((r) => localDate(r.start) === date)),
  })),
  strengthCounts: Object.fromEntries(
    SATELLITE_STRENGTHS.map((s) => [
      s,
      rows.filter((r) => r.strength === s).length,
    ]),
  ),
  rows,
  details,
  training,
  codeHashes: Object.fromEntries(
    [
      'lib/forecast-satellite-adaptive.ts',
      'scripts/evaluate-satellite-adaptive.mjs',
    ].map((path) => [
      path,
      createHash('sha256').update(fs.readFileSync(path)).digest('hex'),
    ]),
  ),
};
fs.writeFileSync(
  'work/forecast-research/satellite-adaptive-exploratory.json',
  JSON.stringify(audit, null, 2),
);
console.log(
  JSON.stringify({
    kind: audit.kind,
    totals: audit.totals,
    strengthCounts: audit.strengthCounts,
    days: audit.days.map((d) => ({
      date: d.date,
      v34: d.satellite.wapePercent,
      adaptive: d.adaptive.wapePercent,
    })),
  }),
);
