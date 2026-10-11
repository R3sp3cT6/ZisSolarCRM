import fs from 'node:fs';
import { db } from '../db/index.ts';
const row = await db().prepare(`WITH latest AS (
 SELECT id,issued_at,payload FROM forecast_trials
 WHERE owner=(SELECT owner FROM plants WHERE name='ZIS Solar')
 AND model_version='solar-multimodel-shadow-v1'
 ORDER BY issued_at DESC LIMIT 1
), hours AS (
 SELECT h->>'start' AS start FROM latest CROSS JOIN LATERAL jsonb_array_elements(payload->'hours') h
)
SELECT now() AS "databaseCheckedAt",(SELECT id FROM latest) AS "runId",
 (SELECT issued_at FROM latest) AS "issuedAt",
 (SELECT payload->>'date' FROM latest) AS "targetDate",
 min(h.start) AS "firstTargetHour",max(h.start) AS "lastTargetHour",
 count(*)::integer AS "targetHours",
 count(*) FILTER (WHERE h.start::timestamptz+interval '1 hour'<=now())::integer AS "completedTargetHours",
 count(*) FILTER (WHERE h.start::timestamptz+interval '1 hour'<=now() AND r.production_kwh IS NOT NULL)::integer AS "measuredCompletedHours"
FROM hours h LEFT JOIN readings r ON r.start=h.start AND r.owner=(SELECT owner FROM plants WHERE name='ZIS Solar')`).first();
if (!row?.runId) throw Error('No persisted prospective model run');
fs.writeFileSync('docs/multimodel-outcomes-status.json', JSON.stringify(row,null,2)+'\n');
console.log(JSON.stringify(row));
