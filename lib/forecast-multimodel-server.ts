import 'server-only';
import { db } from '../db/index';
import { cacheRead, cacheWrite, withCacheLock } from './shared-cache';
import type { TrialContext } from './forecast-trial-live';
import { TRIAL_VERSION } from './forecast-trial';
import { fetchModelSource } from './forecast-multimodel-sources';
import { weatherAdjustedEnergy } from './forecast-solar';
import { slotsForDay, localDate } from './energy';
import { addDays } from './forecast-model';
import { getUser, sameOrigin, authLimit } from './auth';
import { isAdmin } from './roles';
import {
  MULTIMODEL_VERSION,
  BASE_MODELS,
  MODEL_KEYS,
  blendModels,
  commonModelPairs,
  scoreModel,
  selectWeights,
  type ModelsView,
  type ModelPair,
} from './forecast-multimodel';

const key = (owner: string) => 'forecast-models:v1:' + owner;
const response = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
export async function readModels(owner: string): Promise<ModelsView | null> {
  const cached = await cacheRead<{ owner: string; view: ModelsView | null }>(
    key(owner),
  );
  if (cached?.owner === owner) return cached.view;
  const row = await db()
    .prepare(
      "SELECT payload FROM forecast_trials WHERE owner=? AND kind='day-ahead' AND model_version=? ORDER BY issued_at DESC LIMIT 1",
    )
    .bind(owner, MULTIMODEL_VERSION)
    .first<{ payload: ModelsView }>();
  const view = row?.payload ?? null;
  await cacheWrite(key(owner), { owner, view }, view ? 7 * 86400 : 3600);
  return view;
}
export async function modelHistory(
  owner: string,
  configVersion: string,
  now = new Date(),
): Promise<ModelPair[]> {
  const rows = (
    await db()
      .prepare(`WITH p AS (
    SELECT DISTINCT ON (h->>'start') h, f.issued_at
    FROM forecast_trials f CROSS JOIN LATERAL jsonb_array_elements(f.payload->'hours') h
    WHERE f.owner=? AND f.model_version=? AND f.kind='day-ahead' AND f.payload->>'configVersion'=?
      AND f.payload->>'complete'='true' AND f.issued_at>?::timestamptz-interval '60 days'
      AND f.issued_at<(h->>'start')::timestamptz
      AND ((h->>'start')::timestamptz AT TIME ZONE 'Europe/Skopje')::date=(f.issued_at AT TIME ZONE 'Europe/Skopje')::date+1
    ORDER BY h->>'start',f.issued_at,f.id
  ) SELECT p.h,p.issued_at AS "issuedAt",r.production_kwh AS "actualKwh"
    FROM p JOIN readings r ON r.owner=? AND r.start=p.h->>'start'
    WHERE r.production_kwh IS NOT NULL AND r.start::timestamptz+interval '1 hour'<=?::timestamptz
    ORDER BY r.start LIMIT 1600`)
      .bind(
        owner,
        MULTIMODEL_VERSION,
        configVersion,
        now.toISOString(),
        owner,
        now.toISOString(),
      )
      .all<{ h: ModelPair; issuedAt: string; actualKwh: number }>()
  ).results;
  return commonModelPairs(
    rows.map((r) => ({
      ...r.h,
      issuedAt: new Date(r.issuedAt).toISOString(),
      actualKwh: r.actualKwh,
    })),
    now,
  );
}
export async function runModels(owner: string): Promise<ModelsView> {
  const locked = await withCacheLock(
    key(owner),
    async () => {
      const now = new Date(),
        date = addDays(localDate(now), 1);
      let context = await cacheRead<TrialContext>('trial-context:' + owner);
      if (!context) {
        const row = await db()
          .prepare(
            "SELECT inputs->'context' AS context FROM forecast_trials WHERE owner=? AND kind='day-ahead' AND model_version=? ORDER BY issued_at DESC LIMIT 1",
          )
          .bind(owner, TRIAL_VERSION)
          .first<{ context: TrialContext }>();
        context = row?.context ?? null;
      }
      if (
        !context ||
        context.version !== TRIAL_VERSION ||
        Date.parse(context.issuedAt) > now.getTime() ||
        !Number.isFinite(Date.parse(context.issuedAt)) ||
        now.getTime() - Date.parse(context.issuedAt) > 18 * 3600000 ||
        !Number.isFinite(Date.parse(context.weatherRunAt ?? '')) ||
        Date.parse(context.weatherRunAt!) > now.getTime() ||
        now.getTime() - Date.parse(context.weatherRunAt!) > 18 * 3600000
      )
        throw Error('Refresh the ICON trial before model comparison');
      const previous = await readModels(owner);
      if (
        previous?.configVersion === context.config.version &&
        previous.date === date &&
        now.getTime() - Date.parse(previous.issuedAt) < 1800000
      )
        return previous;
      const [arpege, gfs, history] = await Promise.all([
        fetchModelSource('arpege', context.config, now),
        fetchModelSource('gfs', context.config, now),
        modelHistory(owner, context.config.version, now),
      ]);
      const selection = selectWeights(history, now);
      const thermal = new Map(context.hours.map((h) => [h.start, h]));
      const a = new Map(arpege.hours.map((h) => [h.start, h.irradiance])),
        g = new Map(gfs.hours.map((h) => [h.start, h.irradiance]));
      const hours = slotsForDay(date).map(({ start }) => {
        const old = thermal.get(start);
        const energy = (map: Map<string, number>) =>
          !old?.weather || !map.has(start)
            ? null
            : weatherAdjustedEnergy(
                {
                  ...old.weather,
                  start,
                  irradiance: map.get(start)!,
                  irradianceKind: 'modeled-ghi',
                  resolutionHours: 1,
                  cloudCover: null,
                },
                context!.config,
                context!.calibration,
              );
        return {
          start,
          values: blendModels(
            { icon: old?.iconKwh ?? null, gfs: energy(g), arpege: energy(a) },
            selection.weights,
          ),
        };
      });
      const issuedAt = new Date().toISOString();
      // If a long request crossed the local day boundary, never backdate the run.
      if (
        addDays(localDate(issuedAt), 1) !== date ||
        hours.some((h) => Date.parse(h.start) <= Date.parse(issuedAt))
      )
        throw Error('Model day changed during collection');
      const view: ModelsView = {
        version: MULTIMODEL_VERSION,
        issuedAt,
        date,
        configVersion: context.config.version,
        complete: hours.every((h) =>
          BASE_MODELS.every((k) => h.values[k] !== null),
        ),
        sources: {
          icon: {
            status: hours.every((h) => h.values.icon !== null)
              ? 'ready'
              : 'unavailable',
            runAt: context.weatherRunAt,
            fetchedAt: context.issuedAt,
          },
          arpege: {
            status: arpege.status,
            runAt: arpege.runAt,
            fetchedAt: arpege.fetchedAt,
          },
          gfs: {
            status: gfs.status,
            runAt: gfs.runAt,
            fetchedAt: gfs.fetchedAt,
          },
        },
        hours,
        selection,
        scores: Object.fromEntries(
          MODEL_KEYS.map((k) => [k, scoreModel(history, k)]),
        ) as ModelsView['scores'],
      };
      const runKey =
        MULTIMODEL_VERSION +
        ':' +
        context.config.version +
        ':' +
        date +
        ':' +
        Math.floor(Date.parse(issuedAt) / 1800000);
      await db()
        .prepare(
          'INSERT INTO forecast_trials(id,owner,run_key,issued_at,kind,model_version,payload,inputs) VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT(owner,run_key) DO NOTHING',
        )
        .bind(
          crypto.randomUUID(),
          owner,
          runKey,
          issuedAt,
          'day-ahead',
          MULTIMODEL_VERSION,
          JSON.stringify(view),
          JSON.stringify({
            context,
            arpege,
            gfs,
            trainingPairs: history,
            method:
              'Native hourly GHI with common MET thermal inputs/plant calibration; prospective shadow only. Each provider retains its own original run. No official forecast changes.',
          }),
        )
        .run();
      const saved = await db()
        .prepare(
          'SELECT payload FROM forecast_trials WHERE owner=? AND run_key=?',
        )
        .bind(owner, runKey)
        .first<{ payload: ModelsView }>();
      if (!saved) throw Error('Model comparison persistence failed');
      await cacheWrite(key(owner), { owner, view: saved.payload }, 7 * 86400);
      return saved.payload;
    },
    130,
  );
  if (locked.busy) throw Error('Model comparison busy');
  return locked.value;
}
export async function handleModelsGet() {
  const user = await getUser();
  if (!user) return response({ error: 'Unauthorized' }, 401);
  try {
    return response(await readModels(user.plantOwner));
  } catch {
    return response({ error: 'Model comparison unavailable' }, 503);
  }
}
export async function handleModelsPost(request: Request) {
  const user = await getUser(true);
  if (!user) return response({ error: 'Unauthorized' }, 401);
  if (!isAdmin(user) || !sameOrigin(request))
    return response({ error: 'Forbidden' }, 403);
  if (!(await authLimit('forecast-models:' + user.userId, 3)))
    return response({ error: 'Try later' }, 429);
  try {
    return response(await runModels(user.plantOwner));
  } catch {
    return response(
      { error: 'Model collection deferred; previous data retained' },
      503,
    );
  }
}
