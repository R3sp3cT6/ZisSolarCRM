import 'server-only';
import {
  weatherConfigured,
  type ForecastConfig,
  type WeatherHour,
  type AtmosphereSource,
} from './forecast-model';
import { fetchAtmosphere, type AerosolHour } from './forecast-atmosphere';
import { fetchRadiation } from './forecast-radiation-server';
import type { RadiationHour } from './forecast-radiation';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import {
  clearSkyIrradiance,
  cloudTransmission,
  hasCoordinates,
  aerosolIrradianceFactor,
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
    atmosphere: {
      status: 'not-used',
      issuedAt: null,
      fetchedAt: null,
      latitude: null,
      longitude: null,
      hours: 0,
    } as AtmosphereSource,
    atmosphereRaw: null,
    radiation: undefined,
    radiationRaw: null,
    raw,
  };
}

type MetBody = {
  properties?: {
    meta?: { updated_at?: string; units?: Record<string, string> };
    timeseries?: {
      time: string;
      data?: {
        instant?: { details?: Record<string, unknown> };
        next_1_hours?: { details?: Record<string, unknown> };
        next_6_hours?: { details?: Record<string, unknown> };
      };
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
    const optional = (name: string, unit: string, min: number, max: number) => {
      const value = details?.[name];
      return meta.units?.[name] === unit &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max
        ? value
        : null;
    };
    const extra = {
      cloudLow: optional('cloud_area_fraction_low', '%', 0, 100),
      cloudMid: optional('cloud_area_fraction_medium', '%', 0, 100),
      cloudHigh: optional('cloud_area_fraction_high', '%', 0, 100),
      fogCover: optional('fog_area_fraction', '%', 0, 100),
      humidity: optional('relative_humidity', '%', 0, 100),
      windSpeed: optional('wind_speed', 'm/s', 0, 100),
    };
    const rain = (span: 1 | 6) => {
      const value =
        row.data?.[span === 1 ? 'next_1_hours' : 'next_6_hours']?.details
          ?.precipitation_amount;
      return meta.units?.precipitation_amount === 'mm' &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1000
        ? value
        : null;
    };
    return {
      stamp,
      cloud,
      air,
      extra,
      rain1: rain(1),
      rain6: rain(6),
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
      const extra = Object.fromEntries(
        Object.entries(a.extra).map(([name, value]) => {
          const next = b.extra[name as keyof typeof b.extra];
          return [
            name,
            value === null || next === null ? null : value + (next - value) * f,
          ];
        }),
      ) as typeof a.extra;
      // Fog overlaps low cloud; use the larger cover as a rough proxy, never add
      // cloud layers or apply rainfall/humidity as a second cloud-loss percentage.
      const obscuration = Math.max(cloud, extra.fogCover ?? 0);
      const clear = clearSkyIrradiance(start, config)!;
      const rainSpan =
        span === 1 && a.rain1 !== null
          ? 1
          : span === 6 && a.rain6 !== null
            ? 6
            : null;
      result.push({
        start,
        ...extra,
        cloudCover: cloud,
        temperature,
        clearSkyIrradiance: clear,
        precipitationMm:
          rainSpan === 1 ? a.rain1 : rainSpan === 6 ? a.rain6! / 6 : null,
        precipitationResolutionHours: rainSpan,
        irradiance: clear * cloudTransmission(obscuration),
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
  const key = 'forecast-weather:met-complete-v1:' + query;
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
          'https://api.met.no/weatherapi/locationforecast/2.0/complete?' +
            query,
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
    atmosphere: {
      status: 'unavailable',
      issuedAt: null,
      fetchedAt: null,
      latitude: null,
      longitude: null,
      hours: 0,
    } as AtmosphereSource,
    atmosphereRaw: null,
    radiation: undefined,
    radiationRaw: null,
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
    const [weather, atmosphere, radiation] = await Promise.all([
      fetchMet(config, now),
      fetchAtmosphere(config, now),
      fetchRadiation(config, now),
    ]);
    return {
      ...weather,
      hours: applyRadiation(
        applyAtmosphere(weather.hours, atmosphere.hours, config),
        radiation.hours,
        radiation.source.issuedAt,
      ),
      atmosphere: atmosphere.source,
      atmosphereRaw: atmosphere.raw,
      radiation: radiation.source,
      radiationRaw: radiation.raw,
    };
  } catch {
    return { ...empty, status: 'failed' as const };
  }
}

export function applyRadiation(
  hours: WeatherHour[],
  radiation: RadiationHour[],
  issuedAt: string | null,
): WeatherHour[] {
  const byStart = new Map(radiation.map((h) => [h.start, h.irradiance]));
  return hours.map((h) => {
    const g = byStart.get(h.start);
    if (h.irradianceKind === 'gti' || g === undefined || !issuedAt) return h;
    // GFS surface flux already models atmospheric transmission. Do not multiply
    // it again by cloud fraction, fog or SILAM aerosol attenuation.
    return {
      ...h,
      irradiance: g,
      irradianceKind: 'modeled-ghi',
      radiationRunAt: issuedAt,
      resolutionHours: Math.max(3, h.resolutionHours),
      aerosolFactor: null,
    };
  });
}

export function applyAtmosphere(
  hours: WeatherHour[],
  aerosols: AerosolHour[],
  config: ForecastConfig,
): WeatherHour[] {
  const byTime = new Map(aerosols.map((a) => [a.start, a]));
  return hours.map((h) => {
    if (h.irradianceKind !== 'estimated-ghi') return h;
    const a = byTime.get(h.start);
    const factor = a ? aerosolIrradianceFactor(h.start, config, a.total) : null;
    return {
      ...h,
      aerosolOpticalDepth: a?.total ?? null,
      dustOpticalDepth: a?.dust ?? null,
      aerosolFactor: factor,
      irradiance: h.irradiance * (factor ?? 1),
    };
  });
}
