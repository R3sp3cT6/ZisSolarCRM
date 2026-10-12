import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { providerHours } from '../lib/forecast-provider-hours.ts';
import { siteFeatures, SITE_FEATURES } from '../lib/forecast-site-learning.ts';
import { slotsForDay, localDate } from '../lib/energy.ts';
const root = 'work/forecast-research/full-history/',
  read = (p) => JSON.parse(fs.readFileSync(p));
const source = read(root + 'source.json'),
  status = read(root + 'download-status.json');
assert.equal(status.requestedDays, source.days.length);
const byStart = new Map(
  source.actual.map((r, i) => [r.start, { ...r, index: i }]),
);
const old = read('docs/site-learning-evaluation.json');
const baseline = new Map(old.rows.map((r) => [r.start, r.v32]));
const days = [],
  archives = [],
  unavailable = [];
for (const coverage of source.days) {
  const date = coverage.date,
    path = root + 'gfs/' + date + '.json';
  if (!fs.existsSync(path)) {
    unavailable.push({ date, reason: 'weather archive missing' });
    continue;
  }
  const a = read(path),
    slots = slotsForDay(date),
    startSet = new Set(slots.map((s) => s.start));
  const runAt = new Date(a.runAt).toISOString(),
    originAt = new Date(a.originAt).toISOString();
  assert.equal(a.date, date);
  assert.equal(a.nativeResolutionHours, 1);
  assert.equal(
    localDate(originAt),
    new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10),
  );
  assert.equal(Date.parse(originAt) - Date.parse(runAt), 6 * 3600000);
  for (const field of a.fields) {
    assert.ok(Date.parse(field.lastModified) <= Date.parse(originAt));
    assert.ok(
      field.distanceKm < 25 && field.endLead >= 7 && field.endLead <= 34,
    );
    assert.match(field.sha256, /^[a-f0-9]{64}$/);
  }
  const hours = providerHours(runAt, a.fields, 'gfs').filter((h) =>
    startSet.has(h.start),
  );
  assert.deepEqual(
    hours.map((h) => h.start),
    slots.map((s) => s.start),
  );
  const features = siteFeatures(hours, source.config);
  assert.equal(features.length, slots.length);
  days.push({
    date,
    runAt,
    originAt,
    coverage,
    hours: features.map((h, i) => ({
      ...h,
      irradiance: hours[i].irradiance,
      actualIndex: byStart.get(h.start)?.index ?? null,
      actualKwh: byStart.get(h.start)?.productionKwh ?? null,
      v32: baseline.get(h.start) ?? null,
    })),
  });
  archives.push(a);
}
const input = {
  preparedAt: new Date().toISOString(),
  config: source.config,
  first: source.first,
  last: source.last,
  sourceExportedAt: source.exportedAt,
  features: SITE_FEATURES,
  actual: source.actual,
  revisions: source.revisions,
  days,
  archives,
  unavailable,
  confirmedInterruptions: [
    read('docs/july-interruption-confirmation.json'),
    read('docs/forecast-confirmed-outages.json'),
  ],
};
fs.writeFileSync(root + 'inputs.json', JSON.stringify(input));
const paths = [
  'scripts/export-full-history.mjs',
  'scripts/download-full-history.py',
  'scripts/prepare-full-history.mjs',
  'scripts/evaluate-full-history.py',
  'tests/full-history.test.py',
  'docs/full-history-plan.md',
  'lib/forecast-provider-hours.ts',
  'lib/forecast-site-learning.ts',
];
const code = Object.fromEntries(
  paths.map((p) => [p, fs.readFileSync(p, 'utf8')]),
);
const sha = (x) => createHash('sha256').update(x).digest('hex');
const frozen = {
  frozenAt: input.preparedAt,
  inputSha256: sha(fs.readFileSync(root + 'inputs.json')),
  codeHashes: Object.fromEntries(paths.map((p) => [p, sha(code[p])])),
};
fs.writeFileSync(root + 'frozen-source.json', JSON.stringify(code));
fs.writeFileSync(
  'docs/full-history-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    first: input.first,
    last: input.last,
    days: days.length,
    hours: days.reduce((s, d) => s + d.hours.length, 0),
    unavailable,
    frozen,
  }),
);
