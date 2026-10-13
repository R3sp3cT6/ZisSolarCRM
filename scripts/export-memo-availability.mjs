import fs from 'node:fs';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/memo-availability/';
fs.mkdirSync(root, { recursive: true });
const { results } = await db()
  .prepare(`
  SELECT start,eur_cents,fetched_at,'revision' AS record_kind FROM price_revisions
  WHERE start>=? AND start<?
  UNION ALL
  SELECT start,eur_cents,fetched_at,'current' AS record_kind FROM prices
  WHERE start>=? AND start<?
  ORDER BY start,fetched_at,eur_cents`)
  .bind('2026-04-02', '2026-10-14', '2026-04-02', '2026-10-14')
  .all();
const records = results.map((r) => ({
  ...r,
  start: new Date(r.start).toISOString(),
  fetched_at: new Date(r.fetched_at).toISOString(),
}));
const value = {
  exportedAt: new Date().toISOString(),
  source: 'prices + append-only price_revisions',
  records,
};
fs.writeFileSync(root + 'prices.json', JSON.stringify(value));
console.log(
  JSON.stringify({
    records: records.length,
    hours: new Set(records.map((r) => r.start)).size,
    earliestReceipt: records.map((r) => r.fetched_at).sort()[0] ?? null,
  }),
);
