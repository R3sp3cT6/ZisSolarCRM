// Offline, resumable point archive. Never writes SQL or exposes credentials.
// node --env-file=<private LSA env> --conditions=react-server
// --experimental-transform-types --import ./tests/register-ts.mjs
// scripts/download-satellite-series.mjs FROM TO
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fetchSatellitePoint } from '../lib/forecast-satellite-server.ts';
const [from, to] = process.argv.slice(2);
assert.ok(
  /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from <= to,
);
assert.ok(Date.parse(to) - Date.parse(from) < 46 * 86400000);
const { config } = JSON.parse(
  readFileSync('work/forecast-research/response-research-inputs.json', 'utf8'),
);
const dir = 'work/forecast-research/satellite-replay';
mkdirSync(dir, { recursive: true });
const stamps = [];
for (let day = Date.parse(from); day <= Date.parse(to); day += 86400000)
  for (let minutes = 180; minutes <= 1140; minutes += 15)
    stamps.push(
      new Date(day + minutes * 60000)
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 12),
    );
let index = 0,
  done = 0,
  failed = 0;
async function worker() {
  while (index < stamps.length) {
    const stamp = stamps[index++],
      path = dir + '/' + stamp + '.json';
    if (existsSync(path)) {
      done++;
      continue;
    }
    try {
      const point = await fetchSatellitePoint(config, stamp);
      writeFileSync(path, JSON.stringify(point));
      done++;
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ stamp, error: e.message }));
    }
    if ((done + failed) % 100 === 0)
      console.log(JSON.stringify({ done, failed, total: stamps.length }));
  }
}
await Promise.all([worker(), worker()]);
console.log(JSON.stringify({ done, failed, total: stamps.length }));
