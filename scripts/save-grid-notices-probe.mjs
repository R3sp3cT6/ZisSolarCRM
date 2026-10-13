// Persist the first observed public response without inventing historical receipts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
import {
  parseGridNotices,
  GRID_OUTAGES_URL,
  GRID_OUTAGES_VERSION,
} from '../lib/grid-outages.ts';
const root = 'work/forecast-research/grid-notices/';
const rawBytes = fs.readFileSync(root + 'outages.json');
const raw = rawBytes.toString('utf8');
const receipt = JSON.parse(
  fs.readFileSync(root + 'outages-receipt.json', 'utf8'),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(rawBytes), receipt.sha256);
assert.equal(receipt.sourceUrl, GRID_OUTAGES_URL);
assert.equal(receipt.http.status, 200);
const notices = parseGridNotices(JSON.parse(raw));
const payload = {
  version: GRID_OUTAGES_VERSION,
  sourceUrl: GRID_OUTAGES_URL,
  status: 'available',
  receivedAt: receipt.receivedAt,
  publishedAt: null,
  timeBasis: 'source-wall-clock-unverified',
  applicability: 'unconfirmed',
  appliedToForecast: false,
  count: notices.length,
  resenTextMatches: notices
    .filter((n) => /ресен|resen/i.test(n.settlement + ' ' + n.location))
    .map((n) => n.id),
  startDates: [
    ...new Set(notices.map((n) => n.startLocal.slice(0, 10))),
  ].sort(),
};
const codePaths = [
  'lib/grid-outages.ts',
  'lib/grid-outages-server.ts',
  'lib/forecast-server.ts',
  'tests/grid-outages.test.mjs',
  'tests/forecast-server.test.mjs',
  'scripts/save-grid-notices-probe.mjs',
];
const inputs = {
  raw,
  receipt,
  notices,
  report: fs.readFileSync('docs/grid-notices-integration.md', 'utf8'),
  code: Object.fromEntries(
    codePaths.map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
};
const id =
  GRID_OUTAGES_VERSION +
  '-' +
  sha(JSON.stringify({ payload, inputs })).slice(0, 20);
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
await db()
  .prepare(
    'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
  )
  .bind(
    id,
    owner,
    GRID_OUTAGES_VERSION,
    JSON.stringify(payload),
    JSON.stringify(inputs),
  )
  .run();
const saved = await db()
  .prepare(
    'SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?',
  )
  .bind(owner, id)
  .first();
assert.deepEqual(saved, { payload, inputs });
const result = {
  id,
  savedAt: new Date().toISOString(),
  readback: 'exact',
  firstReceipt: receipt.receivedAt,
  count: notices.length,
  appliesToPlant: 'unknown',
  inputBytes: Buffer.byteLength(JSON.stringify(inputs)),
  payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
  officialForecastChanged: false,
};
fs.writeFileSync(
  'docs/grid-notices-persistence.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
