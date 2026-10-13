// Sanitized read-only audit; no Huawei calls and no session/credential output.
import fs from 'node:fs';
import { db } from '../db/index.ts';
import { cacheRead } from '../lib/shared-cache.ts';
import { localDate, slotsForDay } from '../lib/energy.ts';
const { owner } = await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const day = localDate(), from = slotsForDay(day)[0].start;
const [state, snapshot, pending, stored, rows] = await Promise.all([
  cacheRead('fusion:' + owner), cacheRead('dashboard:' + owner), cacheRead('pending:' + owner),
  db().prepare("SELECT state::jsonb->'liveHour' AS live_hour,state::jsonb->'partialHours' AS partial_hours,state::jsonb->>'lastSuccess' AS last_success FROM fusion_state WHERE owner=?").bind(owner).first(),
  db().prepare('SELECT start,production_kwh,export_kwh,observed_at,source FROM readings WHERE owner=? AND start>=? ORDER BY start').bind(owner,from).all(),
]);
const result = { auditedAt: new Date().toISOString(), day,
  cache: { lastAttempt: state?.lastAttempt, lastSuccess: state?.lastSuccess, error: state?.error,
    live: state?.live, liveHour: state?.liveHour, partialHours: state?.partialHours ?? [],
    anchors: Object.fromEntries(Object.entries(state?.anchors ?? {}).map(([k,v]) => [k,{start:v.start,devices:v.values.length}])),
    historyAt: state?.historyAt },
  snapshot: { savedAt: snapshot?.savedAt, rows: snapshot?.readings.filter(r => r.start >= from) ?? [],
    liveHour: snapshot?.fusionState?.liveHour, partialHours: snapshot?.fusionState?.partialHours ?? [] },
  pending: pending ?? [], stored, databaseRows: rows.results,
};
fs.mkdirSync('work/telemetry-retention',{recursive:true});
const file = 'work/telemetry-retention/audit-' + result.auditedAt.replaceAll(':','-') + '.json';
fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({file,auditedAt:result.auditedAt, cache:result.cache, snapshotRows:result.snapshot.rows.length,
  databaseRows:rows.results.length,pendingBatches:result.pending.length}));
