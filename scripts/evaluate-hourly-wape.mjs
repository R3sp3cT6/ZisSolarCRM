// Read-only paired diagnostic. Run with react-server, transform-types, register-ts
// and an environment file. No forecast/measurement/price writes.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import { calibrateHourly } from '../lib/forecast-hourly-calibration.ts';
import { backtestScores, backtestOrigin } from '../lib/forecast-backtest.ts';
import { localDate } from '../lib/energy.ts';
const now = new Date();
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { payload, inputs } = await db()
  .prepare(
    "SELECT payload,inputs FROM forecast_backtests WHERE owner=? AND model_version='weather-solar-v3.1-gfs-dswrf-replay-v1' ORDER BY created_at DESC LIMIT 1",
  )
  .bind(owner)
  .first();
const revisions = (
  await db()
    .prepare(
      `SELECT start,(payload::jsonb->>'productionKwh')::double precision AS "productionKwh",created_at AS "observedAt" FROM reading_revisions WHERE owner=? AND start>=? AND created_at<? ORDER BY created_at,id`,
    )
    .bind(owner, payload.fromDate, now.toISOString())
    .all()
).results;
const actual = (
  await db()
    .prepare(
      'SELECT start,production_kwh AS "productionKwh" FROM readings WHERE owner=? AND start>=? AND start<? ORDER BY start',
    )
    .bind(owner, payload.fromDate, now.toISOString())
    .all()
).results.filter((r) => Date.parse(r.start) + 3600000 <= now.getTime());
const predictions = payload.days.flatMap((d) =>
  d.hours
    .filter((h) => h.productionKwh !== null)
    .map((h) => ({
      start: h.start,
      baseKwh: h.productionKwh,
      originAt: h.originAt,
      source: 'historical',
    })),
);
const days = payload.days.map((day) => {
  const calibration = calibrateHourly(
    predictions,
    revisions,
    new Date(backtestOrigin(day.date).originAt),
    inputs.config.acKw,
  );
  const corrected = day.hours.map((h) => ({
    ...h,
    productionKwh:
      h.productionKwh === null
        ? null
        : Math.min(inputs.config.acKw, h.productionKwh * calibration.factor),
  }));
  const rows = actual.filter((r) => localDate(r.start) === day.date);
  return {
    date: day.date,
    baseline: backtestScores(rows, day.hours),
    candidate: backtestScores(rows, corrected),
    calibration,
    baseHours: day.hours,
    hours: corrected,
  };
});
const completed = days.filter((d) => d.date < localDate(now));
const audit = {
  checkedAt: now.toISOString(),
  baselineReplayId: payload.id,
  modelVersion: 'weather-solar-v3.2',
  objective:
    'Lower hourly WAPE, evaluated on identical completed hours; net total error is separate.',
  period: { from: completed[0]?.date, to: completed.at(-1)?.date },
  completed: {
    baseline: backtestScores(
      actual,
      completed.flatMap((d) => d.baseHours),
    ),
    candidate: backtestScores(
      actual,
      completed.flatMap((d) => d.hours),
    ),
  },
  currentDay: days.find((d) => d.date === localDate(now)) ?? null,
  days: days.map(({ baseHours, hours, ...d }) => d),
  calibrationForNextDay: calibrateHourly(
    predictions,
    revisions,
    now,
    inputs.config.acKw,
  ),
  limitations: [
    'Retrospective diagnostic, not an independent holdout: October errors were inspected during development.',
    'Rolling folds use only earlier available measurement revisions. Model selection still happened afterwards.',
    'One bounded gain corrects systematic bias; it cannot repair wrong cloud arrival times.',
    'Replay uses GFS temperature/wind; live uses MET. Validate new issued predictions prospectively.',
  ],
  hashes: {
    predictions: createHash('sha256')
      .update(JSON.stringify(predictions))
      .digest('hex'),
    revisions: createHash('sha256')
      .update(JSON.stringify(revisions))
      .digest('hex'),
  },
};
if (audit.currentDay) {
  delete audit.currentDay.baseHours;
  delete audit.currentDay.hours;
}
fs.writeFileSync(
  process.argv[2] ?? 'docs/hourly-wape-v32.json',
  JSON.stringify(audit, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    period: audit.period,
    completed: audit.completed,
    current: audit.currentDay && {
      date: audit.currentDay.date,
      baseline: audit.currentDay.baseline,
      candidate: audit.currentDay.candidate,
    },
    nextDay: audit.calibrationForNextDay,
  }),
);
