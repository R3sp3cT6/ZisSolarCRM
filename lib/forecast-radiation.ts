import type { ForecastConfig } from './forecast-model';
import { clearSkyIrradiance } from './forecast-solar';

export const GFS_RADIATION_FIELD =
  'Downward_Shortwave_Radiation_Flux_surface_Mixed_intervals_Average';
export type RadiationInterval = { start: string; end: string; value: number };
export type RadiationHour = { start: string; irradiance: number };

/** GFS mixes 0–3 and 0–6 h means inside successive six-hour blocks.
 * De-average overlapping intervals before allocating their energy to hours.
 * Clear-sky weights describe solar geometry, not sub-hour cloud movement. */
export function hourlyRadiation(
  intervals: RadiationInterval[],
  c: ForecastConfig,
): RadiationHour[] {
  const seen = new Set<string>(),
    hours = new Map<string, number>();
  for (const v of intervals) {
    const start = Date.parse(v.start),
      end = Date.parse(v.end),
      duration = (end - start) / 3600000;
    const key = start + ':' + end;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start % 3600000 ||
      ![3, 6].includes(duration) ||
      seen.has(key) ||
      !Number.isFinite(v.value) ||
      v.value < 0 ||
      v.value > 1800
    )
      throw Error('Invalid GFS radiation interval');
    seen.add(key);
  }
  for (const v of intervals) {
    let start = Date.parse(v.start),
      mean = v.value;
    const end = Date.parse(v.end);
    if (end - start === 6 * 3600000) {
      const first = intervals.find(
        (p) =>
          Date.parse(p.start) === start &&
          Date.parse(p.end) === start + 3 * 3600000,
      );
      if (!first) continue; // Cannot recover the latter half from a six-hour mean alone.
      mean = 2 * v.value - first.value;
      if (mean < -0.5 || mean > 1800) continue; // Allow only small GRIB packing noise.
      mean = Math.max(0, mean);
      start += 3 * 3600000;
    }
    const slots = Array.from({ length: 3 }, (_, i) =>
      new Date(start + i * 3600000).toISOString(),
    );
    const clear = slots.map((s) => clearSkyIrradiance(s, c));
    if (clear.some((g) => g === null)) continue;
    const total = clear.reduce<number>((s, g) => s + g!, 0);
    if (total === 0 && mean > 1) continue;
    const values = clear.map((g) => (total > 0 ? (mean * 3 * g!) / total : 0));
    if (values.some((g) => g > 1800)) continue;
    slots.forEach((s, i) => {
      if (hours.has(s)) throw Error('Overlapping GFS radiation blocks');
      hours.set(s, values[i]);
    });
  }
  return [...hours]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, irradiance]) => ({ start, irradiance }));
}

/** NCSS CSV timestamps are interval MIDPOINTS. Match against the actual CF
 * bounds from the same explicit run; never infer start/end from the label. */
export function parseGfsRadiation(
  csv: string,
  das: string,
  bounds: string,
  issuedAt: string,
  c: ForecastConfig,
) {
  const block = (name: string) =>
    das.match(new RegExp('(?:^|\\n)\\s*' + name + ' \\{([^}]+)\\}'))?.[1] ?? '';
  if (
    !block(GFS_RADIATION_FIELD).includes('String units "W.m-2"') ||
    !block(GFS_RADIATION_FIELD).includes(
      'String coordinates "reftime time lat lon ',
    ) ||
    !block('time').includes('String bounds "time_bounds"') ||
    !block('time_bounds').includes(
      'String units "Hour since ' + issuedAt.replace('.000Z', 'Z') + '"',
    )
  )
    throw Error('Changed GFS radiation metadata');
  const run = Date.parse(issuedAt),
    byMidpoint = new Map<number, { start: string; end: string }>();
  if (!Number.isFinite(run)) throw Error('Invalid GFS run time');
  for (const m of bounds.matchAll(/^\[\d+\],\s*([\d.]+),\s*([\d.]+)\s*$/gm)) {
    const a = Number(m[1]),
      b = Number(m[2]);
    if (!Number.isInteger(a) || a < 0 || b > 384 || ![3, 6].includes(b - a))
      throw Error('Changed GFS interval bounds');
    const midpoint = run + (a + b) * 1800000;
    if (byMidpoint.has(midpoint)) throw Error('Ambiguous GFS midpoint');
    byMidpoint.set(midpoint, {
      start: new Date(run + a * 3600000).toISOString(),
      end: new Date(run + b * 3600000).toISOString(),
    });
  }
  if (!byMidpoint.size) throw Error('Missing GFS bounds');
  const lines = csv.trim().split(/\r?\n/),
    columns = lines[0].split(',');
  if (lines.length < 3 || lines.length > 140)
    throw Error('Invalid GFS CSV size');
  const indexes = [
    'time',
    'latitude[unit="degrees_north"]',
    'longitude[unit="degrees_east"]',
    GFS_RADIATION_FIELD + '[unit="W.m-2"]',
  ].map((s) => columns.indexOf(s));
  if (indexes.some((i) => i < 0)) throw Error('Invalid GFS CSV units');
  const intervals: RadiationInterval[] = [];
  let latitude: number | null = null,
    longitude: number | null = null,
    previous = -Infinity;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells.length !== columns.length) throw Error('Invalid GFS CSV row');
    const [stamp, lat, lon, value] = indexes.map((i) => cells[i]);
    const time = Date.parse(stamp),
      y = Number(lat),
      x = Number(lon),
      g = Number(value),
      range = byMidpoint.get(time);
    if (
      !range ||
      time <= previous ||
      c.latitude === null ||
      c.longitude === null ||
      !lat.trim() ||
      !lon.trim() ||
      !Number.isFinite(y) ||
      !Number.isFinite(x) ||
      Math.abs(y - c.latitude) > 0.13 ||
      Math.abs(x - c.longitude) > 0.13 ||
      (latitude !== null && (latitude !== y || longitude !== x))
    )
      throw Error('Invalid GFS point/time');
    previous = time;
    latitude = y;
    longitude = x;
    if (!value.trim() || !Number.isFinite(g)) continue;
    intervals.push({ ...range, value: g });
  }
  const hours = hourlyRadiation(intervals, c);
  if (!hours.length) throw Error('Empty GFS radiation');
  return { hours, intervals, latitude, longitude };
}
