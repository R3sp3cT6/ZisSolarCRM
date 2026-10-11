import 'server-only';
import type { AtmosphereSource, ForecastConfig } from './forecast-model';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';

const ROOT = 'https://thredds.silam.fmi.fi/thredds/';
const DATASET = 'silam_glob_v6_1_sfc';
const MAX_AGE = 48 * 3600000;
export type AerosolHour = { start: string; total: number; dust: number | null };
type Atmosphere = {
  source: AtmosphereSource;
  hours: AerosolHour[];
  raw: { run: string; csv: string } | null;
};

/** Fixed FMI dataset only; never follow URLs supplied by the remote catalog. */
export function latestSilamRun(xml: string, now: Date) {
  const paths = [
    ...xml.matchAll(
      /urlPath="(silam_glob_v6_1_sfc\/runs\/silam_glob_v6_1_sfc_RUN_(\d{4}-\d{2}-\d{2}T\d{2}:00:00Z))"/g,
    ),
  ]
    .map((m) => ({ path: m[1], issuedAt: m[2], stamp: Date.parse(m[2]) }))
    .filter(
      (r) =>
        Number.isFinite(r.stamp) &&
        r.stamp <= now.getTime() &&
        now.getTime() - r.stamp <= MAX_AGE,
    )
    .sort((a, b) => b.stamp - a.stamp);
  if (!paths.length) throw Error('No fresh SILAM run');
  return paths[0];
}

export function parseSilamCsv(
  csv: string,
  config: ForecastConfig,
  issuedAt: string,
) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2 || lines.length > 220) throw Error('Invalid SILAM rows');
  const columns = lines[0].split(',');
  const indexes = [
    'time',
    'latitude[unit="degrees_north"]',
    'longitude[unit="degrees_east"]',
    'ocd_part_w550[unit=""]',
    'ocd_dust_w550[unit=""]',
  ].map((c) => columns.indexOf(c));
  if (indexes.some((i) => i < 0)) throw Error('Invalid SILAM units');
  const hours: AerosolHour[] = [];
  let previous = 0,
    latitude: number | null = null,
    longitude: number | null = null;
  const run = Date.parse(issuedAt);
  for (const line of lines.slice(1)) {
    const values = line.split(',');
    if (values.length !== columns.length) throw Error('Invalid SILAM row');
    const [t, lat, lon, total, dust] = indexes.map((i) => values[i]);
    const end = Date.parse(t),
      y = Number(lat),
      x = Number(lon);
    if (
      !Number.isFinite(end) ||
      end % 3600000 !== 0 ||
      end <= previous ||
      end <= run ||
      end > run + 7 * 86400000
    )
      throw Error('Invalid SILAM time');
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(x) ||
      config.latitude === null ||
      config.longitude === null ||
      Math.abs(y - config.latitude) > 0.15 ||
      Math.abs(x - config.longitude) > 0.15 ||
      (latitude !== null && (latitude !== y || longitude !== x))
    )
      throw Error('SILAM point is not near the plant');
    previous = end;
    latitude = y;
    longitude = x;
    // time: mean in SILAM is the preceding output interval (user guide § output).
    // Do not bridge missing hours; the hourly global dataset has 168 end labels.
    const a = Number(total),
      d = Number(dust);
    if (total.trim() === '' || !Number.isFinite(a) || a < 0 || a > 10) continue;
    hours.push({
      start: new Date(end - 3600000).toISOString(),
      total: a,
      dust:
        dust.trim() !== '' && Number.isFinite(d) && d >= 0 && d <= a + 0.001
          ? d
          : null,
    });
  }
  if (!hours.length) throw Error('No SILAM aerosol data');
  return { hours, latitude, longitude };
}

async function fetchText(url: string, limit: number) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > limit)
    throw Error('SILAM unavailable');
  const value = await response.text();
  if (value.length > limit) throw Error('Oversized SILAM response');
  return value;
}

export async function fetchAtmosphere(
  config: ForecastConfig,
  now: Date,
): Promise<Atmosphere> {
  const empty: Atmosphere = {
    source: {
      status: 'unavailable',
      issuedAt: null,
      fetchedAt: null,
      latitude: null,
      longitude: null,
      hours: 0,
    },
    hours: [],
    raw: null,
  };
  if (config.latitude === null || config.longitude === null) return empty;
  const key = `forecast-atmosphere:silam-v1:${config.latitude.toFixed(4)}:${config.longitude.toFixed(4)}`;
  try {
    const result = await withCacheLock(
      key,
      async () => {
        const saved = await cacheRead<{ expires: number; value: Atmosphere }>(
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
          const run = latestSilamRun(
            await fetchText(
              ROOT + `catalog/${DATASET}/runs/catalog.xml`,
              150000,
            ),
            now,
          );
          const query = new URLSearchParams({
            var: 'ocd_part_w550,ocd_dust_w550',
            latitude: String(config.latitude),
            longitude: String(config.longitude),
            time_start: new Date(
              Math.floor(now.getTime() / 3600000) * 3600000,
            ).toISOString(),
            time_end: new Date(run.stamp + 7 * 86400000).toISOString(),
            accept: 'csv',
          });
          const csv = await fetchText(
            ROOT + 'ncss/grid/' + run.path + '?' + query,
            100000,
          );
          const parsed = parseSilamCsv(csv, config, run.issuedAt);
          const value: Atmosphere = {
            source: {
              status: 'ready',
              issuedAt: run.issuedAt,
              fetchedAt: now.toISOString(),
              latitude: parsed.latitude,
              longitude: parsed.longitude,
              hours: parsed.hours.length,
            },
            hours: parsed.hours,
            raw: { run: run.path, csv },
          };
          await cacheWrite(
            key,
            { expires: now.getTime() + 6 * 3600000, value },
            86400,
          );
          return value;
        } catch {
          // Cache failure briefly, too: an optional source must not trigger a retry storm.
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
