import 'server-only';
import {
  weatherConfigured,
  type ForecastConfig,
  type WeatherHour,
} from './forecast-model';

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
      temperature: air,
      cloudCover:
        Array.isArray(cloud) && typeof cloud[i] === 'number' ? cloud[i] : null,
    });
  }
  return result;
}
export async function fetchForecastWeather(config: ForecastConfig) {
  if (!weatherConfigured(config))
    return {
      status: 'missing-settings' as const,
      hours: [],
      fetchedAt: null,
      raw: null,
    };
  const key = process.env.OPEN_METEO_API_KEY;
  if (!key)
    return {
      status: 'unconfigured' as const,
      hours: [],
      fetchedAt: null,
      raw: null,
    };
  try {
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
      raw,
    };
  } catch {
    return { status: 'failed' as const, hours: [], fetchedAt: null, raw: null };
  }
}
