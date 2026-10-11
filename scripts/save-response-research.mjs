// Explicit append-only maintenance archive. Never changes measured production,
// chart forecasts, model configuration, or historical availability timestamps.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { db } from '../db/index.ts';
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { owner } = await db()
  .prepare("SELECT owner FROM plants WHERE name='ZIS Solar'")
  .first();
assert.ok(owner);
const receipts = [];
async function save(model, label, payload, inputs) {
  const checksum = hash({ payload, inputs });
  const id = 'response-research-' + label + '-' + checksum.slice(0, 20);
  await db()
    .prepare(
      'INSERT INTO forecast_evaluations(id,owner,model_version,payload,inputs) VALUES(?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING',
    )
    .bind(id, owner, model, JSON.stringify(payload), JSON.stringify(inputs))
    .run();
  const saved = await db()
    .prepare(
      'SELECT payload,inputs FROM forecast_evaluations WHERE owner=? AND id=?',
    )
    .bind(owner, id)
    .first();
  assert.deepEqual(saved.payload, payload);
  assert.deepEqual(saved.inputs, inputs);
  receipts.push({ id, model, label, sha256: checksum, readback: 'exact' });
  return id;
}
// Require completed, frozen validation before recording a final research audit.
const development = read('work/forecast-research/response-development.json');
const holdout = read('work/forecast-research/response-holdout.json');
const latency10 = read(
  'work/forecast-research/response-holdout-latency10.json',
);
const frozen = read('docs/forecast-response-frozen.json');
assert.deepEqual(holdout.codeHashes, frozen.codeHashes);
assert.deepEqual(latency10.codeHashes, frozen.codeHashes);
const sourceIds = [];
let points = 0,
  grids = 0;
const pointDir = 'work/forecast-research/satellite-replay/';
const gridDir = 'work/forecast-research/satellite-grids/';
const pointFiles = fs.readdirSync(pointDir).sort(),
  gridFiles = fs.readdirSync(gridDir).sort();
for (
  let day = Date.parse('2026-09-08');
  day <= Date.parse('2026-10-11');
  day += 86400000
) {
  const date = new Date(day).toISOString().slice(0, 10),
    stamp = date.replaceAll('-', '');
  const satellitePoints = pointFiles
    .filter((f) => f.startsWith(stamp) && f.endsWith('.json'))
    .map((f) => read(pointDir + f));
  const satelliteGrids = gridFiles
    .filter((f) => f.startsWith(stamp) && f.endsWith('.json'))
    .map((f) => read(gridDir + f));
  assert.equal(satellitePoints.length, 65, date);
  assert.equal(
    satelliteGrids.length,
    date >= '2026-09-09' && date <= '2026-09-30' ? 45 : 0,
    date,
  );
  for (const g of satelliteGrids)
    assert.equal(
      g.sha256,
      createHash('sha256')
        .update(g.attributes + '\n' + g.ascii)
        .digest('hex'),
    );
  const gfs =
    date >= '2026-09-09' && date <= '2026-09-30'
      ? {
          weather: read(
            'work/forecast-research/gfs-september/' + date + '.json',
          ),
          radiation: read(
            'work/forecast-research/gfs-september-radiation/' +
              date +
              '-radiation.json',
          ),
        }
      : null;
  sourceIds.push(
    await save(
      'forecast-research-source-v1',
      date,
      {
        date,
        purpose:
          'Offline validation inputs; original download/creation times preserved',
        pointCount: satellitePoints.length,
        gridCount: satelliteGrids.length,
        attribution: 'LSA SAF / EUMETSAT / IPMA MDSSFTD; NOAA GFS',
        gfsStorage:
          'Extracted source values, coordinates, units, original URLs, byte ranges and GRIB/index checksums. Full GRIB binaries retained in local research archive.',
      },
      { satellitePoints, satelliteGrids, gfs },
    ),
  );
  points += satellitePoints.length;
  grids += satelliteGrids.length;
  if (sourceIds.length % 5 === 0)
    console.log(
      JSON.stringify({ archivedDays: sourceIds.length, points, grids }),
    );
}
const outageId = await save(
  'plant-availability-confirmations-v1',
  'confirmed-interruptions',
  read('docs/forecast-confirmed-outages.json'),
  read('work/forecast-research/september-zero-reports.json'),
);
const inputs = read('work/forecast-research/response-research-inputs.json');
const evaluationId = await save(
  'regional-motion-v1-research',
  'evaluation',
  {
    frozen,
    development,
    holdout,
    latency10,
    protocol: fs.readFileSync(
      'docs/forecast-response-research-plan.md',
      'utf8',
    ),
    limitations: [
      'Retrospective evaluation; current code/configuration were created after the historical dates.',
      'Historical satellite delivery latency was not logged: original creation +2min and +10min are assumptions, not actual receipts.',
      'Short-term satellite-component comparison on a GFS background, not full ICON plus Huawei or day-ahead accuracy.',
      'All paired valid zeros retained. User-confirmed outage days excluded only in secondary diagnostic.',
    ],
  },
  { ...inputs, sourceIds, outageId },
);
const receipt = {
  checkedAt: new Date().toISOString(),
  evaluationId,
  outageId,
  sourceDays: sourceIds.length,
  points,
  grids,
  records: receipts,
};
fs.writeFileSync(
  'docs/response-research-persistence.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    evaluationId,
    outageId,
    sourceDays: sourceIds.length,
    points,
    grids,
    readback: 'exact',
  }),
);
