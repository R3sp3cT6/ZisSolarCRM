// Read-only paired comparison. Usage: --env-file=<private env> --conditions=react-server
// --experimental-transform-types scripts/evaluate-production-improvement.mjs OLD_ID NEW_ID FROM TO OUTPUT
import { writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
registerHooks({
  resolve(s, c, next) {
    if (
      !c.parentURL?.includes('/node_modules/') &&
      s.startsWith('.') &&
      !extname(s)
    )
      return next(s + '.ts', c);
    return next(s, c);
  },
});
const { db } = await import('../db/index.ts');
const { backtestScores } = await import('../lib/forecast-backtest.ts');
const { localDate, slotsForDay } = await import('../lib/energy.ts');
const { addDays } = await import('../lib/forecast-model.ts');
const [oldId, newId, from, to, output] = process.argv.slice(2);
assert.ok(
  oldId &&
    newId &&
    /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from <= to &&
    to < localDate() &&
    output,
);
const old = await db()
  .prepare('SELECT owner,payload,inputs FROM forecast_backtests WHERE id=?')
  .bind(oldId)
  .first();
const fresh = await db()
  .prepare('SELECT owner,payload,inputs FROM forecast_backtests WHERE id=?')
  .bind(newId)
  .first();
assert.ok(old && fresh && old.owner === fresh.owner);
const rows = (
  await db()
    .prepare(
      'SELECT start,production_kwh AS "productionKwh" FROM readings WHERE owner=? AND start>=? AND start<? ORDER BY start',
    )
    .bind(
      old.owner,
      slotsForDay(from)[0].start,
      slotsForDay(addDays(to, 1))[0].start,
    )
    .all()
).results;
const a = old.payload.days.flatMap((d) => d.hours),
  b = fresh.payload.days.flatMap((d) => d.hours);
const aKeys = new Set(
    a.filter((h) => Number.isFinite(h.productionKwh)).map((h) => h.start),
  ),
  bKeys = new Set(
    b.filter((h) => Number.isFinite(h.productionKwh)).map((h) => h.start),
  );
const paired = rows.filter((r) => aKeys.has(r.start) && bKeys.has(r.start));
const compare = (part) => ({
  before: backtestScores(part, a),
  after: backtestScores(part, b),
});
const totals = compare(paired),
  days = [];
for (let date = from; date <= to; date = addDays(date, 1))
  days.push({
    date,
    ...compare(paired.filter((r) => localDate(r.start) === date)),
  });
const hash = (x) =>
  createHash('sha256').update(JSON.stringify(x)).digest('hex');
const audit = {
  checkedAt: new Date().toISOString(),
  from,
  to,
  baseline: { id: oldId, model: old.payload.modelVersion },
  candidate: { id: newId, model: fresh.payload.modelVersion },
  ...totals,
  relativeMaeReductionPercent:
    100 * (1 - totals.after.maeKwh / totals.before.maeKwh),
  days,
  inputsSha256: {
    baseline: hash(old.inputs),
    candidate: hash(fresh.inputs),
    actuals: hash(rows),
  },
  method:
    'Same completed delivery hours, archived prior-day 12 UTC GFS run, 18 UTC cutoff, only reading revisions already available at each origin. Double-zero nights and missing actuals excluded. Model design selected retrospectively after inspecting October errors, so this is NOT an independent holdout or prospective accuracy claim. No adjustment parameters fitted on target production.',
  limitations: [
    'Only ten October days; results do not establish seasonal or seven-day-ahead skill.',
    'GFS weather replay; live uses MET temperature/wind and GFS irradiance.',
    'Current plant parameters applied retrospectively; original release timestamps not independently archived.',
    'Some individual days worsen; local cloud timing and panel geometry remain uncertain.',
  ],
};
writeFileSync(output, JSON.stringify(audit, null, 2) + '\n');
console.log(
  JSON.stringify({
    from,
    to,
    ...totals,
    relativeMaeReductionPercent: audit.relativeMaeReductionPercent,
  }),
);
