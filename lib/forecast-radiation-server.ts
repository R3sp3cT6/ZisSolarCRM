import 'server-only';
import type { AtmosphereSource, ForecastConfig } from './forecast-model';
import {
  GFS_RADIATION_FIELD,
  parseGfsRadiation,
  radiationTimeAxis,
  type RadiationHour,
} from './forecast-radiation';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';

const ROOT = 'https://thredds.ucar.edu/thredds/';
const DATASET = 'grib/NCEP/GFS/Global_0p25deg/';
const MAX_AGE = 24 * 3600000;
type Radiation = {
  source: AtmosphereSource;
  hours: RadiationHour[];
  raw: { run: string; csv: string; das: string; bounds: string } | null;
};
export function latestGfsRun(xml: string, now: Date) {
  const runs = [
    ...xml.matchAll(/GFS_Global_0p25deg_(\d{8})_(00|06|12|18)00\.grib2/g),
  ]
    .map((m) => {
      const date = m[1],
        issuedAt = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${m[2]}:00:00Z`;
      return { path: DATASET + m[0], issuedAt, stamp: Date.parse(issuedAt) };
    })
    .filter(
      (r) => r.stamp <= now.getTime() && now.getTime() - r.stamp <= MAX_AGE,
    )
    .sort((a, b) => b.stamp - a.stamp);
  if (!runs.length) throw Error('No fresh GFS run');
  return runs[0];
}
async function fetchText(url: string, limit: number) {
  const r = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok || Number(r.headers.get('content-length')) > limit)
    throw Error('GFS unavailable');
  const text = await r.text();
  if (text.length > limit) throw Error('Oversized GFS response');
  return text;
}
export async function fetchRadiation(
  c: ForecastConfig,
  now: Date,
): Promise<Radiation> {
  const empty: Radiation = {
    hours: [],
    raw: null,
    source: {
      status: 'unavailable',
      issuedAt: null,
      fetchedAt: null,
      latitude: null,
      longitude: null,
      hours: 0,
    },
  };
  if (c.latitude === null || c.longitude === null) return empty;
  const key = `forecast-radiation:gfs-v2:${c.latitude.toFixed(4)}:${c.longitude.toFixed(4)}`;
  try {
    const result = await withCacheLock(
      key,
      async () => {
        const saved = await cacheRead<{ expires: number; value: Radiation }>(
          key,
        );
        if (
          saved &&
          saved.expires > now.getTime() &&
          (!saved.value.source.issuedAt ||
            now.getTime() - Date.parse(saved.value.source.issuedAt) <= MAX_AGE)
        )
          return saved.value;
        try {
          const run = latestGfsRun(
            await fetchText(
              ROOT + 'catalog/' + DATASET + 'catalog.xml',
              150000,
            ),
            now,
          );
          const query = new URLSearchParams({
            var: GFS_RADIATION_FIELD,
            latitude: String(c.latitude),
            longitude: String(c.longitude),
            time_start: run.issuedAt,
            time_end: new Date(run.stamp + 9 * 86400000).toISOString(),
            accept: 'csv',
          });
          const [csv, das] = await Promise.all([
            fetchText(ROOT + 'ncss/grid/' + run.path + '?' + query, 50000),
            fetchText(ROOT + 'dodsC/' + run.path + '.das', 300000),
          ]);
          const axis = radiationTimeAxis(das, run.issuedAt);
          const bounds = await fetchText(
            ROOT + 'dodsC/' + run.path + '.ascii?' + axis.bounds,
            20000,
          );
          const parsed = parseGfsRadiation(csv, das, bounds, run.issuedAt, c);
          const value: Radiation = {
            hours: parsed.hours,
            source: {
              status: 'ready',
              issuedAt: run.issuedAt,
              fetchedAt: now.toISOString(),
              latitude: parsed.latitude,
              longitude: parsed.longitude,
              hours: parsed.hours.length,
            },
            raw: { run: run.path, csv, das, bounds },
          };
          await cacheWrite(
            key,
            { expires: now.getTime() + 3 * 3600000, value },
            86400,
          );
          return value;
        } catch {
          await cacheWrite(
            key,
            { expires: now.getTime() + 900000, value: empty },
            900,
          );
          return empty;
        }
      },
      40,
    );
    return result.busy ? empty : result.value;
  } catch {
    return empty;
  }
}
