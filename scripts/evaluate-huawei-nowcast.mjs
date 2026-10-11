import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { liveObservation, trialPower } from '../lib/forecast-trial.ts';
import { makeMeasuredNowcast } from '../lib/forecast-huawei-persistence.ts';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';
import { backtestOrigin, backtestScores } from '../lib/forecast-backtest.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const [date, latencyText = '5'] = process.argv.slice(2),
  latency = Number(latencyText);
assert.ok([5, 10].includes(latency));
const raw = read('work/forecast-research/huawei-five-minute/' + date + '.json');
const input = read('work/forecast-research/satellite-evaluation-inputs.json');
const c = input.replay.inputs.config,
  day = input.replay.payload.days.find((d) => d.date === date),
  source = input.replay.inputs.days.find((d) => d.date === date);
const forecasts = input.replay.payload.days.flatMap((d) =>
  d.hours.map((h) => ({
    start: h.start,
    baseKwh: h.productionKwh,
    originAt: h.originAt,
    source: 'historical',
  })),
);
const gain = calibrateHourly(
  forecasts,
  input.revisions,
  new Date(backtestOrigin(date).originAt),
  c.acKw,
).factor;
const hours = day.hours.map((h) => {
  const w = source.weather.find((w) => w.start === h.start);
  return {
    start: h.start,
    baselineKwh: Math.min(c.acKw, h.productionKwh * gain),
    iconKwh: Math.min(c.acKw, h.productionKwh * gain),
    weather: { temperature: w.temperature, windSpeed: w.windSpeed },
  };
});
const times = [...new Set(raw.values.map((p) => p.collectTime))].sort(
    (a, b) => a - b,
  ),
  observations = [];
for (const time of times) {
  const selected = raw.values.filter((p) => p.collectTime === time);
  const observation = liveObservation(
    selected,
    raw.devices,
    new Date(time + latency * 60000),
  );
  if (observation) observations.push(observation);
}
const actualByTime = new Map(
  observations.map((o) => [Date.parse(o.measuredAt), o]),
);
const rows = [],
  missed = [];
for (const at of times.filter((t) => t % 900000 === 0)) {
  const now = new Date(at),
    samples = observations.filter((s) => Date.parse(s.receivedAt) <= at);
  const points = [45, 30].flatMap((lag) => {
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
        receivedAt: new Date(Date.parse(p.createdAt) + 120000).toISOString(),
      },
    ];
  });
  const result = makeMeasuredNowcast(
    hours,
    samples,
    c,
    'replay-gfs',
    backtestOrigin(date).originAt,
    points,
    source.calibration,
    now,
  );
  // Historical GFS is the day-ahead background, so use its origin only to mark
  // provenance. It may exceed the live ICON freshness threshold; reject below
  // rather than fabricating a newer weather issuance.
  for (let i = 0; i < 4; i++) {
    const start = at + i * 900000,
      boundaries = [0, 1, 2, 3].map((j) =>
        actualByTime.get(start + j * 300000),
      );
    if (
      boundaries.some((s) => !s) ||
      boundaries.some(
        (s, j) =>
          j > 0 &&
          (s.totalKwh < boundaries[j - 1].totalKwh ||
            s.inverters !== boundaries[0].inverters),
      )
    )
      continue;
    const real = boundaries[3].totalKwh - boundaries[0].totalKwh;
    let base = 0,
      complete = true;
    for (let j = 0; j < 3; j++) {
      const power = trialPower(hours, start + (j + 0.5) * 300000);
      if (power === null) {
        complete = false;
        break;
      }
      base += power / 12;
    }
    if (!complete) continue;
    const old = result.v34Hours.find((h) => Date.parse(h.start) === start),
      candidate = result.hours.find((h) => Date.parse(h.start) === start);
    if (real === 0 && base === 0) continue;
    rows.push({
      start: new Date(start).toISOString(),
      issuedAt: now.toISOString(),
      leadMinutes: i * 15 + 7.5,
      actual: real,
      base,
      v34: old?.predictedKwh ?? base,
      candidate: candidate?.predictedKwh ?? base,
      corrected: !!result.measuredCorrection,
      status: result.status,
    });
  }
  if (result.status !== 'ready')
    missed.push({ issuedAt: now.toISOString(), status: result.status });
}
const score = (part, key) =>
  backtestScores(
    part.map((r, i) => ({
      start: new Date(i * 3600000).toISOString(),
      productionKwh: r.actual,
    })),
    part.map((r, i) => ({
      start: new Date(i * 3600000).toISOString(),
      productionKwh: r[key],
    })),
  );
const groups = [0, 1, 2, 3].map((i) => ({
  leadMinutes: i * 15 + 7.5,
  ...Object.fromEntries(
    ['base', 'v34', 'candidate'].map((k) => [
      k,
      score(
        rows.filter((r) => r.leadMinutes === i * 15 + 7.5),
        k,
      ),
    ]),
  ),
}));
const audit = {
  date,
  checkedAt: new Date().toISOString(),
  kind: 'historical-component-replay-GFS-background-not-ICON',
  assumedReceiptMinutes: latency,
  rawPoints: raw.values.length,
  completeObservations: observations.length,
  scored: rows.length,
  corrected: rows.filter((r) => r.corrected).length,
  groups,
  rows,
  missed,
  sourceSha256: raw.sha256,
  codeHashes: Object.fromEntries(
    [
      'scripts/evaluate-huawei-nowcast.mjs',
      'lib/forecast-huawei-persistence.ts',
    ].map((p) => [
      p,
      createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
    ]),
  ),
};
fs.writeFileSync(
  'work/forecast-research/huawei-nowcast-' +
    date +
    '-latency' +
    latency +
    '.json',
  JSON.stringify(audit, null, 2),
);
console.log(
  JSON.stringify({
    date,
    latency,
    completeObservations: audit.completeObservations,
    scored: audit.scored,
    corrected: audit.corrected,
    groups,
  }),
);
