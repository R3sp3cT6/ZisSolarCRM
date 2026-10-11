import 'server-only';
import { db } from '../db/index';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import { readForecast } from './forecast-server';
import { fetchForecastWeather } from './forecast-weather';
import { fetchIcon } from './forecast-icon-server';
import { weatherAdjustedEnergy } from './forecast-solar';
import { localDate, slotsForDay } from './energy';
import { addDays } from './forecast-model';
import {
  TRIAL_VERSION,
  makeSatelliteNowcast,
  type LiveObservation,
  type TrialRun,
  type TrialView,
  type TrialHour,
} from './forecast-trial';
import {
  flushTrialPending,
  saveSatellitePoints,
  type TrialContext,
} from './forecast-trial-live';
import { fetchSatellite } from './forecast-satellite-server';
import type { SatelliteSource } from './forecast-satellite';
import { getUser, authLimit, sameOrigin } from './auth';
import { isAdmin } from './roles';

const key = (owner: string) => 'forecast-trial:v34:' + owner;
const empty = (): TrialView => ({
  dayAhead: null,
  intraday: null,
  icon: { status: 'unavailable', runAt: null },
  satellite: {
    status: 'unconfigured',
    fetchedAt: new Date().toISOString(),
    points: [],
  },
  scores: [],
});
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
export async function trialScores(
  owner: string,
  configVersion: string,
): Promise<TrialView['scores']> {
  const day = await db()
    .prepare(`WITH predictions AS (
 SELECT DISTINCT ON (h->>'start') h,r.issued_at
 FROM forecast_trials r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'hours') h
 WHERE r.owner=? AND r.kind='day-ahead' AND r.model_version=? AND r.payload->>'configVersion'=?
 AND r.issued_at>now()-interval '60 days' AND (h->>'start')::timestamptz>r.issued_at
 AND ((h->>'start')::timestamptz AT TIME ZONE 'Europe/Skopje')::date=(r.issued_at AT TIME ZONE 'Europe/Skopje')::date+1
 AND h->>'baselineKwh' IS NOT NULL AND h->>'predictedKwh' IS NOT NULL
 ORDER BY h->>'start',r.issued_at
 ) SELECT 'day-ahead' AS kind,count(*)::integer AS hours,
 100*sum(abs((h->>'baselineKwh')::double precision-r.production_kwh))/NULLIF(sum(r.production_kwh),0) AS "baselineWape",
 100*sum(abs((h->>'predictedKwh')::double precision-r.production_kwh))/NULLIF(sum(r.production_kwh),0) AS "candidateWape"
 FROM predictions f JOIN readings r ON r.owner=? AND r.start=f.h->>'start'
 WHERE r.production_kwh IS NOT NULL AND (r.start::timestamptz+interval '1 hour')<=now()
 AND (r.production_kwh>0 OR (h->>'predictedKwh')::double precision>0 OR (h->>'baselineKwh')::double precision>0)`)
    .bind(owner, TRIAL_VERSION, configVersion, owner)
    .first<TrialView['scores'][number]>();
  const intraday = (
    await db()
      .prepare(`WITH candidates AS (
 SELECT DISTINCT ON (h->>'start',floor((h->>'leadMinutes')::double precision/30)) h,
 floor((h->>'leadMinutes')::double precision/30)::integer AS band
 FROM forecast_trials r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'hours') h
 WHERE r.owner=? AND r.kind='intraday' AND r.model_version=? AND r.payload->>'configVersion'=?
 AND r.issued_at>now()-interval '30 days' AND (h->>'start')::timestamptz>=r.issued_at
 ORDER BY h->>'start',floor((h->>'leadMinutes')::double precision/30),r.issued_at
 ), pairs AS (
 SELECT f.*, (b.payload->>'totalKwh')::double precision-(a.payload->>'totalKwh')::double precision AS actual
 FROM candidates f JOIN forecast_observations a ON a.owner=? AND a.measured_at=(h->>'start')::timestamptz
 JOIN forecast_observations b ON b.owner=a.owner AND b.measured_at=(h->>'end')::timestamptz
 WHERE (h->>'end')::timestamptz<=now() AND (a.payload->>'inverters')=(b.payload->>'inverters')
 AND (SELECT count(*) FROM forecast_observations o WHERE o.owner=a.owner AND o.measured_at BETWEEN a.measured_at AND b.measured_at)=4
 AND NOT EXISTS (SELECT 1 FROM forecast_observations o JOIN forecast_observations p ON p.owner=o.owner AND p.measured_at=o.measured_at-interval '5 minutes'
  WHERE o.owner=a.owner AND o.measured_at>a.measured_at AND o.measured_at<=b.measured_at
  AND ((o.payload->>'totalKwh')::double precision<(p.payload->>'totalKwh')::double precision OR o.payload->>'inverters'<>a.payload->>'inverters'))
 ) SELECT 'intraday-'||band AS kind,count(*)::integer AS hours,
 100*sum(abs((h->>'baselineKwh')::double precision-actual))/NULLIF(sum(actual),0) AS "baselineWape",
 100*sum(abs((h->>'predictedKwh')::double precision-actual))/NULLIF(sum(actual),0) AS "candidateWape"
 ,100*sum(abs((h->>'withoutSatelliteKwh')::double precision-actual))/NULLIF(sum(actual) FILTER (WHERE h->>'withoutSatelliteKwh' IS NOT NULL),0) AS "withoutSatelliteWape"
 ,count(*) FILTER (WHERE h->>'v32Kwh' IS NOT NULL)::integer AS "v32Intervals"
 ,100*sum(abs((h->>'v32Kwh')::double precision-actual))/NULLIF(sum(actual) FILTER (WHERE h->>'v32Kwh' IS NOT NULL),0) AS "v32Wape"
 ,100*sum(abs((h->>'predictedKwh')::double precision-actual)) FILTER (WHERE h->>'v32Kwh' IS NOT NULL)/NULLIF(sum(actual) FILTER (WHERE h->>'v32Kwh' IS NOT NULL),0) AS "v32CandidateWape"
 FROM pairs WHERE actual>=0 AND (actual>0 OR (h->>'predictedKwh')::double precision>0 OR (h->>'baselineKwh')::double precision>0 OR (h->>'withoutSatelliteKwh')::double precision>0 OR (h->>'v32Kwh')::double precision>0) GROUP BY band ORDER BY band`)
      .bind(owner, TRIAL_VERSION, configVersion, owner)
      .all<TrialView['scores'][number]>()
  ).results;
  return [...(day ? [day] : []), ...intraday];
}
export async function readTrial(owner: string): Promise<TrialView> {
  const saved = await cacheRead<{ owner: string; view: TrialView }>(key(owner));
  const cachedIntraday = await cacheRead<TrialRun>('trial-intraday:' + owner);
  const intraday =
    cachedIntraday?.version === TRIAL_VERSION ? cachedIntraday : null;
  const satellite = await cacheRead<SatelliteSource>(
    'trial-satellite:' + owner,
  );
  if (saved?.owner === owner)
    return {
      ...saved.view,
      satellite: satellite ?? saved.view.satellite,
      intraday: intraday ?? saved.view.intraday,
    };
  const record = await db()
    .prepare(
      "SELECT inputs->'view' AS view FROM forecast_trials WHERE owner=? AND kind='day-ahead' AND model_version=? ORDER BY issued_at DESC LIMIT 1",
    )
    .bind(owner, TRIAL_VERSION)
    .first<{ view: TrialView }>();
  const view = record?.view ?? empty();
  await cacheWrite(key(owner), { owner, view }, 7 * 86400);
  return {
    ...view,
    satellite: satellite ?? view.satellite,
    intraday: intraday ?? view.intraday,
  };
}
export async function runTrial(owner: string) {
  const locked = await withCacheLock(
    key(owner),
    async () => {
      const { forecast, config } = await readForecast(owner);
      if (!forecast || forecast.config.version !== config.version)
        throw Error('Refresh baseline first');
      const now = new Date();
      const recent = await cacheRead<{ owner: string; view: TrialView }>(
        key(owner),
      );
      if (
        recent?.owner === owner &&
        recent.view.dayAhead?.version === TRIAL_VERSION &&
        recent.view.dayAhead?.configVersion === config.version &&
        now.getTime() - Date.parse(recent.view.dayAhead.issuedAt) < 1800000
      )
        return recent.view;
      await flushTrialPending(owner);
      const [icon, weather, scores, satellite] = await Promise.all([
        fetchIcon(config, now),
        fetchForecastWeather(config, now),
        trialScores(owner, config.version),
        fetchSatellite(config, now),
      ]);
      await saveSatellitePoints(owner, satellite.points);
      await cacheWrite('trial-satellite:' + owner, satellite, 86400);
      if (icon.status !== 'ready') throw Error('ICON source unavailable');
      const byStart = new Map(icon.hours.map((h) => [h.start, h]));
      const official = new Map(
        forecast.days
          .flatMap((d) => d.hours)
          .map((h) => [h.start, h.productionKwh]),
      );
      // Previously issued v3.2 hours for today's short-term comparison. Current
      // official generation starts tomorrow, so it cannot supply today's baseline.
      const prior = (
        await db()
          .prepare(`SELECT DISTINCT ON (h->>'start') h->>'start' AS start,
        (h->>'productionKwh')::double precision AS kwh,r.id AS "forecastId"
        FROM forecast_runs r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'days') d
        CROSS JOIN LATERAL jsonb_array_elements(d->'hours') h
        WHERE r.owner=? AND r.model_version='weather-solar-v3.2' AND r.payload->'config'->>'version'=?
        AND r.issued_at<?::timestamptz AND r.issued_at<(h->>'start')::timestamptz
        AND h->>'start'>=? AND h->>'start'<? AND h->>'productionKwh' IS NOT NULL
        ORDER BY h->>'start',r.issued_at,r.id`)
          .bind(
            owner,
            config.version,
            now.toISOString(),
            slotsForDay(localDate(now))[0].start,
            slotsForDay(addDays(localDate(now), 1))[0].start,
          )
          .all<{ start: string; kwh: number; forecastId: string }>()
      ).results;
      for (const p of prior) official.set(p.start, p.kwh);
      const hours: TrialHour[] = weather.hours
        .filter((w) => byStart.has(w.start))
        .map((w) => ({
          start: w.start,
          baselineKwh: official.get(w.start) ?? null,
          weather: { temperature: w.temperature, windSpeed: w.windSpeed },
          iconKwh: weatherAdjustedEnergy(
            {
              ...w,
              irradiance: byStart.get(w.start)!.irradiance,
              irradianceKind: 'modeled-ghi',
              resolutionHours: 1,
            },
            config,
            forecast.calibration,
          ),
        }));
      const issuedAt = new Date().toISOString(),
        tomorrow = addDays(localDate(issuedAt), 1);
      const selected = hours.filter((h) => localDate(h.start) === tomorrow);
      if (
        selected.length !== slotsForDay(tomorrow).length ||
        selected.some((h) => h.iconKwh === null)
      )
        throw Error('Incomplete ICON trial');
      const run: TrialRun = {
        id: crypto.randomUUID(),
        version: TRIAL_VERSION,
        issuedAt,
        kind: 'day-ahead',
        configVersion: config.version,
        baselineId: forecast.id,
        weatherRunAt: icon.runAt,
        status: 'ready',
        hours: selected.map((h) => ({
          start: h.start,
          end: new Date(Date.parse(h.start) + 3600000).toISOString(),
          baselineKwh: h.baselineKwh,
          predictedKwh: h.iconKwh,
          leadMinutes: (Date.parse(h.start) - Date.parse(issuedAt)) / 60000,
        })),
      };
      const context: TrialContext = {
        version: TRIAL_VERSION,
        calibration: forecast.calibration,
        config,
        baselineId: run.id,
        weatherRunAt: icon.runAt,
        hours,
        issuedAt,
      };
      const view: TrialView = {
        ...empty(),
        dayAhead: run,
        icon: { status: icon.status, runAt: icon.runAt },
        satellite,
        scores,
      };
      const replay = await db()
        .prepare(
          "SELECT payload FROM forecast_evaluations WHERE owner=? AND model_version='satellite-csi-v1-on-v3.2-replay' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(owner)
        .first<{
          payload: {
            from: string;
            to: string;
            v32: { hours: number; wapePercent: number };
            satellite: { wapePercent: number };
            satelliteAppliedHours: number;
            days: {
              date: string;
              v32: { wapePercent: number };
              satellite: { wapePercent: number };
            }[];
          };
        }>();
      if (replay) {
        const r = replay.payload,
          last = r.days.at(-1)!;
        view.replay = {
          from: r.from,
          to: r.to,
          hours: r.v32.hours,
          appliedHours: r.satelliteAppliedHours,
          v32Wape: r.v32.wapePercent,
          satelliteWape: r.satellite.wapePercent,
          days: r.days.length,
          daysImproved: r.days.filter(
            (d) => d.satellite.wapePercent < d.v32.wapePercent,
          ).length,
          lastDay: {
            date: last.date,
            v32Wape: last.v32.wapePercent,
            satelliteWape: last.satellite.wapePercent,
          },
        };
      }
      const observations =
        (await cacheRead<LiveObservation[]>('trial-observations:' + owner)) ??
        [];
      const intraday = makeSatelliteNowcast(
        hours,
        observations,
        config,
        run.id,
        icon.runAt,
        satellite.points,
        forecast.calibration,
        new Date(),
      );
      view.intraday = intraday;
      if (intraday.status === 'ready')
        await db()
          .prepare(
            'INSERT INTO forecast_trials(id,owner,run_key,issued_at,kind,model_version,payload,inputs) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT(owner,run_key) DO NOTHING',
          )
          .bind(
            intraday.id,
            owner,
            intraday.id,
            intraday.issuedAt,
            'intraday',
            TRIAL_VERSION,
            JSON.stringify(intraday),
            JSON.stringify({
              context,
              satellite,
              observations: observations.slice(-2),
              v32Sources: prior,
            }),
          )
          .run();
      await cacheWrite('trial-intraday:' + owner, intraday, 86400);
      const inputs = {
        view,
        context,
        icon,
        weather: weather.raw,
        weatherIssuedAt: weather.issuedAt,
        calibration: forecast.calibration,
        baseline: forecast,
        v32Sources: prior,
        method:
          'ICON-EU direct+diffuse hourly GHI, de-averaged from run start; existing empirical plant curve and MET temperature/wind; no GFS-trained gain; prospective shadow trial',
      };
      const runKey =
        TRIAL_VERSION +
        ':' +
        config.version +
        ':' +
        icon.runAt +
        ':' +
        Math.floor(Date.parse(issuedAt) / 1800000);
      await db()
        .prepare(
          'INSERT INTO forecast_trials(id,owner,run_key,issued_at,kind,model_version,payload,inputs) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT(owner,run_key) DO NOTHING',
        )
        .bind(
          run.id,
          owner,
          runKey,
          issuedAt,
          run.kind,
          TRIAL_VERSION,
          JSON.stringify(run),
          JSON.stringify(inputs),
        )
        .run();
      const saved = await db()
        .prepare(
          "SELECT inputs->'view' AS view,inputs->'context' AS context FROM forecast_trials WHERE owner=? AND run_key=?",
        )
        .bind(owner, runKey)
        .first<{ view: TrialView; context: TrialContext }>();
      if (!saved) throw Error('Trial persistence failed');
      await cacheWrite('trial-context:' + owner, saved.context, 2 * 86400);
      await cacheWrite(key(owner), { owner, view: saved.view }, 7 * 86400);
      return saved.view;
    },
    120,
  );
  if (locked.busy) throw Error('Trial busy');
  return locked.value;
}
export async function handleTrialGet() {
  try {
    const user = await getUser();
    if (!user) return reply({ error: 'Unauthorized' }, 401);
    return reply(await readTrial(user.plantOwner));
  } catch {
    return reply({ error: 'Пробниот модел моментално не е достапен.' }, 503);
  }
}
export async function handleTrialPost(request: Request) {
  try {
    const user = await getUser(true);
    if (!user) return reply({ error: 'Unauthorized' }, 401);
    if (!isAdmin(user) || !sameOrigin(request))
      return reply({ error: 'Потребен е администраторски пристап.' }, 403);
    if (!(await authLimit('forecast-trial:' + user.userId, 4)))
      return reply({ error: 'Обидете се повторно подоцна.' }, 429);
    await runTrial(user.plantOwner);
    return reply(await readTrial(user.plantOwner));
  } catch {
    return reply(
      { error: 'Пробната пресметка не успеа. Последната прогноза е зачувана.' },
      503,
    );
  }
}
