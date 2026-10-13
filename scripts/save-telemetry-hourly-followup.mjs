import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {db} from '../db/index.ts';
const read=p=>JSON.parse(fs.readFileSync(p));
const sha=s=>createHash('sha256').update(s).digest('hex');
const before=read('work/telemetry-retention/audit-2026-10-13T08-29-28.323Z.json');
const boundary=read('work/telemetry-retention/audit-2026-10-13T08-36-49.468Z.json');
const after=read('work/telemetry-retention/audit-2026-10-13T08-41-33.808Z.json');
const oldRows=new Map(after.databaseRows.map(r=>[r.start,r]));
for(const row of before.databaseRows)for(const key of ['production_kwh','export_kwh'])if(row[key]!==null)assert.equal(oldRows.get(row.start)?.[key],row[key]);
const partial=after.cache.partialHours.find(r=>r.start==='2026-10-13T08:00:00.000Z');
assert.equal(partial.productionKwh,37.27);assert.equal(partial.exportKwh,37);
assert.deepEqual(after.stored.partial_hours,after.cache.partialHours);
assert.equal(after.databaseRows.length,10);assert.equal(after.pending.length,0);
const payload={version:'huawei-hourly-refresh-followup-v1',checkedAt:new Date().toISOString(),
  commit:'de82993',deploymentId:'dpl_G2un2gCWi5n3AExQmTeSu463aX7J',status:'READY',url:'https://zissolar.vercel.app',
  fullTests:217,build:'passed',unchangedPreviousRows:9,finalRows:10,partial,
  partialPersistedInSqlState:true,partialNotInsertedIntoFinalReadings:true,
  ui:{lastCompletedProductionEndLocal:'10:00',currentLocalHour:'10:00',productionMwh:'≈ 0.04',exportMwh:'≈ 0.04',status:'Делумен час',consoleErrors:0},
  sourcePolicy:'One history request per series per calendar hour after minute 15; five-minute guard, unchanged 13/26 daily budgets. Existing live refresh remains five minutes. No physical control.',
  limitation:'Upstream latency and request quotas can still delay new data. Actual hour rollover covered by tests, not a fabricated production observation.'};
const paths=['lib/fusion-client.ts','lib/fusionsolar-server.ts','lib/manual-refresh.ts','lib/manual-refresh-result.ts','components/manual-refresh-feedback.tsx','tests/fusion-client.test.mjs','tests/manual-refresh.test.mjs'];
const inputs={before,boundary,after,source:Object.fromEntries(paths.map(p=>[p,fs.readFileSync(p,'utf8')])),priorEvidence:read('docs/telemetry-retention-release.json'),tests:fs.readFileSync('work/telemetry-retention/tests-followup.log','utf8'),build:fs.readFileSync('work/telemetry-retention/build-followup.log','utf8'),screenshotSha256:sha(fs.readFileSync('outputs/telemetry-current-hour-rows-2026-10-13.png'))};
const {owner}=await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const id=payload.version+'-'+sha(JSON.stringify({payload,inputs})).slice(0,20);
await db().prepare('INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING').bind(id,owner,payload.version,JSON.stringify(payload),JSON.stringify(inputs)).run();
const saved=await db().prepare('SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?').bind(owner,id).first();
assert.deepEqual(saved.payload,payload);assert.deepEqual(saved.inputs,inputs);
const receipt={id,savedAt:new Date().toISOString(),readback:'exact',inputBytes:Buffer.byteLength(JSON.stringify(inputs)),payload};
fs.writeFileSync('docs/telemetry-hourly-followup-release.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
