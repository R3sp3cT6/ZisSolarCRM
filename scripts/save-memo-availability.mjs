import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {db} from '../db/index.ts';
const read = p => JSON.parse(fs.readFileSync(p));
const sha = s => createHash('sha256').update(s).digest('hex');
const payload = read('docs/memo-availability-evaluation.json');
const verification = read('docs/memo-availability-verification.json');
const frozen = read('docs/memo-availability-frozen.json');
assert.equal(verification.status,'passed');
assert.equal(sha(fs.readFileSync('docs/memo-availability-evaluation.json')),verification.evaluationSha256);
for(const [p,h] of Object.entries(frozen.hashes))assert.equal(sha(fs.readFileSync(p)),h);
const inputs = {
  prices:read('work/forecast-research/memo-availability/prices.json'),
  originalInputs:read('work/forecast-research/full-history/inputs.json'),
  originalRuns:read('work/forecast-research/full-history/runs.json'),
  originalEvaluation:read('docs/full-history-evaluation.json'),
  originalPersistence:read('docs/full-history-persistence.json'),
  frozenSource:read('work/forecast-research/memo-availability/frozen-source.json'),
  frozen, verification,
  report:fs.readFileSync('docs/memo-availability-results.md','utf8'),
};
const {owner}=await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const id=payload.version+'-'+sha(JSON.stringify({payload,inputs})).slice(0,20);
await db().prepare('INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING')
  .bind(id,owner,payload.version,JSON.stringify(payload),JSON.stringify(inputs)).run();
const saved=await db().prepare('SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?').bind(owner,id).first();
assert.deepEqual(saved.payload,payload);assert.deepEqual(saved.inputs,inputs);
const receipt={id,savedAt:new Date().toISOString(),readback:'exact',inputBytes:Buffer.byteLength(JSON.stringify(inputs)),payloadBytes:Buffer.byteLength(JSON.stringify(payload)),officialForecastChanged:false,actualsChanged:false};
fs.writeFileSync('docs/memo-availability-persistence.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
