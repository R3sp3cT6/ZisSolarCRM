// Offline point retrieval only. Credentials come from a private env file; no SQL writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fetchSatellitePoint } from '../lib/forecast-satellite-server.ts';
import { clearSkyIrradiance } from '../lib/forecast-solar.ts';
const input = JSON.parse(
  readFileSync(
    'work/forecast-research/satellite-evaluation-inputs.json',
    'utf8',
  ),
);
const config = input.replay.inputs.config;
const dir = 'work/forecast-research/satellite-replay';
mkdirSync(dir, { recursive: true });
const stamps = [
  ...new Set(
    input.replay.payload.days
      .flatMap((d) => d.hours)
      .filter((h) => clearSkyIrradiance(h.start, config) > 0)
      .flatMap((h) =>
        [45, 30].map((m) =>
          new Date(Date.parse(h.start) - m * 60000)
            .toISOString()
            .replace(/[-:T]/g, '')
            .slice(0, 12),
        ),
      ),
  ),
].sort((a, b) => a.localeCompare(b));
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
    if ((done + failed) % 30 === 0)
      console.log(JSON.stringify({ done, failed, total: stamps.length }));
  }
}
await Promise.all([worker(), worker()]);
console.log(
  JSON.stringify({ done, failed, total: stamps.length, directory: dir }),
);
