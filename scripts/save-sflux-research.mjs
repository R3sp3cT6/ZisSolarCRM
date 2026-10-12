import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const root = 'work/forecast-research/sflux/';
const read = (p) => JSON.parse(fs.readFileSync(p));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const verification = read('docs/sflux-research-verification.json');
const frozen = read('docs/sflux-research-frozen.json');
const frozenSource = read(root + 'frozen-source.json');
const payload = read('docs/sflux-research-evaluation.json');
assert.equal(verification.status, 'passed');
assert.equal(payload.promotion, false);
assert.equal(frozen.days, 192);
for (const [p, h] of Object.entries(frozen.codeHashes)) assert.equal(sha(frozenSource[p]), h);
for (const [p, h] of Object.entries(verification.hashes)) assert.equal(sha(fs.readFileSync(p)), h);
const inputs = {
  data: read(root + 'inputs.json'), runs: read(root + 'runs.json'),
  originalRuns: read('work/forecast-research/full-history/runs.json'),
  originalEvaluation: read('docs/full-history-evaluation.json'),
  originalFrozenSource: read('work/forecast-research/full-history/frozen-source.json'),
  verification, frozen, frozenSource,
  targetAudit: read('docs/sflux-research-target-audit.json'),
  sourceProbe: read('docs/sflux-pilot-verification.json'),
  sourceProbeResearch: read('docs/sflux-pilot-persistence.json'),
  report: fs.readFileSync('docs/sflux-research-results.md', 'utf8'),
  verificationCode: fs.readFileSync('scripts/verify-sflux-research.mjs', 'utf8'),
  reportingCode: fs.readFileSync('scripts/report-sflux-research.mjs', 'utf8'),
};
assert.equal(inputs.targetAudit.goalComplete, false);
const { owner } = await db().prepare("SELECT owner FROM plants WHERE name='ZIS Solar'").first();
const id = payload.version + '-' + sha(JSON.stringify({ payload, inputs })).slice(0, 20);
await db().prepare('INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING')
  .bind(id, owner, payload.version, JSON.stringify(payload), JSON.stringify(inputs)).run();
const saved = await db().prepare('SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?').bind(owner, id).first();
assert.deepEqual(saved.payload, payload); assert.deepEqual(saved.inputs, inputs);
const receipt = { id, savedAt: new Date().toISOString(), readback: 'exact',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)), payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  officialForecastChanged: false, newLiveCandidate: false, actualsChanged: false };
fs.writeFileSync('docs/sflux-research-persistence.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
