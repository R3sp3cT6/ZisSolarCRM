import 'server-only';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ForecastConfig } from './forecast-model';
import { iconHours, type IconMean, type IconHour } from './forecast-icon';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import { localDate, slotsForDay } from './energy';
import { addDays } from './forecast-model';

const require = createRequire(import.meta.url);
const ROOT = 'https://opendata.dwd.de/weather/nwp/icon-eu/grib/';
type Handle = {
  getLong(k: string): number;
  getDouble(k: string): number;
  getString(k: string): string;
  getDoubleArray(k: string): number[];
  delete(): void;
};
type Decoder = {
  writeFile(p: string, v: Uint8Array): void;
  openGrib(p: string): Handle;
};
let decoder: Promise<Decoder> | undefined;
const codes = () =>
  (decoder ??= require('@meri-imperiumi/eccodes-wasm')
    .createEccodes()
    .catch((e: unknown) => {
      decoder = undefined;
      throw e;
    }));
export type IconSource = {
  status: 'ready' | 'unavailable';
  runAt: string | null;
  fetchedAt: string;
  latitude: number | null;
  longitude: number | null;
  hours: IconHour[];
  means: IconMean[];
  files: {
    url: string;
    sha256: string;
    field: string;
    lead: number;
    value: number;
  }[];
};
async function bytes(url: string, limit: number) {
  const r = await fetch(url, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok || Number(r.headers.get('content-length')) > limit)
    throw Error('ICON source unavailable');
  const reader = r.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('ICON response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export async function decodeIcon(
  raw: Uint8Array,
  c: ForecastConfig,
  stamp: string,
  lead: number,
  field: string,
) {
  const code = await codes();
  code.writeFile('/icon.grib', raw);
  const h = code.openGrib('/icon.grib');
  try {
    if (
      h.getString('gridType') !== 'regular_ll' ||
      h.getString('shortName') !== field ||
      h.getString('units') !== 'W m-2' ||
      h.getString('stepType') !== 'avg' ||
      h.getLong('dataDate') !== Number(stamp.slice(0, 8)) ||
      h.getLong('dataTime') !== Number(stamp.slice(8)) * 100 ||
      h.getLong('startStep') !== 0 ||
      h.getLong('endStep') !== lead ||
      h.getLong('iScansNegatively') !== 0 ||
      h.getLong('jScansPositively') !== 1 ||
      h.getLong('jPointsAreConsecutive') !== 0 ||
      h.getLong('alternativeRowScanning') !== 0
    )
      throw Error('Unexpected ICON metadata');
    const ni = h.getLong('Ni'),
      nj = h.getLong('Nj'),
      dy = h.getDouble('jDirectionIncrementInDegrees'),
      dx = h.getDouble('iDirectionIncrementInDegrees');
    const lat0 = h.getDouble('latitudeOfFirstGridPointInDegrees'),
      lon0 = h.getDouble('longitudeOfFirstGridPointInDegrees');
    if (
      ni * nj > 2000000 ||
      dx !== 0.0625 ||
      dy !== 0.0625 ||
      c.latitude === null ||
      c.longitude === null
    )
      throw Error('Unexpected ICON grid');
    const i = Math.round(((c.longitude - lon0 + 360) % 360) / dx),
      j = Math.round((c.latitude - lat0) / dy);
    if (i < 0 || i >= ni || j < 0 || j >= nj)
      throw Error('Plant outside ICON domain');
    const values = h.getDoubleArray('values'),
      value = values[j * ni + i];
    if (
      values.length !== ni * nj ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1600
    )
      throw Error('Invalid ICON point');
    return {
      value,
      latitude: lat0 + j * dy,
      longitude: ((lon0 + i * dx + 180) % 360) - 180,
    };
  } finally {
    h.delete();
    code.writeFile('/icon.grib', new Uint8Array());
  }
}
export async function fetchIcon(
  c: ForecastConfig,
  now = new Date(),
): Promise<IconSource> {
  const empty: IconSource = {
    status: 'unavailable',
    runAt: null,
    fetchedAt: now.toISOString(),
    latitude: null,
    longitude: null,
    hours: [],
    means: [],
    files: [],
  };
  if (c.latitude === null || c.longitude === null) return empty;
  const key = `forecast-icon:v1:${c.latitude}:${c.longitude}:${localDate(now)}`;
  const saved = await cacheRead<{ expires: number; source: IconSource }>(key);
  if (saved && saved.expires > now.getTime()) return saved.source;
  const result = await withCacheLock(
    key,
    async () => {
      const recent = await cacheRead<{ expires: number; source: IconSource }>(
        key,
      );
      if (recent && recent.expires > now.getTime()) return recent.source;
      try {
        const catalogs = await Promise.all(
          ['00', '06', '12', '18'].map(async (cycle) => {
            try {
              return (
                await bytes(ROOT + cycle + '/aswdir_s/', 100000)
              ).toString();
            } catch {
              return '';
            }
          }),
        );
        const runs = [
          ...new Set(
            catalogs.flatMap((xml) =>
              [...xml.matchAll(/single-level_(\d{10})_048_ASWDIR_S/g)].map(
                (m) => m[1],
              ),
            ),
          ),
        ]
          .map((stamp) => ({
            stamp,
            runAt: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8)}:00:00.000Z`,
          }))
          .filter(
            (r) =>
              Date.parse(r.runAt) <= now.getTime() &&
              now.getTime() - Date.parse(r.runAt) <= 18 * 3600000,
          )
          .sort((a, b) => b.stamp.localeCompare(a.stamp));
        if (!runs.length) throw Error('No fresh ICON run');
        const { stamp, runAt } = runs[0],
          run = Date.parse(runAt);
        // Retain preceding hourly midpoints for two recent Huawei power samples.
        const first = Math.max(
          0,
          Math.floor(
            (Math.floor(now.getTime() / 3600000) * 3600000 - run) / 3600000,
          ) - 2,
        );
        const last =
          (Date.parse(slotsForDay(addDays(localDate(now), 2))[0].start) - run) /
          3600000;
        if (last > 78 || last < first) throw Error('ICON range unavailable');
        const tasks = Array.from(
          { length: last - first + 1 },
          (_, i) => first + i,
        ).flatMap((lead) =>
          ['ASWDIR_S', 'ASWDIFD_S'].map((field) => ({ lead, field })),
        );
        const files: IconSource['files'] = [];
        let latitude: number | null = null,
          longitude: number | null = null,
          index = 0;
        const decodeBzip = require('seek-bzip').decode as (
          b: Buffer,
          sink: { writeByte(v: number): void },
        ) => void;
        await Promise.all(
          Array.from({ length: 3 }, async () => {
            while (index < tasks.length) {
              const { lead, field } = tasks[index++];
              const url =
                ROOT +
                stamp.slice(8) +
                '/' +
                field.toLowerCase() +
                '/icon-eu_europe_regular-lat-lon_single-level_' +
                stamp +
                '_' +
                String(lead).padStart(3, '0') +
                '_' +
                field +
                '.grib2.bz2';
              const packed = await bytes(url, 4000000),
                buffer = Buffer.alloc(4000000);
              let length = 0;
              decodeBzip(packed, {
                writeByte(v: number) {
                  if (length >= buffer.length)
                    throw Error('Oversized ICON GRIB');
                  buffer[length++] = v;
                },
              });
              const raw = buffer.subarray(0, length);
              const point = await decodeIcon(raw, c, stamp, lead, field);
              latitude = point.latitude;
              longitude = point.longitude;
              files.push({
                url,
                sha256: createHash('sha256').update(packed).digest('hex'),
                field,
                lead,
                value: point.value,
              });
            }
          }),
        );
        files.sort((a, b) => a.lead - b.lead || a.field.localeCompare(b.field));
        const means = Array.from({ length: last - first + 1 }, (_, i) => {
          const lead = first + i;
          return {
            lead,
            direct: files.find(
              (f) => f.lead === lead && f.field === 'ASWDIR_S',
            )!.value,
            diffuse: files.find(
              (f) => f.lead === lead && f.field === 'ASWDIFD_S',
            )!.value,
          };
        });
        const source: IconSource = {
          status: 'ready',
          runAt,
          fetchedAt: new Date().toISOString(),
          latitude,
          longitude,
          hours: iconHours(runAt, means),
          means,
          files,
        };
        await cacheWrite(
          key,
          { expires: now.getTime() + 3600000, source },
          86400,
        );
        return source;
      } catch (error) {
        console.warn(
          'ICON trial source unavailable:',
          error instanceof Error ? error.message : 'source failure',
        );
        await cacheWrite(
          key,
          { expires: now.getTime() + 300000, source: empty },
          600,
        );
        return empty;
      }
    },
    110,
  );
  return result.busy ? empty : result.value;
}
