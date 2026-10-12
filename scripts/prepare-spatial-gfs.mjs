import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reconstructDay } from '../lib/forecast-backtest.ts';
const root = 'work/forecast-research/',
  out = root + 'spatial-gfs/';
const hashes = {};
const hash = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => {
  const raw = fs.readFileSync(p);
  hashes[p] = hash(raw);
  return JSON.parse(raw);
};
const source = read(root + 'site-learning/inputs.json'),
  decoded = read(out + 'decoded.json'),
  oct = read(root + 'satellite-replay-full.json');
const days = decoded.days.map((d) => {
  const original = source.days.find((v) => v.date === d.date);
  assert.ok(original);
  let old;
  if (d.date >= '2026-10-01')
    old = oct.inputs.replay.inputs.days.find((v) => v.date === d.date);
  else {
    const archive = read(root + 'gfs-september/' + d.date + '.json');
    archive.radiation = read(
      root + 'gfs-september-radiation/' + d.date + '-radiation.json',
    );
    const known = new Map();
    for (const r of source.revisions)
      if (
        Date.parse(r.observedAt) < Date.parse(d.originAt) &&
        Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
      )
        known.set(r.start, r);
    old = reconstructDay(
      archive,
      [...known.values()].map((r) => ({
        start: r.start,
        production_kwh: r.productionKwh,
        export_kwh: null,
      })),
      source.config,
    ).inputs;
  }
  assert.ok(old?.weather?.length && old.calibration);
  return { ...d, original, weather: old.weather, calibration: old.calibration };
});
const input = {
  preparedAt: new Date().toISOString(),
  config: source.config,
  days,
  sourceHashes: hashes,
};
fs.writeFileSync(out + 'inputs.json', JSON.stringify(input));
const paths = [
  'docs/forecast-spatial-gfs-plan.md',
  'scripts/decode-spatial-gfs.py',
  'scripts/prepare-spatial-gfs.mjs',
  'scripts/evaluate-spatial-gfs.mjs',
  'lib/forecast-provider-hours.ts',
  'lib/forecast-solar.ts',
];
const frozen = {
  frozenAt: new Date().toISOString(),
  inputSha256: hash(fs.readFileSync(out + 'inputs.json')),
  codeHashes: Object.fromEntries(
    paths.map((p) => [p, hash(fs.readFileSync(p))]),
  ),
};
fs.writeFileSync(
  out + 'frozen-source.json',
  JSON.stringify(
    Object.fromEntries(paths.map((p) => [p, fs.readFileSync(p, 'utf8')])),
  ),
);
fs.writeFileSync(
  'docs/spatial-gfs-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
console.log(JSON.stringify({ days: days.length, frozen }));
