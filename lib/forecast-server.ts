import 'server-only';
import { db } from '../db/index';
import { getUser, authLimit, sameOrigin } from './auth';
import { isAdmin } from './roles';
import { RequestError, readJson } from './request-security';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import { secretMatches } from './password';
import { localDate, localHour, slotsForDay } from './energy';
import {
  FORECAST_VERSION,
  addDays,
  defaultForecastConfig,
  validateForecastConfig,
  makeForecast,
  type ForecastConfig,
  type ForecastPayload,
  type ForecastPrice,
  type ForecastReading,
} from './forecast-model';
import { fetchForecastWeather } from './forecast-weather';
import { fetchGridOutages } from './grid-outages-server';
import { makeAvailabilityCandidate } from './forecast-availability';
import { readContracts } from './contracts-server';
import { contractFor, contractScheduleVersion } from './contracts';
import { revalueForecast } from './forecast-model';
import { loadHourlyCalibration } from './forecast-hourly-calibration-server';

export type ForecastView = {
  owner: string;
  config: ForecastConfig;
  forecast: ForecastPayload | null;
};
const key = (owner: string) => 'forecast:' + owner;
const response = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
async function loadConfig(owner: string) {
  const row = await db()
    .prepare('SELECT config FROM forecast_settings WHERE owner=?')
    .bind(owner)
    .first<{ config: ForecastConfig }>();
  return row?.config ?? defaultForecastConfig();
}
export async function readForecast(owner: string): Promise<ForecastView> {
  const contracts = await readContracts();
  const priced = (view: ForecastView): ForecastView => ({
    ...view,
    forecast: view.forecast ? revalueForecast(view.forecast, contracts) : null,
  });
  try {
    const cached = await cacheRead<ForecastView>(key(owner));
    if (cached?.owner === owner) return priced(cached);
  } catch {
    /* SQL remains a fallback when Redis is unavailable. */
  }
  const [config, run] = await Promise.all([
    loadConfig(owner),
    db()
      .prepare(
        'SELECT payload FROM forecast_runs WHERE owner=? ORDER BY issued_at DESC LIMIT 1',
      )
      .bind(owner)
      .first<{ payload: ForecastPayload }>(),
  ]);
  const view = { owner, config, forecast: run?.payload ?? null };
  try {
    await cacheWrite(key(owner), view, 7 * 86400);
  } catch {}
  return priced(view);
}
async function prospectiveScore(owner: string, now: Date) {
  // Aggregate in SQL instead of transferring hundreds of full forecast snapshots.
  return (
    (await db()
      .prepare(`WITH predictions AS (
 SELECT DISTINCT ON (h.value->>'start') h.value->>'start' AS start,(h.value->>'memo')::double precision AS predicted
 FROM forecast_runs r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d(value)
 CROSS JOIN LATERAL jsonb_array_elements(d.value->'hours') h(value)
 WHERE r.owner=? AND r.model_version=? AND r.issued_at>=?::timestamptz
 AND h.value->>'priceSource'='forecast' AND (h.value->>'start')::timestamptz>r.issued_at
 ORDER BY h.value->>'start',r.issued_at ASC
 ) SELECT count(*)::integer AS hours,avg(abs(predicted-p.eur_cents/100.0))::double precision AS mae
 FROM predictions f JOIN prices p ON p.start=f.start WHERE p.start<?`)
      .bind(
        owner,
        FORECAST_VERSION,
        addDays(localDate(now), -60),
        new Date(Math.floor(now.getTime() / 3600000) * 3600000).toISOString(),
      )
      .first<{ hours: number; mae: number | null }>()) ?? {
      hours: 0,
      mae: null,
    }
  );
}
async function productionScore(
  owner: string,
  now: Date,
  configVersion: string,
) {
  // First frozen prediction for each delivery hour; only completed measured hours.
  return (
    (await db()
      .prepare(`WITH predictions AS (
 SELECT DISTINCT ON (h.value->>'start') h.value->>'start' AS start,
 (h.value->>'productionKwh')::double precision AS predicted,
 COALESCE(h.value->>'baseProductionKwh',h.value->>'productionKwh')::double precision AS baseline
 FROM forecast_runs r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d(value)
 CROSS JOIN LATERAL jsonb_array_elements(d.value->'hours') h(value)
 WHERE r.owner=? AND r.model_version=? AND r.issued_at>=?::timestamptz
 AND h.value->>'productionSource'='weather-history'
 AND h.value->'weather'->>'irradianceKind'='modeled-ghi'
 AND r.payload->'config'->>'version'=?
 AND ((h.value->>'start')::timestamptz AT TIME ZONE 'Europe/Skopje')::date =
     (r.issued_at AT TIME ZONE 'Europe/Skopje')::date+1
 AND h.value->>'productionKwh' IS NOT NULL AND (h.value->>'start')::timestamptz>r.issued_at
 ORDER BY h.value->>'start',r.issued_at ASC
 ) SELECT count(*)::integer AS hours,
 avg(abs(f.predicted-r.production_kwh))::double precision AS mae,
 avg(f.predicted-r.production_kwh)::double precision AS bias,
 (100.0*sum(abs(f.predicted-r.production_kwh))/NULLIF(sum(r.production_kwh),0))::double precision AS wape,
 (100.0*sum(abs(f.baseline-r.production_kwh))/NULLIF(sum(r.production_kwh),0))::double precision AS "baselineWape"
 FROM predictions f JOIN readings r ON r.start=f.start AND r.owner=?
 WHERE r.production_kwh IS NOT NULL AND r.start<? AND (r.production_kwh>0 OR f.predicted>0)`)
      .bind(
        owner,
        FORECAST_VERSION,
        addDays(localDate(now), -60),
        configVersion,
        owner,
        new Date(Math.floor(now.getTime() / 3600000) * 3600000).toISOString(),
      )
      .first<{
        hours: number;
        mae: number | null;
        bias: number | null;
        wape: number | null;
        baselineWape: number | null;
      }>()) ?? {
      hours: 0,
      mae: null,
      bias: null,
      wape: null,
      baselineWape: null,
    }
  );
}
export async function runForecast(owner: string, now = new Date()) {
  const result = await withCacheLock(
    key(owner),
    async () => {
      const config = await loadConfig(owner),
        today = localDate(now);
      const contracts = await readContracts();
      // SQL uniqueness also deduplicates retries when Redis is unavailable or a lease expires.
      const runKey =
        FORECAST_VERSION +
        ':hourly-wape-v1:cf-bounds-v2:' +
        config.version +
        ':' +
        contractScheduleVersion(contracts) +
        ':' +
        Math.floor(now.getTime() / 1800000);
      const existing = await db()
        .prepare(
          'SELECT payload FROM forecast_runs WHERE owner=? AND run_key=?',
        )
        .bind(owner, runKey)
        .first<{ payload: ForecastPayload }>();
      if (existing) {
        const view = { owner, config, forecast: existing.payload };
        await cacheWrite(key(owner), view, 7 * 86400);
        return view;
      }
      const [
        priceResult,
        readingResult,
        liveScore,
        weather,
        measuredScore,
        hourly,
        gridOutages,
      ] = await Promise.all([
        db()
          .prepare(
            'SELECT start,eur_cents,fetched_at FROM prices WHERE start>=? AND start<? ORDER BY start',
          )
          .bind(
            slotsForDay(addDays(today, -180))[0].start,
            slotsForDay(addDays(today, 8))[0].start,
          )
          .all<ForecastPrice>(),
        db()
          .prepare(
            'SELECT start,production_kwh,export_kwh FROM readings WHERE owner=? AND start>=? AND start<? ORDER BY start',
          )
          .bind(
            owner,
            slotsForDay(addDays(today, -45))[0].start,
            slotsForDay(today)[0].start,
          )
          .all<ForecastReading>(),
        prospectiveScore(owner, now),
        fetchForecastWeather(config, now),
        productionScore(owner, now, config.version),
        loadHourlyCalibration(owner, config, now),
        fetchGridOutages(),
      ]);
      const prices = priceResult.results,
        readings = readingResult.results;
      const calculated = makeForecast({
        prices,
        readings,
        config,
        weather: weather.hours,
        contracts,
        now,
        hourlyCalibration: hourly.calibration,
      });
      const warnings: string[] = [];
      if (
        calculated.days.some((d) =>
          d.hours.some((h) => h.weather?.irradianceKind === 'estimated-ghi'),
        )
      )
        warnings.push('estimated-radiation');
      if (
        calculated.days.some((d) =>
          d.hours.some((h) => h.weather?.irradianceKind === 'modeled-ghi'),
        )
      )
        warnings.push('modeled-radiation');
      if (
        calculated.days.some((d) =>
          d.hours.some((h) => (h.weather?.resolutionHours ?? 0) > 1),
        )
      )
        warnings.push('interpolated-weather');
      if (
        calculated.days.some((d) =>
          d.hours.some((h) => h.productionSource === 'history'),
        )
      )
        warnings.push('history-production');
      if (
        calculated.days.some((d) =>
          d.hours.some((h) => h.productionSource === 'missing'),
        )
      )
        warnings.push('missing-production');
      if (calculated.exportRatio === null) warnings.push('missing-export');
      if (calculated.days.some((d) => d.meanPrice === null))
        warnings.push('missing-prices');
      const payload: ForecastPayload = {
        id: crypto.randomUUID(),
        issuedAt: now.toISOString(),
        version: FORECAST_VERSION,
        contract: contractFor(calculated.days[0].date, contracts),
        contracts,
        config,
        ...calculated,
        weather: {
          status: weather.status,
          fetchedAt: weather.fetchedAt,
          hours: weather.hours.length,
          provider: weather.provider,
          issuedAt: weather.issuedAt,
          atmosphere: weather.atmosphere,
          radiation: weather.radiation,
        },
        history: {
          priceHours: prices.length,
          readingHours: readings.length,
          latestReading: readings.at(-1)?.start ?? null,
        },
        liveScore,
        productionScore: measuredScore,
        hourlyCalibration: hourly.calibration,
        warnings,
      };
      const inputs = {
        contracts,
        retrievedAt: new Date().toISOString(),
        prices,
        readings,
        weather: weather.raw,
        atmosphere: weather.atmosphereRaw,
        atmosphereSource: weather.atmosphere,
        radiation: weather.radiationRaw,
        radiationSource: weather.radiation,
        calibration: calculated.calibration,
        hourlyCalibration: hourly.calibration,
        hourlyCalibrationInputs: hourly.inputs,
        // Archive only until this plant's feeder and operating policy are confirmed.
        gridOutages,
        availabilityCandidate:
          owner === process.env.FUSIONSOLAR_OWNER
            ? makeAvailabilityCandidate(payload, prices)
            : null,
        weatherModel:
          weather.provider === 'met-norway'
            ? 'MET Norway complete; NOAA GFS surface DSWRF preferred (CF interval bounds, de-averaged 3h, clear-sky hourly allocation); fallback Haurwitz + Kasten-Czeplak cloud/fog + FMI SILAM relative Solis; no repeated atmospheric attenuation on GFS; NOCT + Faiman; 14 recent complete daylight days for solar calibration'
            : 'Open-Meteo best_match GTI',
        config,
        backtest:
          'Latest revised historical prices; fixed model, chronological cutoffs; not an as-issued weather backtest.',
      };
      await db()
        .prepare(
          'INSERT INTO forecast_runs(id,owner,run_key,issued_at,model_version,payload,inputs) VALUES (?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT(owner,run_key) DO NOTHING',
        )
        .bind(
          payload.id,
          owner,
          runKey,
          payload.issuedAt,
          FORECAST_VERSION,
          JSON.stringify(payload),
          JSON.stringify(inputs),
        )
        .run();
      // Read the winning record in case a second worker completed after a Redis lease expired.
      const saved = await db()
        .prepare(
          'SELECT payload FROM forecast_runs WHERE owner=? AND run_key=?',
        )
        .bind(owner, runKey)
        .first<{ payload: ForecastPayload }>();
      if (!saved) throw Error('Forecast persistence failed');
      const view = { owner, config, forecast: saved.payload };
      await cacheWrite(key(owner), view, 7 * 86400);
      return view;
    },
    120,
  );
  if (result.busy)
    throw new RequestError(
      409,
      'Прогнозата веќе се пресметува. Обидете се повторно.',
    );
  return result.value;
}
export async function handleForecastGet() {
  try {
    const user = await getUser();
    if (!user)
      return response({ error: 'Најавете се за пристап до податоците.' }, 401);
    const { owner: _, ...view } = await readForecast(user.plantOwner);
    return response(view);
  } catch {
    return response({ error: 'Прогнозата моментално не е достапна.' }, 503);
  }
}
export async function handleForecastPost(request: Request) {
  try {
    const user = await getUser(true);
    if (!user)
      return response({ error: 'Најавете се за пристап до податоците.' }, 401);
    if (!isAdmin(user) || !sameOrigin(request))
      return response(
        { error: 'Потребен е администраторски пристап од оваа страница.' },
        403,
      );
    const body = await readJson(request, 4096);
    if (body.action !== 'refresh' && body.action !== 'configure')
      throw new RequestError(400, 'Непозната операција.');
    let config: ForecastConfig | undefined;
    if (body.action === 'configure') {
      if (
        !body.config ||
        typeof body.config !== 'object' ||
        Array.isArray(body.config)
      )
        throw new RequestError(400, 'Невалидни поставки.');
      try {
        config = validateForecastConfig(body.config);
      } catch {
        throw new RequestError(
          400,
          'Проверете ги вредностите во поставките на прогнозата.',
        );
      }
    }
    if (!(await authLimit('forecast:' + user.userId, 8)))
      return response({ error: 'Премногу барања. Обидете се подоцна.' }, 429);
    if (config) {
      const next = config;
      const saved = await withCacheLock(
        key(user.plantOwner),
        async () => {
          await db()
            .prepare(
              'INSERT INTO forecast_settings(owner,config) VALUES (?,?::jsonb) ON CONFLICT(owner) DO UPDATE SET config=excluded.config,updated_at=now()',
            )
            .bind(user.plantOwner, JSON.stringify(next))
            .run();
          // Invalidate the full view; old runs retain their own immutable configuration.
          await cacheWrite(
            key(user.plantOwner),
            { owner: user.plantOwner, config: next, forecast: null },
            7 * 86400,
          );
        },
        120,
      );
      if (saved.busy)
        throw new RequestError(
          409,
          'Прогнозата веќе се пресметува. Обидете се повторно.',
        );
    }
    const { owner: _, ...view } = await runForecast(user.plantOwner);
    return response(view);
  } catch (error) {
    if (error instanceof RequestError)
      return response({ error: error.message }, error.status);
    return response(
      {
        error:
          'Пресметката не успеа. Последната зачувана прогноза останува достапна.',
      },
      503,
    );
  }
}
export function forecastCronTime(now: Date) {
  return [8, 12, 18].includes(localHour(now.toISOString()));
}
export async function handleForecastCron(request: Request, now = new Date()) {
  if (
    !secretMatches(
      request.headers.get('authorization'),
      process.env.CRON_SECRET ? 'Bearer ' + process.env.CRON_SECRET : undefined,
    )
  )
    return response({ error: 'Unauthorized' }, 401);
  if (!forecastCronTime(now)) return response({ skipped: true });
  const owner = process.env.FUSIONSOLAR_OWNER;
  if (!owner) return response({ error: 'Unconfigured plant' }, 503);
  try {
    const view = await runForecast(owner, now);
    return response({ ok: true, issuedAt: view.forecast?.issuedAt });
  } catch {
    return response({ error: 'Forecast generation failed' }, 503);
  }
}
