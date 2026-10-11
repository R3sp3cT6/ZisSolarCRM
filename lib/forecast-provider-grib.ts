import 'server-only';
import { createRequire } from 'node:module';
import type { ForecastConfig } from './forecast-model';

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
const require = createRequire(import.meta.url);
let decoder: Promise<Decoder> | undefined;
async function codes() {
  return (decoder ??= require('@meri-imperiumi/eccodes-wasm')
    .createEccodes()
    .catch((e: unknown) => {
      decoder = undefined;
      throw e;
    }));
}
export type SolarField = {
  startLead: number;
  endLead: number;
  value: number;
  latitude: number;
  longitude: number;
};
/** Only original regular-grid hourly solar fields; reject unexpected units,
 * scan layout, init time and missing/out-of-domain points before conversion. */
export async function decodeProviderSolar(
  raw: Uint8Array,
  config: ForecastConfig,
  runAt: string,
  provider: 'arpege' | 'gfs',
): Promise<SolarField> {
  const decoder = await codes();
  decoder.writeFile('/provider-solar.grib', raw);
  const h = decoder.openGrib('/provider-solar.grib');
  try {
    const stamp = runAt.replaceAll(/[-:TZ.]/g, '').slice(0, 10);
    const dx = provider === 'arpege' ? 0.1 : 0.25;
    if (
      h.getString('gridType') !== 'regular_ll' ||
      h.getString('shortName') !==
        (provider === 'arpege' ? 'ssrd' : 'sdswrf') ||
      h.getString('units') !==
        (provider === 'arpege' ? 'J m**-2' : 'W m**-2') ||
      h.getString('stepType') !== (provider === 'arpege' ? 'accum' : 'avg') ||
      h.getLong('dataDate') !== Number(stamp.slice(0, 8)) ||
      h.getLong('dataTime') !== Number(stamp.slice(8)) * 100 ||
      h.getLong('stepUnits') !== 1 ||
      h.getLong('scanningMode') !== 0 ||
      Math.abs(h.getDouble('iDirectionIncrementInDegrees') - dx) > 1e-9 ||
      Math.abs(h.getDouble('jDirectionIncrementInDegrees') - dx) > 1e-9 ||
      config.latitude === null ||
      config.longitude === null
    )
      throw Error('Unexpected solar GRIB metadata');
    const ni = h.getLong('Ni'),
      nj = h.getLong('Nj');
    if (ni * nj > 1100000 || ni < 1 || nj < 1)
      throw Error('Unexpected solar grid');
    const lat0 = h.getDouble('latitudeOfFirstGridPointInDegrees'),
      lon0 = h.getDouble('longitudeOfFirstGridPointInDegrees');
    const i = Math.round(((config.longitude - lon0 + 360) % 360) / dx),
      j = Math.round((lat0 - config.latitude) / dx);
    if (i < 0 || i >= ni || j < 0 || j >= nj)
      throw Error('Plant outside solar grid');
    const values = h.getDoubleArray('values'),
      value = values[j * ni + i];
    const startLead = h.getLong('startStep'),
      endLead = h.getLong('endStep');
    if (
      values.length !== ni * nj ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > (provider === 'arpege' ? 200000000 : 1800) ||
      startLead < 0 ||
      endLead <= startLead ||
      endLead > 48 ||
      (provider === 'arpege' && startLead !== 0)
    )
      throw Error('Invalid solar point');
    return {
      startLead,
      endLead,
      value,
      latitude: lat0 - j * dx,
      longitude: ((lon0 + i * dx + 180) % 360) - 180,
    };
  } finally {
    h.delete();
    decoder.writeFile('/provider-solar.grib', new Uint8Array());
  }
}

/** Parse original GRIB2 message framing and standard parameter descriptors.
 * Only downward solar messages are decoded; never read net radiation as GHI. */
export function* arpegeSolarMessages(raw: Buffer): Generator<Buffer> {
  let offset = 0;
  while (offset < raw.length) {
    if (
      offset + 20 > raw.length ||
      raw.toString('ascii', offset, offset + 4) !== 'GRIB' ||
      raw[offset + 7] !== 2
    )
      throw Error('Invalid GRIB package framing');
    const length = Number(raw.readBigUInt64BE(offset + 8)),
      end = offset + length;
    if (
      length < 20 ||
      length > 4000000 ||
      end > raw.length ||
      raw.toString('ascii', end - 4, end) !== '7777'
    )
      throw Error('Invalid GRIB message length');
    let section = offset + 16,
      solar = false;
    while (section < end - 4) {
      const size = raw.readUInt32BE(section),
        number = raw[section + 4];
      if (size < 5 || section + size > end - 4)
        throw Error('Invalid GRIB section');
      if (number === 4) {
        if (size < 11) throw Error('Invalid GRIB product definition');
        solar =
          raw[offset + 6] === 0 &&
          raw[section + 9] === 4 &&
          raw[section + 10] === 7;
      }
      section += size;
    }
    if (section !== end - 4) throw Error('Incomplete GRIB package');
    if (solar) yield raw.subarray(offset, end);
    offset = end;
  }
}
