import type { ForecastConfig } from './forecast-model';
import { satelliteQuality } from './forecast-satellite';
import {
  instantClearSky,
  satelliteScanOffset,
} from './forecast-satellite-nowcast';

export type SatelliteGrid = {
  slotTime: string;
  createdAt: string;
  receivedAt: string;
  latitudes: number[];
  longitudes: number[];
  csi: (number | null)[][];
};
export type MotionVector = {
  dx: number;
  dy: number;
  correlation: number;
  mse: number;
  pairs: number;
};
export type SatelliteMotion = {
  status: 'ready' | 'missing' | 'stale' | 'unresolved' | 'inconsistent';
  slotTimes: string[];
  dx?: number;
  dy?: number;
  confidence?: number;
  observedAt?: string;
  grid?: SatelliteGrid;
};

/** Fixed regional MDSSFTD subset around Resen. Validate dimensions, coordinates,
 * time, units and quality before using source data; land fill values stay null. */
export function parseSatelliteGrid(
  raw: {
    slotTime: string;
    createdAt: string;
    receivedAt: string;
    attributes: string;
    ascii: string;
  },
  config: ForecastConfig,
): SatelliteGrid {
  const { slotTime, createdAt, receivedAt, attributes, ascii } = raw;
  const block = attributes.match(/\bDSSF_TOT \{([\s\S]*?)\n    \}/)?.[1] ?? '';
  if (
    !block.includes('Float64 scale_factor 0.1;') ||
    !block.includes('String units "W m-2";') ||
    !block.includes('Int16 _FillValue -1;') ||
    !attributes.includes('String name "MDSSFTD";') ||
    !attributes.includes('seconds since ' + slotTime.replace('.000Z', 'Z')) ||
    ![slotTime, createdAt, receivedAt].every((t) =>
      Number.isFinite(Date.parse(t)),
    ) ||
    Date.parse(slotTime) > Date.parse(createdAt) ||
    Date.parse(createdAt) > Date.parse(receivedAt) ||
    !attributes.includes('String date_created "' + createdAt + '"')
  )
    throw Error('Invalid satellite grid metadata');
  const data = ascii.split('---------------------------------------------')[1];
  if (!data) throw Error('Missing satellite grid');
  const axis = (name: string, size: number) => {
    const line = data.match(
      new RegExp(
        name.replaceAll('.', '\\.') + '\\[' + size + '\\]\\s*\\n([^\\n]+)',
      ),
    )?.[1];
    const values = line?.split(',').map(Number) ?? [];
    if (values.length !== size || values.some((v) => !Number.isFinite(v)))
      throw Error('Invalid satellite grid axis');
    return values;
  };
  const latitudes = axis('DSSF_TOT.lat', 25),
    longitudes = axis('DSSF_TOT.lon', 33);
  for (const [name, values, first, step] of [
    ['lat', latitudes, 41.65, -0.05],
    ['lon', longitudes, 20.25, 0.05],
  ] as const) {
    const qualityAxis = axis('quality_flag.' + name, values.length);
    if (
      values.some(
        (v, i) =>
          Math.abs(v - (first + i * step)) > 0.0001 ||
          Math.abs(v - qualityAxis[i]) > 0.00001,
      )
    )
      throw Error('Unexpected satellite grid coordinates');
  }
  if (
    config.latitude === null ||
    config.longitude === null ||
    Math.abs(config.latitude - latitudes[12]) > 0.026 ||
    Math.abs(config.longitude - longitudes[16]) > 0.026
  )
    throw Error('Satellite grid does not cover plant');
  const matrix = (name: string) => {
    if (axis(name + '.time', 1)[0] !== 0) throw Error('Invalid grid time');
    const text = data
      .split(name + '.' + name + '[1][25][33]\n')[1]
      ?.split('\n' + name + '.time')[0];
    if (!text) throw Error('Invalid satellite grid dimensions');
    const lines = text.trim().split('\n');
    if (lines.length !== 25) throw Error('Missing satellite rows');
    return lines.map((line, y) => {
      const prefix = '[0][' + y + '], ';
      if (!line.startsWith(prefix)) throw Error('Invalid satellite row index');
      const values = line.slice(prefix.length).split(',').map(Number);
      if (values.length !== 33 || values.some((v) => !Number.isInteger(v)))
        throw Error('Invalid satellite pixels');
      return values;
    });
  };
  const ghi = matrix('DSSF_TOT'),
    quality = matrix('quality_flag');
  const csi = ghi.map((row, y) =>
    row.map((value, x) => {
      if (
        value < 0 ||
        value > 15000 ||
        satelliteQuality(quality[y][x]) !== 'good'
      )
        return null;
      const latitude = latitudes[y],
        longitude = longitudes[x];
      const at =
        Date.parse(slotTime) + satelliteScanOffset(latitude, longitude) * 1000;
      if (at > Date.parse(createdAt)) return null;
      const clear = instantClearSky(at, { ...config, latitude, longitude });
      return clear !== null && clear >= 50
        ? Math.min(1.5, (value * 0.1) / clear)
        : null;
    }),
  );
  return { slotTime, createdAt, receivedAt, latitudes, longitudes, csi };
}

/** Positive x is east; positive y is south. Compare newer[y,x] to
 * older[y-dy,x-dx]. Every displacement uses the same inner destination region. */
export function gridTranslation(
  older: SatelliteGrid,
  newer: SatelliteGrid,
): MotionVector | null {
  const candidates: (MotionVector & { deviation: number })[] = [];
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -6; dx <= 6; dx++) {
      let n = 0,
        a = 0,
        b = 0,
        aa = 0,
        bb = 0,
        ab = 0,
        error = 0;
      for (let y = 5; y < 20; y++)
        for (let x = 6; x < 27; x++) {
          const left = older.csi[y - dy]?.[x - dx],
            right = newer.csi[y]?.[x];
          if (
            left == null ||
            right == null ||
            !Number.isFinite(left) ||
            !Number.isFinite(right)
          )
            continue;
          n++;
          a += left;
          b += right;
          aa += left * left;
          bb += right * right;
          ab += left * right;
          error += (left - right) ** 2;
        }
      if (n < 150) continue;
      const va = Math.max(0, aa / n - (a / n) ** 2),
        vb = Math.max(0, bb / n - (b / n) ** 2);
      candidates.push({
        dx,
        dy,
        pairs: n,
        mse: error / n,
        deviation: Math.sqrt(Math.min(va, vb)),
        correlation:
          va * vb > 0 ? (ab / n - (a * b) / n ** 2) / Math.sqrt(va * vb) : 0,
      });
    }
  const zero = candidates.find((v) => v.dx === 0 && v.dy === 0);
  const best = candidates.sort(
    (a, b) => a.mse - b.mse || Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy),
  )[0];
  if (
    !best ||
    !zero ||
    best.deviation < 0.05 ||
    best.correlation < 0.65 ||
    ((best.dx !== 0 || best.dy !== 0) && best.mse > zero.mse * 0.85)
  )
    return null;
  const speed =
    Math.hypot(
      best.dx * 0.05 * 111320 * Math.cos((41.05 * Math.PI) / 180),
      best.dy * 0.05 * 111320,
    ) / 900;
  return speed <= 40 ? best : null;
}

export function satelliteMotion(
  grids: SatelliteGrid[],
  now: Date,
): SatelliteMotion {
  const empty: SatelliteMotion = { status: 'missing', slotTimes: [] };
  const time = now.getTime();
  const available = [
    ...new Map(
      grids
        .filter(
          (g) =>
            [g.slotTime, g.createdAt, g.receivedAt].every((t) =>
              Number.isFinite(Date.parse(t)),
            ) &&
            Date.parse(g.slotTime) <= Date.parse(g.createdAt) &&
            Date.parse(g.createdAt) <= Date.parse(g.receivedAt) &&
            Date.parse(g.receivedAt) <= time &&
            time - Date.parse(g.slotTime) <= 75 * 60000,
        )
        .map((g) => [g.slotTime, g]),
    ).values(),
  ]
    .sort((a, b) => a.slotTime.localeCompare(b.slotTime))
    .slice(-3);
  if (available.length < 3) return empty;
  const [a, b, c] = available,
    slots = available.map((g) => g.slotTime);
  if (
    Date.parse(b.slotTime) - Date.parse(a.slotTime) !== 900000 ||
    Date.parse(c.slotTime) - Date.parse(b.slotTime) !== 900000 ||
    time - Date.parse(c.slotTime) > 45 * 60000
  )
    return { status: 'stale', slotTimes: slots };
  const first = gridTranslation(a, b),
    second = gridTranslation(b, c);
  if (!first || !second) return { status: 'unresolved', slotTimes: slots };
  const difference = Math.hypot(first.dx - second.dx, first.dy - second.dy);
  if (difference > 2.5) return { status: 'inconsistent', slotTimes: slots };
  const observedAt =
    Date.parse(c.slotTime) +
    satelliteScanOffset(c.latitudes[12], c.longitudes[16]) * 1000;
  if (observedAt > time || observedAt > Date.parse(c.createdAt))
    return { status: 'stale', slotTimes: slots };
  return {
    status: 'ready',
    slotTimes: slots,
    grid: c,
    dx: first.dx * 0.3 + second.dx * 0.7,
    dy: first.dy * 0.3 + second.dy * 0.7,
    confidence:
      Math.max(
        0,
        Math.min(
          0.8,
          ((Math.min(first.correlation, second.correlation) - 0.65) / 0.35) *
            0.8,
        ),
      ) *
      (1 - difference / 5),
    observedAt: new Date(observedAt).toISOString(),
  };
}

/** Backward advection in the latest observed field. No edge extrapolation, no
 * filling masked lake/bad-quality pixels, and no target-time observation. */
export function advectedIndex(
  state: SatelliteMotion,
  at: number,
  persistence: number,
): { csi: number; weight: number } {
  const fallback = { csi: persistence, weight: 0 };
  if (
    state.status !== 'ready' ||
    !state.grid ||
    !state.observedAt ||
    state.dx === undefined ||
    state.dy === undefined
  )
    return fallback;
  const lead = (at - Date.parse(state.observedAt)) / 900000;
  if (!Number.isFinite(lead) || lead < 0 || lead > 8) return fallback;
  const x = 16 - state.dx * lead,
    y = 12 - state.dy * lead,
    xi = Math.floor(x),
    yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= 32 || yi >= 24) return fallback;
  let csi = 0;
  for (let j = 0; j <= 1; j++)
    for (let i = 0; i <= 1; i++) {
      const weight = (i ? x - xi : 1 - x + xi) * (j ? y - yi : 1 - y + yi);
      if (weight <= 1e-10) continue;
      const value = state.grid.csi[yi + j]?.[xi + i];
      if (value == null || !Number.isFinite(value)) return fallback;
      csi += weight * value;
    }
  const weight = state.confidence ?? 0;
  return {
    csi: persistence * (1 - weight) + Math.min(1.5, Math.max(0, csi)) * weight,
    weight,
  };
}
