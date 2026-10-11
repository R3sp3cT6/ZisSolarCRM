import 'server-only';
import {
  weatherConfigured,
  type ForecastConfig,
  type WeatherHour,
} from './forecast-model';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import {
  clearSkyIrradiance,
  cloudTransmission,
  hasCoordinates,
} from './forecast-solar';

export function parseForecastWeather(raw: unknown): WeatherHour[] {
  const body = raw as {
    utc_offset_seconds?: number;
    hourly?: Record<string, unknown>;
    hourly_units?: Record<string, string>;
  };
  const h = body?.hourly,
    u = body?.hourly_units;
  if (
    body?.utc_offset_seconds !== 0 ||
    !h ||
    u?.time !== 'unixtime' ||
    u.global_tilted_irradiance !== 'W/m²' ||
    u.temperature_2m !== '°C'
  )
    throw Error('Invalid weather units');
  const times = h.time,
    g = h.global_tilted_irradiance,
    t = h.temperature_2m,
    cloud = h.cloud_cover;
  if (
    !Array.isArray(times) ||
    !Array.isArray(g) ||
    !Array.isArray(t) ||
    times.length > 500 ||
    g.length !== times.length ||
    t.length !== times.length
  )
    throw Error('Invalid weather arrays');
  const result: WeatherHour[] = [],
    seen = new Set<number>();
  for (let i = 0; i < times.length; i++) {
    const end = times[i],
      radiation = g[i],
      temperature = t[i];
    if (
      typeof end !== 'number' ||
      !Number.isFinite(end) ||
      end < 1577836800 ||
      end > 4102444800 ||
      end % 3600 !== 0 ||
      seen.has(end)
    )
      throw Error('Invalid weather time');
    seen.add(end);
    if (
      typeof radiation !== 'number' ||
      !Number.isFinite(radiation) ||
      radiation < 0 ||
      radiation > 1800 ||
      typeof temperature !== 'number' ||
      !Number.isFinite(temperature) ||
      temperature < -80 ||
      temperature > 70
    )
      continue;
    const previous = t[i - 1],
      air =
        typeof previous === 'number' && Number.isFinite(previous)
          ? (previous + temperature) / 2
          : temperature;
    // Open-Meteo radiation at 11:00 represents 10:00–11:00, unlike our start-labelled archive.
    result.push({
      start: new Date((end - 3600) * 1000).toISOString(),
      irradiance: radiation,
      irradianceKind: 'gti',
      resolutionHours: 1,
      temperature: air,
      cloudCover:
        Array.isArray(cloud) &&
        typeof cloud[i] === 'number' &&
        Number.isFinite(cloud[i]) &&
        cloud[i] >= 0 &&
        cloud[i] <= 100
          ? cloud[i]
          : null,
    });
  }
  return result;
}
async function fetchOpenMeteo(config: ForecastConfig, key: string) {
  const query = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    tilt: String(config.tilt),
    azimuth: String(config.azimuth),
    hourly: 'global_tilted_irradiance,temperature_2m,cloud_cover',
    forecast_days: '9',
    timezone: 'GMT',
    timeformat: 'unixtime',
    models: 'best_match',
    apikey: key,
  });
  const response = await fetch(
    'https://customer-api.open-meteo.com/v1/forecast?' + query,
    { signal: AbortSignal.timeout(20000), cache: 'no-store' },
  );
  if (!response.ok) throw Error('Weather provider failed');
  if (Number(response.headers.get('content-length')) > 1500000)
    throw Error('Unexpected weather response');
  const text = await response.text();
  if (text.length > 1500000) throw Error('Unexpected weather response');
  const raw: unknown = JSON.parse(text),
    hours = parseForecastWeather(raw);
  if (!hours.length) throw Error('Weather data unavailable');
  return {
    status: 'ready' as const,
    hours,
    fetchedAt: new Date().toISOString(),
    issuedAt: null,
    provider: 'open-meteo' as const,
    raw,
  };
}

type MetBody = {
  properties?: {
    meta?: { updated_at?: string; units?: Record<string, string> };
    timeseries?: {
      time: string;
      data?: { instant?: { details?: Record<string, unknown> } };
    }[];
  };
};
export function parseMetForecast(
  raw: unknown,
  config: ForecastConfig,
  now = new Date(),
): WeatherHour[] {
  const body = raw as MetBody,
    meta = body?.properties?.meta,
    rows = body?.properties?.timeseries;
  const issued = Date.parse(meta?.updated_at ?? '');
  if (
    !hasCoordinates(config) ||
    meta?.units?.air_temperature !== 'celsius' ||
    meta.units.cloud_area_fraction !== '%' ||
    !Number.isFinite(issued) ||
    issued > now.getTime() + 300000 ||
    now.getTime() - issued > 86400000 ||
    !Array.isArray(rows) ||
    rows.length < 2 ||
    rows.length > 500
  )
    throw Error('Invalid MET weather');
  const samples = rows.map((row) => {
    const stamp = Date.parse(row.time),
      details = row.data?.instant?.details;
    const cloud = details?.cloud_area_fraction,
      air = details?.air_temperature;
    if (!Number.isFinite(stamp) || stamp % 3600000 !== 0)
      throw Error('Invalid MET time');
    return {
      stamp,
      cloud,
      air,
      valid:
        typeof cloud === 'number' &&
        Number.isFinite(cloud) &&
        cloud >= 0 &&
        cloud <= 100 &&
        typeof air === 'number' &&
        Number.isFinite(air) &&
        air >= -80 &&
        air <= 70,
    };
  });
  const result: WeatherHour[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i],
      b = samples[i + 1],
      span = (b.stamp - a.stamp) / 3600000;
    if (span <= 0) throw Error('Unordered MET times');
    if (span > 6 || !a.valid || !b.valid) continue;
    // MET instant values have 1h or 6h spacing. Interpolate only bounded intervals,
    // retain that source resolution, and never extrapolate beyond the last sample.
    for (let j = 0; j < span; j++) {
      const f = (j + 0.5) / span;
      const cloud =
        (a.cloud as number) + ((b.cloud as number) - (a.cloud as number)) * f;
      const temperature =
        (a.air as number) + ((b.air as number) - (a.air as number)) * f;
      const start = new Date(a.stamp + j * 3600000).toISOString();
      result.push({
        start,
        cloudCover: cloud,
        temperature,
        irradiance:
          clearSkyIrradiance(start, config)! * cloudTransmission(cloud),
        irradianceKind: 'estimated-ghi',
        resolutionHours: span,
      });
    }
  }
  return result;
}

type MetCache = {
  raw: unknown;
  fetchedAt: string;
  modified: string | null;
  expires: number;
};
async function fetchMet(config: ForecastConfig, now: Date) {
  const query = new URLSearchParams({
    lat: config.latitude!.toFixed(4),
    lon: config.longitude!.toFixed(4),
  });
  const key = 'forecast-weather:met:' + query;
  const result = await withCacheLock(
    key,
    async () => {
      const saved = await cacheRead<MetCache>(key);
      let value = saved;
      if (!saved || saved.expires <= now.getTime()) {
        const headers: Record<string, string> = {
          'User-Agent':
            'ZisSolarCRM/2.0 https://github.com/R3sp3cT6/ZisSolarCRM',
          Accept: 'application/json',
        };
        if (saved?.modified) headers['If-Modified-Since'] = saved.modified;
        const response = await fetch(
          'https://api.met.no/weatherapi/locationforecast/2.0/compact?' + query,
          { headers, signal: AbortSignal.timeout(15000), cache: 'no-store' },
        );
        const expires = Math.max(
          now.getTime() + 600000,
          Date.parse(response.headers.get('expires') ?? '') || 0,
        );
        if (response.status === 304 && saved) value = { ...saved, expires };
        else {
          if (!response.ok) throw Error('MET unavailable');
          if (Number(response.headers.get('content-length')) > 1500000)
            throw Error('Oversized MET response');
          const text = await response.text();
          if (text.length > 1500000) throw Error('Oversized MET response');
          const raw: unknown = JSON.parse(text);
          if (!parseMetForecast(raw, config, now).length)
            throw Error('Empty MET response');
          value = {
            raw,
            fetchedAt: now.toISOString(),
            expires,
            modified: response.headers.get('last-modified'),
          };
        }
        await cacheWrite(key, value, 86400);
      }
      if (!value) throw Error('MET unavailable');
      const hours = parseMetForecast(value.raw, config, now);
      return {
        status: 'ready' as const,
        hours,
        raw: value.raw,
        fetchedAt: value.fetchedAt,
        issuedAt: (value.raw as MetBody).properties!.meta!.updated_at!,
        provider: 'met-norway' as const,
      };
    },
    30,
  );
  if (result.busy) throw Error('Weather fetch in progress');
  return result.value;
}

export async function fetchForecastWeather(
  config: ForecastConfig,
  now = new Date(),
) {
  const empty = {
    hours: [] as WeatherHour[],
    fetchedAt: null,
    issuedAt: null,
    raw: null,
    provider: null,
  };
  if (!hasCoordinates(config))
    return { ...empty, status: 'missing-settings' as const };
  const key = process.env.OPEN_METEO_API_KEY;
  if (key && weatherConfigured(config)) {
    try {
      return await fetchOpenMeteo(config, key);
    } catch {
      /* MET is an explicitly labelled alternative. */
    }
  }
  try {
    return await fetchMet(config, now);
  } catch {
    return { ...empty, status: 'failed' as const };
  }
}
