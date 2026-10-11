// Research-only archived regional irradiance. Two workers; fixed provider host;
// credentials only in private environment, raw source payload retained.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const [from, to] = process.argv.slice(2);
assert.ok(
  /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    /^\d{4}-\d{2}-\d{2}$/.test(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) < 32 * 86400000,
);
const dir = 'work/forecast-research/satellite-grids';
fs.mkdirSync(dir, { recursive: true });
const stamps = [];
for (let day = Date.parse(from); day <= Date.parse(to); day += 86400000)
  for (let hour = 3; hour <= 17; hour++)
    for (const minute of [0, 15, 30])
      stamps.push(
        new Date(day + hour * 3600000 + minute * 60000)
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
    if (fs.existsSync(path)) {
      done++;
      continue;
    }
    try {
      const pointPath =
        'work/forecast-research/satellite-replay/' + stamp + '.json';
      assert.ok(
        fs.existsSync(pointPath),
        'Point metadata must be downloaded first',
      );
      const point = JSON.parse(fs.readFileSync(pointPath, 'utf8'));
      const url =
        'https://thredds.lsasvcs.ipma.pt/thredds/dodsC/MSG/MDSSFTD/NETCDF/' +
        stamp.slice(0, 4) +
        '/' +
        stamp.slice(4, 6) +
        '/' +
        stamp.slice(6, 8) +
        '/NETCDF4_LSASAF_MSG_MDSSFTD_MSG-Disk_' +
        stamp +
        '.nc';
      const query = [
        'DSSF_TOT[0][767:791][2005:2037]',
        'quality_flag[0][767:791][2005:2037]',
      ]
        .join(',')
        .replace(/\[|\]/g, encodeURIComponent);
      const r = await fetch(url + '.ascii?' + query, {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(
              process.env.LSA_SAF_USERNAME + ':' + process.env.LSA_SAF_PASSWORD,
            ).toString('base64'),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw Error('Satellite grid HTTP ' + r.status);
      const ascii = await r.text();
      if (ascii.length > 1000000) throw Error('Grid response too large');
      const entry = {
        slotTime: point.slotTime,
        createdAt: point.createdAt,
        receivedAt: new Date().toISOString(),
        url,
        query,
        attributes: point.raw.attributes,
        ascii,
        sha256: createHash('sha256')
          .update(point.raw.attributes + '\n' + ascii)
          .digest('hex'),
      };
      fs.writeFileSync(path, JSON.stringify(entry));
      done++;
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ stamp, error: e.message }));
    }
    if ((done + failed) % 60 === 0)
      console.log(JSON.stringify({ done, failed, total: stamps.length }));
  }
}
await Promise.all([worker(), worker()]);
console.log(JSON.stringify({ done, failed, total: stamps.length }));
