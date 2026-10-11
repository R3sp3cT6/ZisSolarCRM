// Retrospective satellite-component ablation on the v3.2 GFS replay background.
// NOT an as-issued full ICON/Huawei test. Missing satellite data retains baseline.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';
import { backtestOrigin, backtestScores } from '../lib/forecast-backtest.ts';
import { localDate } from '../lib/energy.ts';
import {
  satelliteCorrection,
  satellitePower,
} from '../lib/forecast-satellite-nowcast.ts';
const input = JSON.parse(
  readFileSync(
    'work/forecast-research/satellite-evaluation-inputs.json',
    'utf8',
  ),
);
const c = input.replay.inputs.config,
  all = input.replay.payload.days.flatMap((d) => d.hours);
const predictions = all
  .filter((h) => h.productionKwh !== null)
  .map((h) => ({
    start: h.start,
    baseKwh: h.productionKwh,
    originAt: h.originAt,
    source: 'historical',
  }));
const points = new Map(),
  rows = [];
for (const day of input.replay.payload.days) {
  const sources = input.replay.inputs.days.find((d) => d.date === day.date);
  const gain = calibrateHourly(
    predictions,
    input.revisions,
    new Date(backtestOrigin(day.date).originAt),
    c.acKw,
  ).factor;
  for (const h of day.hours) {
    const origin = new Date(h.start),
      weather = sources.weather.find((w) => w.start === h.start);
    if (h.productionKwh === null || !weather) continue;
    const base = Math.min(c.acKw, h.productionKwh * gain),
      sat = [];
    for (const lag of [45, 30]) {
      const stamp = new Date(origin.getTime() - lag * 60000)
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 12);
      const path = 'work/forecast-research/satellite-replay/' + stamp + '.json';
      if (!existsSync(path)) continue;
      const point = JSON.parse(readFileSync(path, 'utf8'));
      points.set(point.slotTime, point);
      // Archive download was today. Historical receipt is UNKNOWN; model +2 min
      // after original file creation, explicitly only in this replay copy.
      sat.push({
        ...point,
        receivedAt: new Date(
          Date.parse(point.createdAt) + 120000,
        ).toISOString(),
      });
    }
    const state = satelliteCorrection(sat, c, origin);
    let forecast = 0,
      weight = 0;
    for (let j = 0; j < 12; j++) {
      const at = origin.getTime() + (j + 0.5) * 300000;
      const value = satellitePower(
        at,
        base,
        weather,
        c,
        sources.calibration,
        state,
      );
      forecast += value.powerKw / 12;
      weight += value.weight / 12;
    }
    const actual =
      input.actual.find((a) => a.start === h.start)?.productionKwh ?? null;
    if (Date.parse(h.start) + 3600000 > Date.now()) continue;
    rows.push({
      start: h.start,
      originAt: h.start,
      actualKwh: actual,
      baselineKwh: base,
      predictedKwh: forecast,
      satelliteWeight: weight,
      state,
    });
  }
}
// Include all completed baseline/actual pairs, including fallback hours, with a
// single common mask. Zero nights do not dilute either model's denominator.
const paired = rows.filter(
  (r) =>
    r.actualKwh !== null &&
    (r.actualKwh > 0 || r.baselineKwh > 0 || r.predictedKwh > 0),
);
function score(part) {
  const actual = part.map((r) => ({
    start: r.start,
    productionKwh: r.actualKwh,
  }));
  return {
    v32: backtestScores(
      actual,
      part.map((r) => ({ start: r.start, productionKwh: r.baselineKwh })),
    ),
    satellite: backtestScores(
      actual,
      part.map((r) => ({ start: r.start, productionKwh: r.predictedKwh })),
    ),
    satelliteAppliedHours: part.filter((r) => r.satelliteWeight > 0).length,
  };
}
const days = input.replay.payload.days.map((d) => ({
  date: d.date,
  ...score(paired.filter((r) => localDate(r.start) === d.date)),
}));
const totals = score(paired),
  last = days.at(-1);
const audit = {
  checkedAt: new Date().toISOString(),
  model: 'satellite-csi-v1-on-v3.2-replay',
  from: days[0].date,
  to: last.date,
  method:
    'At the start of each hour use only two earlier valid LSA SAF slots; approximate MSG acquisition time; assumed source availability = original date_created + 2 minutes; 0.75 maximum satellite weight decaying with observation age over 120 minutes; no fitted target-day parameters; complete next-hour five-minute integration. Baseline is the frozen previous-day GFS v3.2 replay. Same actual hours including satellite fallback; no target-hour satellite input.',
  limitations: [
    'Retrospective component test, not independently held-out or genuinely as-issued forecasts. October was inspected in previous development.',
    'Historical source creation timestamps exist, but actual historical delivery latency is unknown; receivedAt in raw archive remains today.',
    'No historical ICON-EU or complete Huawei five-minute series for these days: this evaluates satellite on v3.2 background only, not the full live combined trial.',
    'Short-term update has later weather observations than the day-ahead baseline; no claim of improved day-ahead accuracy.',
    'Scan time and clear-sky irradiance are modeled. No optical-flow cloud motion or individual-panel shadow prediction.',
  ],
  ...totals,
  days,
  relativeWapeReductionPercent:
    100 * (1 - totals.satellite.wapePercent / totals.v32.wapePercent),
  hashes: {
    baseline: createHash('sha256')
      .update(JSON.stringify(input.replay))
      .digest('hex'),
    actual: createHash('sha256')
      .update(JSON.stringify(input.actual))
      .digest('hex'),
    source: createHash('sha256')
      .update(JSON.stringify([...points.values()]))
      .digest('hex'),
  },
  rows: paired,
};
writeFileSync(
  'docs/satellite-replay-evaluation.json',
  JSON.stringify(audit, null, 2) + '\n',
);
writeFileSync(
  'work/forecast-research/satellite-replay-full.json',
  JSON.stringify({
    audit,
    inputs: { ...input, satellitePoints: [...points.values()] },
  }),
);
console.log(
  JSON.stringify({
    totals,
    days: days.map((d) => ({
      date: d.date,
      hours: d.v32.hours,
      applied: d.satelliteAppliedHours,
      v32Wape: d.v32.wapePercent,
      satelliteWape: d.satellite.wapePercent,
    })),
    relativeWapeReductionPercent: audit.relativeWapeReductionPercent,
  }),
);
