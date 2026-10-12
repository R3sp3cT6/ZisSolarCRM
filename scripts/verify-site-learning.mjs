import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sitePrediction,
  validSiteModel,
} from '../lib/forecast-site-learning.ts';
const root = 'work/forecast-research/site-learning/',
  read = (p) => JSON.parse(fs.readFileSync(p)),
  sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const input = read(root + 'inputs.json'),
  runs = read(root + 'runs.json'),
  report = read('docs/site-learning-evaluation.json');
const frozen = read('docs/site-learning-frozen.json');
assert.equal(sha(root + 'inputs.json'), frozen.inputSha256);
for (const [path, hash] of Object.entries(frozen.hashes))
  assert.equal(sha(path), hash, path);
const revisions = input.revisions.toSorted(
  (a, b) =>
    a.observedAt.localeCompare(b.observedAt) ||
    String(a.id).localeCompare(String(b.id)),
);
let maxPortableError = 0,
  verifiedTrainingRows = 0;
for (const run of runs) {
  const known = new Map();
  for (const r of revisions)
    if (
      r.observedAt < run.originAt &&
      Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
    )
      known.set(r.start, r);
  for (const row of run.training) {
    assert.equal(known.get(row.start)?.id, row.revisionId);
    assert.equal(
      known.get(row.start).productionKwh / input.config.acKw,
      row.value,
    );
    assert.ok(
      row.observedAt < run.originAt && row.weatherOriginAt < run.originAt,
    );
    assert.ok(Date.parse(row.start) + 3600000 <= Date.parse(row.observedAt));
    verifiedTrainingRows++;
  }
  assert.ok(run.training.length >= 120);
  const day = input.days.find((d) => d.date === run.date);
  for (const [method, outputs] of Object.entries(run.outputs)) {
    assert.deepEqual(
      outputs.map((r) => r.start),
      day.hours.map((h) => h.start),
    );
    for (const [i, p] of outputs.entries()) {
      assert.ok(
        Number.isFinite(p.kwh) && p.kwh >= 0 && p.kwh <= input.config.acKw,
      );
      assert.equal(
        p.kwh,
        day.hours[i].clearSky === 0
          ? 0
          : Math.max(0, Math.min(input.config.acKw, p.rawKwh)),
      );
      const scored = report.rows.find((r) => r.start === p.start);
      if (scored) assert.equal(scored[method], p.kwh);
    }
  }
}
for (const [label, scores] of Object.entries(report.scores)) {
  const rows = report.rows.filter(
    (r) =>
      label === 'all' ||
      (label === 'october' ? r.date >= '2026-10-01' : r.date < '2026-10-01'),
  );
  for (const [method, s] of Object.entries(scores)) {
    const actual = rows.reduce((v, r) => v + r.actualKwh, 0),
      ae = rows.reduce((v, r) => v + Math.abs(r[method] - r.actualKwh), 0);
    assert.ok(Math.abs(s.wape - (100 * ae) / actual) < 1e-9);
    assert.equal(s.hours, rows.length);
  }
}
const selection = read(root + 'selection.json');
assert.equal(
  selection.selected,
  Object.entries(selection.scores).sort((a, b) => a[1].wape - b[1].wape)[0][0],
);
assert.equal(report.selected, selection.selected);
const model = read(root + 'model.json');
assert.ok(validSiteModel(model, input.config, new Date(model.trainedAt)));
for (const fixture of read(root + 'portable-fixtures.json')) {
  const actual =
    fixture.clearSky === 0 ? 0 : sitePrediction(fixture.values, model);
  assert.notEqual(actual, null);
  maxPortableError = Math.max(maxPortableError, Math.abs(actual - fixture.kwh));
}
assert.ok(
  maxPortableError < 1e-5,
  'Portable model differs from fitted Python model: ' + maxPortableError,
);
// The original baseline must remain bit-for-bit on every common historical hour.
// Input baseline was independently reconstructed and verified by the earlier run.
const baseline = new Map(
  read('work/forecast-research/timesfm/inputs.json').candidates.flatMap((d) =>
    d.future.map((h) => [h.start, h.baselineKwh]),
  ),
);
for (const row of report.rows) assert.equal(row.v32, baseline.get(row.start));
const receipt = {
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  origins: runs.length,
  verifiedTrainingRows,
  portableFixtures: read(root + 'portable-fixtures.json').length,
  maxPortableErrorKwh: maxPortableError,
  inputSha256: sha(root + 'inputs.json'),
  runsSha256: sha(root + 'runs.json'),
  modelSha256: sha(root + 'model.json'),
  evaluationSha256: sha('docs/site-learning-evaluation.json'),
  selected: report.selected,
};
fs.writeFileSync(
  'docs/site-learning-verification.json',
  JSON.stringify(receipt, null, 2) + '\n',
);
fs.mkdirSync('lib/models', { recursive: true });
fs.copyFileSync(root + 'model.json', 'lib/models/solar-site-v1.json');
console.log(JSON.stringify(receipt, null, 2));
