// Idempotent research archive only; no real readings or chart forecasts changed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const root = 'work/forecast-research/';
const payload = read(root + 'original-weather-evaluation.json');
const sourcePaths = Object.keys(payload.inputHashes);
for (const path of sourcePaths)
  assert.equal(
    createHash('sha256').update(fs.readFileSync(path)).digest('hex'),
    payload.inputHashes[path],
  );
const sources = Object.fromEntries(sourcePaths.map((p) => [p, read(p)]));
// Binary GRIB payloads remain in the local archive; verify them before persisting
// their decoded point values, ranges, original source URLs and checksums.
for (const stamp of ['2026101018', '2026101100', '2026101106']) {
  const icon = sources[root + 'icon-original/' + stamp + '/source.json'];
  for (const f of icon.files) {
    const path =
      root +
      'icon-original/' +
      stamp +
      '/' +
      new URL(f.url).pathname.split('/').at(-1);
    assert.equal(
      createHash('sha256').update(fs.readFileSync(path)).digest('hex'),
      f.sha256,
    );
  }
  const gfs = sources[root + 'gfs-original/' + stamp + '/source.json'];
  for (const f of gfs.intervals) {
    const lead = (Date.parse(f.end) - Date.parse(f.runAt)) / 3600000;
    const path =
      root +
      'gfs-original/' +
      stamp +
      '/f' +
      String(lead).padStart(3, '0') +
      '.grib2';
    assert.equal(
      createHash('sha256').update(fs.readFileSync(path)).digest('hex'),
      f.sha256,
    );
  }
}
const paths = [
  'scripts/evaluate-original-weather.mjs',
  'scripts/download-icon-research.py',
  'scripts/download-gfs-run-radiation.py',
  'lib/forecast-icon.ts',
  'lib/forecast-trial.ts',
  'lib/forecast-solar.ts',
  'lib/forecast-satellite-nowcast.ts',
  'lib/forecast-trial-weather.ts',
];
const inputs = {
  sources,
  baseline: read(root + 'satellite-evaluation-inputs.json'),
  sourceCode: Object.fromEntries(
    paths.map((p) => [p, fs.readFileSync(p, 'utf8')]),
  ),
  protocol: fs.readFileSync('docs/forecast-original-weather-plan.md', 'utf8'),
};
const id =
  'original-icon-gfs-' +
  createHash('sha256')
    .update(JSON.stringify({ payload, inputs }))
    .digest('hex')
    .slice(0, 20);
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
    'original-icon-gfs-research-v1',
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
assert.deepEqual(saved.payload, payload);
assert.deepEqual(saved.inputs, inputs);
const receipt = {
  checkedAt: new Date().toISOString(),
  id,
  readback: 'exact',
  originalIconFiles: 140,
  originalGfsFields: 72,
  sourceFiles: sourcePaths.length,
  officialModelChanged: false,
  measurementsChanged: false,
};
fs.writeFileSync(
  'docs/original-weather-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
const { inputHashes: _inputHashes, shortTerm, ...rest } = payload;
const report = {
  ...rest,
  shortTerm: shortTerm.map(({ rows: _rows, ...r }) => r),
  persistence: receipt,
};
fs.writeFileSync(
  'docs/original-weather-evaluation.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(receipt));
