import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { providerHours } from '../lib/forecast-provider-hours.ts';
import { siteFeatures, SITE_FEATURES } from '../lib/forecast-site-learning.ts';
import { slotsForDay } from '../lib/energy.ts';
import { weatherAdjustedEnergy } from '../lib/forecast-solar.ts';
import { reconstructDay } from '../lib/forecast-backtest.ts';
const root = 'work/forecast-research/site-learning/',
  read = (p) => JSON.parse(fs.readFileSync(p));
const source = read('work/forecast-research/timesfm/source.json');
const oct = read('work/forecast-research/satellite-replay-full.json');
const canonical = (x) => new Date(x).toISOString();
const revisions = source.revisions
  .map((r) => ({
    ...r,
    start: canonical(r.start),
    observedAt: canonical(r.observedAt),
  }))
  .sort(
    (a, b) =>
      a.observedAt.localeCompare(b.observedAt) ||
      String(a.id).localeCompare(String(b.id)),
  );
const actual = new Map(
  source.actual.map((r) => [canonical(r.start), r.productionKwh]),
);
const preserved = read('work/forecast-research/timesfm/inputs.json').candidates;
const baseline = new Map(
  preserved.flatMap((d) => d.future.map((h) => [h.start, h.baselineKwh])),
);
const days = [],
  archives = [];
for (
  let t = Date.parse('2026-08-16');
  t <= Date.parse('2026-10-11');
  t += 86400000
) {
  const date = canonical(t).slice(0, 10),
    archive = read(root + 'gfs/' + date + '.json');
  assert.equal(archive.nativeResolutionHours, 1);
  const originAt = canonical(archive.originAt),
    runAt = canonical(archive.runAt);
  for (const f of archive.fields)
    assert.ok(Date.parse(f.lastModified) <= Date.parse(originAt));
  const slots = new Set(slotsForDay(date).map((s) => s.start));
  const hours = providerHours(runAt, archive.fields, 'gfs').filter((h) =>
    slots.has(h.start),
  );
  assert.deepEqual(
    hours.map((h) => h.start),
    [...slots],
  );
  const features = siteFeatures(hours, source.config);
  assert.equal(features.length, hours.length);
  let old;
  if (date >= '2026-10-01')
    old = oct.inputs.replay.inputs.days.find((d) => d.date === date);
  else if (date >= '2026-09-21') {
    const a = read('work/forecast-research/gfs-september/' + date + '.json');
    a.radiation = read(
      'work/forecast-research/gfs-september-radiation/' +
        date +
        '-radiation.json',
    );
    const known = new Map();
    for (const r of revisions)
      if (
        r.observedAt < originAt &&
        Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
      )
        known.set(r.start, r);
    old = reconstructDay(
      a,
      [...known.values()].map((r) => ({
        start: r.start,
        production_kwh: r.productionKwh,
        export_kwh: null,
      })),
      source.config,
    ).inputs;
  }
  const byStart = new Map(hours.map((h) => [h.start, h]));
  const ratios =
    old?.weather.flatMap((w) => {
      const base = weatherAdjustedEnergy(w, source.config, old.calibration),
        corrected = baseline.get(w.start);
      return base > 5 &&
        base < source.config.acKw &&
        corrected != null &&
        corrected < source.config.acKw
        ? [corrected / base]
        : [];
    }) ?? [];
  const gain = ratios[0] ?? 1;
  assert.ok(
    ratios.every((r) => Math.abs(r - gain) < 1e-7),
    'Original baseline gain mismatch ' + date,
  );
  days.push({
    date,
    originAt,
    runAt,
    gain,
    regime: preserved.find((d) => d.date === date)?.regime ?? null,
    hours: features.map((h) => {
      const weather = old?.weather.find((w) => w.start === h.start);
      return {
        ...h,
        irradiance: byStart.get(h.start).irradiance,
        actualKwh: actual.get(h.start) ?? null,
        baselineKwh: baseline.get(h.start) ?? (h.clearSky === 0 ? 0 : null),
        nativePhysicsKwh: weather
          ? Math.min(
              source.config.acKw,
              gain *
                weatherAdjustedEnergy(
                  {
                    ...weather,
                    irradiance: byStart.get(h.start).irradiance,
                    resolutionHours: 1,
                  },
                  source.config,
                  old.calibration,
                ),
            )
          : null,
      };
    }),
  });
  archives.push(archive);
}
const payload = {
  preparedAt: new Date().toISOString(),
  config: source.config,
  featureNames: SITE_FEATURES,
  revisions,
  days,
  archives,
};
fs.writeFileSync(root + 'inputs.json', JSON.stringify(payload));
const paths = [
  'scripts/prepare-site-learning.mjs',
  'scripts/run-site-learning.py',
  'lib/forecast-site-learning.ts',
  'docs/solar-learning-plan.md',
];
const frozen = {
  frozenAt: payload.preparedAt,
  inputSha256: createHash('sha256')
    .update(fs.readFileSync(root + 'inputs.json'))
    .digest('hex'),
  hashes: Object.fromEntries(
    paths.map((p) => [
      p,
      createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
    ]),
  ),
};
fs.writeFileSync(
  'docs/site-learning-frozen.json',
  JSON.stringify(frozen, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    days: days.length,
    hours: days.reduce((s, d) => s + d.hours.length, 0),
    frozen,
  }),
);
