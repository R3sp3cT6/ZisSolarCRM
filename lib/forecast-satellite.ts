export type SatellitePoint = {
  slotTime: string;
  createdAt: string;
  receivedAt: string;
  latitude: number;
  longitude: number;
  ghi: number | null;
  diffuseFraction: number | null;
  qualityFlag: number;
  quality: 'good' | 'night' | 'rejected';
  cloudMask: number;
  url: string;
  sha256: string;
  raw?: { attributes: string; ascii: string };
};
export type SatelliteSource = {
  status: 'unconfigured' | 'unavailable' | 'ready';
  fetchedAt: string;
  points: SatellitePoint[];
  reason?: string;
};
/** LSA-207 PUM issue 3, table 4. Bad retrievals are never treated as zero sunlight. */
export function satelliteQuality(flag: number): SatellitePoint['quality'] {
  if (!Number.isInteger(flag) || flag < 0 || flag > 254 || (flag & 3) !== 1)
    return 'rejected';
  const method = (flag >> 5) & 7,
    cloud = (flag >> 2) & 7;
  if (method === 5) return 'night';
  return (method === 0 || method === 4) && cloud >= 1 && cloud <= 4
    ? 'good'
    : 'rejected';
}
export function parseSatellite(
  das: string,
  ascii: string,
  slotTime: string,
  latitude: number,
  longitude: number,
  receivedAt: string,
): Omit<SatellitePoint, 'url' | 'sha256'> {
  const block = (name: string) =>
    das.match(new RegExp('\\b' + name + ' \\{([\\s\\S]*?)\\n    \\}'))?.[1] ??
    '';
  if (
    !block('DSSF_TOT').includes('Float64 scale_factor 0.1;') ||
    !block('DSSF_TOT').includes('String units "W m-2";') ||
    !block('FRACTION_DIFFUSE').includes('Float64 scale_factor 0.01;') ||
    !block('DSSF_TOT').includes('Int16 _FillValue -1;') ||
    !block('time').includes(
      'seconds since ' + slotTime.replace('.000Z', 'Z'),
    ) ||
    !das.includes('String name "MDSSFTD";')
  )
    throw Error('Unexpected satellite metadata');
  const data = ascii.split('---------------------------------------------')[1];
  if (!data) throw Error('Invalid satellite response');
  const value = (name: string) => {
    const match = data.match(
      new RegExp(
        '(?:^|\\n)' +
          name.replaceAll('.', '\\.') +
          '\\[1\\](?:\\[1\\]\\[1\\])?\\s*\\n(?:\\[0\\]\\[0\\], )?(-?\\d+(?:\\.\\d+)?)',
      ),
    );
    if (!match) throw Error('Missing satellite value');
    return Number(match[1]);
  };
  const lat = value('DSSF_TOT.lat'),
    lon = value('DSSF_TOT.lon'),
    raw = value('DSSF_TOT.DSSF_TOT'),
    diffuse = value('FRACTION_DIFFUSE.FRACTION_DIFFUSE'),
    flag = value('quality_flag.quality_flag');
  if (
    Math.abs(lat - latitude) > 0.026 ||
    Math.abs(lon - longitude) > 0.026 ||
    value('DSSF_TOT.time') !== 0 ||
    value('quality_flag.time') !== 0 ||
    value('FRACTION_DIFFUSE.time') !== 0 ||
    Math.abs(value('quality_flag.lat') - lat) > 1e-5 ||
    Math.abs(value('quality_flag.lon') - lon) > 1e-5 ||
    Math.abs(value('FRACTION_DIFFUSE.lat') - lat) > 1e-5 ||
    Math.abs(value('FRACTION_DIFFUSE.lon') - lon) > 1e-5
  )
    throw Error('Unexpected satellite grid or time');
  const createdAt = das.match(/String date_created "([^"]+)"/)?.[1];
  if (
    !createdAt ||
    !Number.isFinite(Date.parse(createdAt)) ||
    Date.parse(createdAt) > Date.parse(receivedAt) ||
    Date.parse(slotTime) > Date.parse(receivedAt)
  )
    throw Error('Invalid satellite issue time');
  let quality = satelliteQuality(flag);
  if (
    raw < 0 ||
    raw > 15000 ||
    (quality === 'good' && (diffuse < 0 || diffuse > 100)) ||
    (quality === 'night' && raw !== 0)
  )
    quality = 'rejected';
  return {
    slotTime,
    createdAt,
    receivedAt,
    latitude: lat,
    longitude: lon,
    ghi: quality === 'rejected' ? null : raw * 0.1,
    diffuseFraction: diffuse >= 0 && diffuse <= 100 ? diffuse * 0.01 : null,
    qualityFlag: flag,
    quality,
    cloudMask: (flag >> 2) & 7,
  };
}
