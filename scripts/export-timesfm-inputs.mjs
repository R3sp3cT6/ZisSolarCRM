// Read-only, bounded export. No credentials or owner identifier in the file.
import fs from 'node:fs';
import { db } from '../db/index.ts';
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
const { config } = await db()
  .prepare('SELECT config FROM forecast_settings WHERE owner=?')
  .bind(owner)
  .first();
const revisions = (
  await db()
    .prepare(
      `SELECT id,start,(payload::jsonb->>'productionKwh')::double precision AS "productionKwh",created_at AS "observedAt" FROM reading_revisions WHERE owner=? AND start>=? AND start<? ORDER BY created_at,id`,
    )
    .bind(owner, '2026-08-01', '2026-10-12')
    .all()
).results;
const actual = (
  await db()
    .prepare(
      'SELECT start,production_kwh AS "productionKwh" FROM readings WHERE owner=? AND start>=? AND start<? ORDER BY start',
    )
    .bind(owner, '2026-09-01', '2026-10-12')
    .all()
).results;
fs.mkdirSync('work/forecast-research/timesfm', { recursive: true });
fs.writeFileSync(
  'work/forecast-research/timesfm/source.json',
  JSON.stringify({
    exportedAt: new Date().toISOString(),
    config,
    revisions,
    actual,
  }),
);
console.log(
  JSON.stringify({ revisions: revisions.length, actual: actual.length }),
);
