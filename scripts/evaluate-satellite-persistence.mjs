// Offline hypothesis check. All dates were inspected before this method: not holdout.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  reconstructDay,
  backtestOrigin,
  backtestScores,
} from '../lib/forecast-backtest.ts';
import {
  satelliteCorrection,
  instantClearSky,
  satelliteScanOffset,
} from '../lib/forecast-satellite-nowcast.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import { localDate } from '../lib/energy.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const input = read('work/forecast-research/response-research-inputs.json'),
  c = input.config;
const previous = read(
  'work/forecast-research/satellite-adaptive-exploratory.json',
);
const october = read('work/forecast-research/satellite-replay-full.json');
const byStart = new Map(previous.rows.map((r) => [r.start, r])),
  rows = [];
for (
  let dateAt = Date.parse('2026-09-09');
  dateAt <= Date.parse('2026-10-11');
  dateAt += 86400000
) {
  const date = new Date(dateAt).toISOString().slice(0, 10),
    origin = Date.parse(backtestOrigin(date).originAt);
  let replay;
  if (date >= '2026-10-01')
    replay = {
      day: october.inputs.replay.payload.days.find((d) => d.date === date),
      inputs: october.inputs.replay.inputs.days.find((d) => d.date === date),
    };
  else {
    const known = new Map();
    for (const r of input.revisions)
      if (
        Date.parse(r.observedAt) < origin &&
        Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
      )
        known.set(new Date(r.start).toISOString(), r);
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
  for (const h of replay.day.hours) {
    const base = byStart.get(h.start);
    if (!base) continue;
    const at = Date.parse(h.start),
      w = replay.inputs.weather.find((w) => w.start === h.start);
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
    const state = satelliteCorrection(points, c, new Date(at));
    const indices =
      state.status === 'ready'
        ? points.map(
            (p) =>
              p.ghi /
              instantClearSky(
                Date.parse(p.slotTime) +
                  satelliteScanOffset(p.latitude, p.longitude) * 1000,
                c,
              ),
          )
        : [];
    let latest = 0,
      trend = 0;
    for (let j = 0; j < 12; j++) {
      const time = at + (j + 0.5) * 300000;
      if (state.status !== 'ready') {
        latest += base.v32 / 12;
        trend += base.v32 / 12;
        continue;
      }
      const age = (time - Date.parse(state.observedAt)) / 60000,
        weight = 0.9 * Math.exp(-age / 90);
      const current = Math.min(1.5, indices[1]),
        rate = Math.max(-0.25, Math.min(0.25, indices[1] - indices[0])) / 15;
      for (const [kind, csi] of [
        ['latest', current],
        [
          'trend',
          Math.max(
            0,
            Math.min(1.5, current + rate * 30 * (1 - Math.exp(-age / 30))),
          ),
        ],
      ]) {
        const kw = weatherAdjustedEnergy(
          {
            ...w,
            start: new Date(time - 1800000).toISOString(),
            irradiance: instantClearSky(time, c) * csi,
            irradianceKind: 'modeled-ghi',
          },
          c,
          replay.inputs.calibration,
        );
        const value =
          Math.min(c.acKw, Math.max(0, base.v32 * (1 - weight) + kw * weight)) /
          12;
        if (kind === 'latest') latest += value;
        else trend += value;
      }
    }
    rows.push({ ...base, latest, trend });
  }
}
const score = (part, key) =>
  backtestScores(
    part.map((r) => ({ start: r.start, productionKwh: r.actual })),
    part.map((r) => ({ start: r.start, productionKwh: r[key] })),
  );
const totals = (part) =>
  Object.fromEntries(
    ['v32', 'satellite', 'adaptive', 'latest', 'trend'].map((k) => [
      k,
      score(part, k),
    ]),
  );
const dates = [...new Set(rows.map((r) => localDate(r.start)))];
const result = {
  checkedAt: new Date().toISOString(),
  kind: 'exploratory-not-independent',
  totals: totals(rows),
  development: totals(rows.filter((r) => localDate(r.start) <= '2026-09-20')),
  septemberLater: totals(
    rows.filter(
      (r) =>
        localDate(r.start) >= '2026-09-21' &&
        localDate(r.start) <= '2026-09-30',
    ),
  ),
  october: totals(rows.filter((r) => localDate(r.start) >= '2026-10-01')),
  days: dates.map((date) => ({
    date,
    ...totals(rows.filter((r) => localDate(r.start) === date)),
  })),
  rows,
  scriptSha256: createHash('sha256')
    .update(fs.readFileSync(import.meta.filename))
    .digest('hex'),
};
fs.writeFileSync(
  'work/forecast-research/satellite-persistence-exploratory.json',
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      ['totals', 'development', 'septemberLater', 'october'].map((p) => [
        p,
        Object.fromEntries(
          Object.entries(result[p]).map(([k, v]) => [
            k,
            {
              wape: v.wapePercent,
              bias: v.totalDifferencePercent,
              rmse: v.rmseKwh,
            },
          ]),
        ),
      ]),
    ),
  ),
);
