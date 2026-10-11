// Read-only original-weather diagnostic on a previously inspected day.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { iconHours } from '../lib/forecast-icon.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import { backtestScores, backtestOrigin } from '../lib/forecast-backtest.ts';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';
import {
  liveObservation,
  trialPower,
  makeSatelliteNowcast,
} from '../lib/forecast-trial.ts';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const root = 'work/forecast-research/';
const input = read(root + 'satellite-evaluation-inputs.json');
const date = '2026-10-11',
  c = input.replay.inputs.config;
const source = input.replay.inputs.days.find((d) => d.date === date);
const day = input.replay.payload.days.find((d) => d.date === date);
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
const actual = new Map(
  input.actual.map((r) => [new Date(r.start).toISOString(), r.productionKwh]),
);
const hashes = {};
function archive(p) {
  hashes[p] = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  return read(p);
}
const runs = ['2026101018', '2026101100', '2026101106'].map((stamp) => {
  const icon = archive(root + 'icon-original/' + stamp + '/source.json');
  const gfs = archive(root + 'gfs-original/' + stamp + '/source.json');
  assert.equal(Date.parse(icon.runAt), Date.parse(gfs.runAt));
  const availableAt = Date.parse(icon.runAt) + 4 * 3600000;
  for (const f of [...icon.files, ...gfs.intervals]) {
    assert.ok(
      Date.parse(f.lastModified) <= availableAt,
      'File published after assumed issuance',
    );
    assert.ok(
      Math.abs(f.latitude - c.latitude) < 0.13 &&
        Math.abs(f.longitude - c.longitude) < 0.13,
    );
  }
  const leads = [...new Set(icon.files.map((f) => f.lead))];
  const means = leads.map((lead) => ({
    lead,
    direct: icon.files.find((f) => f.lead === lead && f.field === 'ASWDIR_S')
      .value,
    diffuse: icon.files.find((f) => f.lead === lead && f.field === 'ASWDIFD_S')
      .value,
  }));
  const iconByStart = new Map(
    iconHours(icon.runAt, means).map((h) => [h.start, h.irradiance]),
  );
  const gfsByStart = new Map();
  for (const f of gfs.intervals) {
    assert.equal(f.units, 'W m**-2');
    const duration = (Date.parse(f.end) - Date.parse(f.start)) / 3600000;
    const previous = gfs.intervals.find(
      (p) =>
        p.start === f.start &&
        Date.parse(p.end) === Date.parse(f.end) - 3600000,
    );
    if (duration > 1 && !previous) continue;
    const ghi = duration * f.value - (duration - 1) * (previous?.value ?? 0);
    assert.ok(ghi >= -0.5 && ghi <= 1800);
    gfsByStart.set(
      new Date(Date.parse(f.end) - 3600000).toISOString(),
      Math.max(0, ghi),
    );
  }
  const rows = source.weather.map((w) => ({
    start: w.start,
    actualKwh: actual.get(w.start) ?? null,
    iconGhi: iconByStart.get(w.start) ?? null,
    gfsGhi: gfsByStart.get(w.start) ?? null,
    iconKwh: iconByStart.has(w.start)
      ? weatherAdjustedEnergy(
          { ...w, irradiance: iconByStart.get(w.start) },
          c,
          source.calibration,
        )
      : null,
    gfsKwh: gfsByStart.has(w.start)
      ? weatherAdjustedEnergy(
          { ...w, irradiance: gfsByStart.get(w.start) },
          c,
          source.calibration,
        )
      : null,
    v32Kwh: day.hours.find((h) => h.start === w.start).productionKwh * gain,
  }));
  return {
    stamp,
    runAt: new Date(icon.runAt).toISOString(),
    availableAt: new Date(availableAt).toISOString(),
    rows,
    publication: {
      iconLatest: new Date(
        Math.max(...icon.files.map((f) => Date.parse(f.lastModified))),
      ).toISOString(),
      gfsLatest: new Date(
        Math.max(...gfs.intervals.map((f) => Date.parse(f.lastModified))),
      ).toISOString(),
    },
  };
});
const score = (rows, key) =>
  backtestScores(
    rows.map((r) => ({ start: r.start, productionKwh: r.actualKwh })),
    rows.map((r) => ({ start: r.start, productionKwh: r[key] })),
  );
const hourly = runs.map((run) => {
  const paired = run.rows.filter(
    (r) =>
      Date.parse(r.start) >= Date.parse(run.availableAt) &&
      r.actualKwh !== null &&
      r.iconKwh !== null &&
      r.gfsKwh !== null,
  );
  return {
    ...run,
    kind: run.stamp === '2026101018' ? 'prior-evening' : 'intraday',
    pairedHours: paired.length,
    scores: Object.fromEntries(
      ['iconKwh', 'gfsKwh', 'v32Kwh'].map((k) => [k, score(paired, k)]),
    ),
  };
});
const raw = archive(root + 'huawei-five-minute/' + date + '.json');
const times = [...new Set(raw.values.map((p) => p.collectTime))].sort(
  (a, b) => a - b,
);
const satellites = fs
  .readdirSync(root + 'satellite-replay')
  .filter((p) => p.startsWith('20261011') && p.endsWith('.json'))
  .map((p) => archive(root + 'satellite-replay/' + p));
const shortTerm = [];
for (const huaweiLatency of [5, 10])
  for (const satelliteLatency of [2, 10]) {
    const observations = times.flatMap((time) => {
      const o = liveObservation(
        raw.values.filter((p) => p.collectTime === time),
        raw.devices,
        new Date(time + huaweiLatency * 60000),
      );
      return o ? [o] : [];
    });
    const actualByTime = new Map(
      observations.map((o) => [Date.parse(o.measuredAt), o]),
    );
    const rows = [];
    for (const at of times.filter((t) => t % 900000 === 0)) {
      const run = runs.filter((r) => Date.parse(r.availableAt) <= at).at(-1);
      if (!run) continue;
      const hours = run.rows.map((r) => ({
        start: r.start,
        iconKwh: r.iconKwh,
        baselineKwh: r.v32Kwh,
        weather: source.weather.find((w) => w.start === r.start),
      }));
      const samples = observations.filter(
        (s) => Date.parse(s.receivedAt) <= at,
      );
      const points = satellites
        .map((p) => ({
          ...p,
          receivedAt: new Date(
            Date.parse(p.createdAt) + satelliteLatency * 60000,
          ).toISOString(),
        }))
        .filter((p) => Date.parse(p.receivedAt) <= at);
      const result = makeSatelliteNowcast(
        hours,
        samples,
        c,
        'replay',
        run.runAt,
        points,
        source.calibration,
        new Date(at),
      );
      for (let i = 0; i < 4; i++) {
        const start = at + i * 900000;
        const boundaries = [0, 1, 2, 3].map((j) =>
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
        const actualKwh = boundaries[3].totalKwh - boundaries[0].totalKwh;
        const powers = [0, 1, 2].map((j) =>
          trialPower(hours, start + (j + 0.5) * 300000),
        );
        if (powers.some((p) => p === null)) continue;
        const iconKwh = powers.reduce((s, p) => s + p / 12, 0);
        const predicted = result.hours.find(
          (h) => Date.parse(h.start) === start,
        );
        if (actualKwh === 0 && iconKwh === 0) continue;
        rows.push({
          start: new Date(start).toISOString(),
          issuedAt: new Date(at).toISOString(),
          runAt: run.runAt,
          leadMinutes: i * 15 + 7.5,
          actualKwh,
          iconKwh,
          v34Kwh: predicted?.predictedKwh ?? iconKwh,
          withoutSatelliteKwh: predicted?.withoutSatelliteKwh ?? iconKwh,
          status: result.status,
          huaweiApplied: !!result.correction,
          satelliteWeight: predicted?.satelliteWeight ?? 0,
        });
      }
    }
    shortTerm.push({
      huaweiLatency,
      satelliteLatency,
      rows,
      groups: [0, 1, 2, 3].map((i) => {
        const part = rows.filter((r) => r.leadMinutes === i * 15 + 7.5);
        return {
          leadMinutes: i * 15 + 7.5,
          intervals: part.length,
          huaweiApplied: part.filter((r) => r.huaweiApplied).length,
          satelliteApplied: part.filter((r) => r.satelliteWeight > 0).length,
          scores: Object.fromEntries(
            ['iconKwh', 'withoutSatelliteKwh', 'v34Kwh'].map((k) => [
              k,
              score(part, k),
            ]),
          ),
        };
      }),
    });
  }
const audit = {
  checkedAt: new Date().toISOString(),
  date,
  kind: 'original-weather-diagnostic-not-independent',
  hourly,
  shortTerm,
  inputHashes: hashes,
  limitations: [
    'Selected day previously inspected; not an independent model-selection score.',
    'Same causal prior-day response and older temperature/wind isolate radiation only.',
    'Both radiation providers initialized together and checked available by common init+4h cutoff.',
    'Historical Huawei and satellite delivery delays are assumptions, not original receipts.',
    'Repeated targets are separated by forecast horizon; groups must not be summed as distinct energy.',
  ],
  codeHashes: Object.fromEntries(
    [
      'scripts/evaluate-original-weather.mjs',
      'lib/forecast-icon.ts',
      'lib/forecast-trial.ts',
      'lib/forecast-solar.ts',
    ].map((p) => [
      p,
      createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
    ]),
  ),
};
fs.writeFileSync(
  root + 'original-weather-evaluation.json',
  JSON.stringify(audit, null, 2),
);
console.log(
  JSON.stringify(
    {
      hourly: hourly.map(({ rows: _rows, ...rest }) => rest),
      shortTerm: shortTerm.map(({ rows: _rows, ...rest }) => rest),
    },
    null,
    2,
  ),
);
