import 'server-only';
import { createHash } from 'node:crypto';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import type { ForecastConfig } from './forecast-model';
import {
  parseSatellite,
  type SatellitePoint,
  type SatelliteSource,
} from './forecast-satellite';
const CATALOG =
  'https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MSG/MDSSFTD/NETCDF/';
const DODS =
  'https://thredds.lsasvcs.ipma.pt/thredds/dodsC/MSG/MDSSFTD/NETCDF/';
async function read(url: string, auth = false) {
  const headers: Record<string, string> = {};
  if (auth)
    headers.Authorization =
      'Basic ' +
      Buffer.from(
        process.env.LSA_SAF_USERNAME + ':' + process.env.LSA_SAF_PASSWORD,
      ).toString('base64');
  const r = await fetch(url, {
    headers,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw Error('Satellite HTTP ' + r.status);
  const reader = r.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1000000) throw Error('Satellite response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function fetchSatellitePoint(
  c: ForecastConfig,
  stamp: string,
): Promise<SatellitePoint> {
  if (
    !/^\d{12}$/.test(stamp) ||
    c.latitude === null ||
    c.longitude === null ||
    Math.abs(c.latitude) > 79 ||
    Math.abs(c.longitude) > 79
  )
    throw Error('Unsupported satellite coordinates');
  const slotTime = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10)}:00.000Z`;
  const path = `${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/${stamp.slice(6, 8)}/NETCDF4_LSASAF_MSG_MDSSFTD_MSG-Disk_${stamp}.nc`;
  const y = Math.round((80 - c.latitude) / 0.05),
    x = Math.round((c.longitude + 80) / 0.05);
  const query = ['DSSF_TOT', 'FRACTION_DIFFUSE', 'quality_flag']
    .map((v) => `${v}[0][${y}][${x}]`)
    .join(',')
    .replace(/\[|\]/g, encodeURIComponent);
  const url = DODS + path;
  const [das, ascii] = await Promise.all([
    read(url + '.das', true),
    read(url + '.ascii?' + query, true),
  ]);
  return {
    ...parseSatellite(
      das,
      ascii,
      slotTime,
      c.latitude,
      c.longitude,
      new Date().toISOString(),
    ),
    url,
    raw: { attributes: das, ascii },
    sha256: createHash('sha256')
      .update(das + '\n' + ascii)
      .digest('hex'),
  };
}
/** Shared 15-minute source cache; invoked only from existing active/forecast work. */
export async function fetchSatellite(
  c: ForecastConfig,
  now = new Date(),
): Promise<SatelliteSource> {
  const empty: SatelliteSource = {
    status: 'unconfigured',
    fetchedAt: now.toISOString(),
    points: [],
  };
  if (!process.env.LSA_SAF_USERNAME || !process.env.LSA_SAF_PASSWORD)
    return empty;
  const key = `satellite:v1:${c.latitude}:${c.longitude}`,
    saved = await cacheRead<SatelliteSource>(key);
  if (saved && now.getTime() - Date.parse(saved.fetchedAt) < 15 * 60000)
    return saved;
  const result = await withCacheLock(
    key,
    async () => {
      try {
        const dates = [now, new Date(now.getTime() - 86400000)].map((d) =>
          d.toISOString().slice(0, 10).replaceAll('-', '/'),
        );
        const lists = await Promise.all(
          dates.map(async (d) => {
            try {
              return await read(CATALOG + d + '/');
            } catch {
              return '';
            }
          }),
        );
        const stamps = [
          ...new Set(
            lists.flatMap((s) =>
              [
                ...s.matchAll(
                  /NETCDF4_LSASAF_MSG_MDSSFTD_MSG-Disk_(\d{12})\.nc/g,
                ),
              ].map((m) => m[1]),
            ),
          ),
        ]
          .sort()
          .reverse()
          .slice(0, 2);
        const points = (
          await Promise.all(stamps.map((s) => fetchSatellitePoint(c, s)))
        ).sort((a, b) => a.slotTime.localeCompare(b.slotTime));
        const last = points.at(-1);
        const fresh =
          last &&
          Date.parse(last.slotTime) <= now.getTime() &&
          now.getTime() - Date.parse(last.slotTime) < 45 * 60000;
        const source: SatelliteSource = {
          status:
            fresh && last.quality !== 'rejected' ? 'ready' : 'unavailable',
          fetchedAt: new Date().toISOString(),
          points,
          reason: !fresh
            ? 'stale'
            : last?.quality === 'rejected'
              ? 'quality'
              : undefined,
        };
        await cacheWrite(key, source, 86400);
        return source;
      } catch {
        const failed: SatelliteSource = {
          ...empty,
          status: 'unavailable',
          reason: 'source',
        };
        await cacheWrite(key, failed, 900);
        return failed;
      }
    },
    50,
  );
  return result.busy
    ? (saved ?? { ...empty, status: 'unavailable', reason: 'busy' })
    : result.value;
}
