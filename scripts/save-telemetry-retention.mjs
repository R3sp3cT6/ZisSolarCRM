import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {db} from '../db/index.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const before = read('work/telemetry-retention/audit-2026-10-13T08-16-56.551Z.json');
const after = read('work/telemetry-retention/audit-2026-10-13T08-29-28.323Z.json');
const rows = new Map(after.databaseRows.map(r=>[r.start,r]));
for(const row of before.databaseRows){
  assert.ok(rows.has(row.start));
  for(const field of ['production_kwh','export_kwh'])if(row[field]!==null)assert.equal(rows.get(row.start)[field],row[field]);
}
assert.equal(after.cache.error,null);
assert.deepEqual(after.pending,[]);
const payload={version:'huawei-partial-retention-v1',checkedAt:new Date().toISOString(),
  commit:'b99346c',deploymentId:'dpl_CP2bNN9y4rjekL3Bbinm3oZSzYyX',status:'READY',url:'https://zissolar.vercel.app',
  tests:215,build:'passed',unchangedExistingRows:before.databaseRows.length,
  afterCacheRows:after.snapshot.rows.length,afterSqlRows:after.databaseRows.length,
  observedPartials:after.cache.partialHours.length,consoleErrors:0,
  ui:'Admin refresh reported success; prior values remained. Current-hour anchors were still from the preceding hour, so no valid partial was available for a live rollover observation.',
  limitation:'Rollover retention and final replacement verified by regression tests; no synthetic production partials inserted.',
  officialModel:'weather-solar-v3.2',physicalControl:false};
const paths=['lib/fusion-telemetry.ts','lib/fusion-client.ts','lib/dashboard.ts','lib/solar-cache.ts','lib/solar-server.ts','tests/fusion-telemetry.test.mjs','tests/fusion-client.test.mjs','tests/cache.test.mjs','tests/forecast-comparison.test.mjs','docs/telemetry-retention.md'];
const inputs={before,after,source:Object.fromEntries(paths.map(p=>[p,fs.readFileSync(p,'utf8')])),tests:fs.readFileSync('work/telemetry-retention/tests.log','utf8'),build:fs.readFileSync('work/telemetry-retention/build.log','utf8')};
const sha=s=>createHash('sha256').update(s).digest('hex');
const id=payload.version+'-'+sha(JSON.stringify({payload,inputs})).slice(0,20);
const {owner}=await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
await db().prepare('INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING').bind(id,owner,payload.version,JSON.stringify(payload),JSON.stringify(inputs)).run();
const saved=await db().prepare('SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?').bind(owner,id).first();
assert.deepEqual(saved.payload,payload);assert.deepEqual(saved.inputs,inputs);
const receipt={id,savedAt:new Date().toISOString(),readback:'exact',inputBytes:Buffer.byteLength(JSON.stringify(inputs)),payload};
fs.writeFileSync('docs/telemetry-retention-release.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
