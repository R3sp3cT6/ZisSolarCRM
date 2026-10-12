// Read-only export of all completed ZIS Solar hours and their actual receipt history.
import fs from 'node:fs';
import { db } from '../db/index.ts';
import { localDate, slotsForDay } from '../lib/energy.ts';
import { addDays } from '../lib/forecast-model.ts';
import { clearSkyIrradiance } from '../lib/forecast-solar.ts';
const root = 'work/forecast-research/full-history/';
const now = new Date(),
  today = localDate(now),
  cutoff = slotsForDay(today)[0].start;
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { config } = await db()
  .prepare('SELECT config FROM forecast_settings WHERE owner=?')
  .bind(owner)
  .first();
const [a, r] = await Promise.all([
  db()
    .prepare(
      'SELECT start,production_kwh AS "productionKwh",export_kwh AS "exportKwh",observed_at AS "observedAt",source FROM readings WHERE owner=? AND start<? ORDER BY start',
    )
    .bind(owner, cutoff)
    .all(),
  db()
    .prepare(
      `SELECT id,start,(payload::jsonb->>'productionKwh')::double precision AS "productionKwh",created_at AS "observedAt" FROM reading_revisions WHERE owner=? AND start<? ORDER BY created_at,id`,
    )
    .bind(owner, cutoff)
    .all(),
]);
const canon = (s) => new Date(s).toISOString();
const actual = a.results.map((x) => ({
  ...x,
  start: canon(x.start),
  observedAt: canon(x.observedAt),
}));
const revisions = r.results.map((x) => ({
  ...x,
  start: canon(x.start),
  observedAt: canon(x.observedAt),
}));
const starts = new Map(actual.map((x) => [x.start, x]));
const first = localDate(actual[0].start),
  last = addDays(today, -1),
  days = [];
for (let date = first; date <= last; date = addDays(date, 1)) {
  const slots = slotsForDay(date),
    daylight = slots.filter((s) => clearSkyIrradiance(s.start, config) > 0),
    core = slots.filter((s) => clearSkyIrradiance(s.start, config) >= 50);
  const valid = (s) => Number.isFinite(starts.get(s.start)?.productionKwh);
  const origin = addDays(date, -1) + 'T18:00:00.000Z';
  const known = revisions.filter(
    (x) =>
      x.observedAt < origin &&
      Date.parse(x.start) + 3600000 <= Date.parse(x.observedAt),
  );
  days.push({
    date,
    expectedHours: slots.length,
    measuredHours: slots.filter(valid).length,
    daylightHours: daylight.length,
    measuredDaylightHours: daylight.filter(valid).length,
    coreComplete: core.every(valid),
    actualMwh:
      slots.reduce((n, s) => n + (starts.get(s.start)?.productionKwh ?? 0), 0) /
      1000,
    knownPriorHours: new Set(known.map((x) => x.start)).size,
  });
}
const months = [...new Set(days.map((d) => d.date.slice(0, 7)))].map(
  (month) => {
    const sub = days.filter((d) => d.date.startsWith(month));
    return {
      month,
      days: sub.length,
      expectedHours: sub.reduce((s, d) => s + d.expectedHours, 0),
      measuredHours: sub.reduce((s, d) => s + d.measuredHours, 0),
      daylightHours: sub.reduce((s, d) => s + d.daylightHours, 0),
      measuredDaylightHours: sub.reduce(
        (s, d) => s + d.measuredDaylightHours,
        0,
      ),
      completeSolarDays: sub.filter((d) => d.coreComplete).length,
      actualMwh: sub.reduce((s, d) => s + d.actualMwh, 0),
      daysWithPriorReceipts: sub.filter((d) => d.knownPriorHours > 0).length,
    };
  },
);
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(
  root + 'source.json',
  JSON.stringify({
    exportedAt: now.toISOString(),
    config,
    first,
    last,
    actual,
    revisions,
    days,
  }),
);
const audit = {
  exportedAt: now.toISOString(),
  first,
  last,
  actualHours: actual.length,
  revisions: revisions.length,
  firstReceipt: revisions[0]?.observedAt,
  months,
};
fs.writeFileSync(
  'docs/full-history-coverage.json',
  JSON.stringify(audit, null, 2) + '\n',
);
console.log(JSON.stringify(audit));
