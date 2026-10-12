import 'server-only';
import { createHash } from 'node:crypto';
import artifactData from './models/solar-site-v1.json' with { type: 'json' };
import { db } from '../db/index';
import { localDate, slotsForDay } from './energy';
import { addDays, type ForecastConfig } from './forecast-model';
import type { ProviderSource } from './forecast-multimodel-sources';
import {
  SITE_LEARNING_VERSION,
  siteForecast,
  validSiteModel,
  type SiteModel,
} from './forecast-site-learning';
import {
  siteTrialScore,
  type SitePair,
  type SiteTrialView,
} from './forecast-site-trial';

export const siteModel = artifactData as SiteModel;
export const siteArtifactHash = createHash('sha256')
  .update(JSON.stringify(siteModel))
  .digest('hex');
export async function siteHistory(
  owner: string,
  configVersion: string,
  now = new Date(),
) {
  const rows = (
    await db()
      .prepare(`WITH p AS (
    SELECT DISTINCT ON(h->>'start') h,f.issued_at AS "issuedAt"
    FROM forecast_trials f CROSS JOIN LATERAL jsonb_array_elements(f.payload->'siteLearning'->'hours') h
    WHERE f.owner=? AND f.kind='day-ahead' AND f.payload->>'configVersion'=?
      AND f.payload->'siteLearning'->>'artifactHash'=? AND f.payload->'siteLearning'->>'status'='ready'
      AND f.issued_at>?::timestamptz-interval '30 days' AND f.issued_at<(h->>'start')::timestamptz
    ORDER BY h->>'start',f.issued_at,f.id
  ) SELECT p.h,p."issuedAt",r.production_kwh AS "actualKwh"
    FROM p JOIN readings r ON r.owner=? AND r.start=p.h->>'start'
    WHERE r.start::timestamptz+interval '1 hour'<=?::timestamptz ORDER BY r.start LIMIT 800`)
      .bind(
        owner,
        configVersion,
        siteArtifactHash,
        now.toISOString(),
        owner,
        now.toISOString(),
      )
      .all<{ h: SitePair; issuedAt: string; actualKwh: number }>()
  ).results;
  return rows.map((r) => ({
    ...r.h,
    issuedAt: new Date(r.issuedAt).toISOString(),
    actualKwh: r.actualKwh,
  }));
}
export function buildSiteTrial(
  source: ProviderSource,
  config: ForecastConfig,
  date: string,
  baseline: Map<string, number | null>,
  history: SitePair[],
  now = new Date(),
): SiteTrialView {
  const valid = validSiteModel(siteModel, config, now);
  const slots = slotsForDay(date),
    starts = new Set(slots.map((s) => s.start));
  // The live source may use a different GFS cycle from the12UTC retrospective
  // experiment. Preserve that cycle and score live issues independently.
  const available =
    date === addDays(localDate(now), 1) &&
    source.status === 'ready' &&
    source.nativeResolutionHours === 1 &&
    source.runAt &&
    [0, 6, 12, 18].includes(new Date(source.runAt).getUTCHours()) &&
    localDate(source.runAt) === localDate(now) &&
    Number.isFinite(Date.parse(source.fetchedAt)) &&
    Date.parse(source.fetchedAt) <= now.getTime() &&
    Date.parse(source.runAt) <= now.getTime() &&
    now.getTime() - Date.parse(source.runAt) < 18 * 3600000;
  const weather = source.hours.filter((h) => starts.has(h.start));
  let forecast: ReturnType<typeof siteForecast> = [];
  try {
    if (valid && available)
      forecast = siteForecast(weather, config, siteModel, now);
  } catch {
    // An optional challenger cannot prevent the other forecasts being saved.
  }
  const ready =
    forecast.length === slots.length &&
    forecast.every((h) => h.productionKwh !== null);
  const values = new Map(forecast.map((h) => [h.start, h.productionKwh]));
  return {
    version: SITE_LEARNING_VERSION,
    artifactHash: siteArtifactHash,
    method: siteModel.method,
    trainedAt: siteModel.trainedAt,
    validUntil: siteModel.validUntil,
    trainingHours: siteModel.trainingHours,
    trainingDays: siteModel.trainingDays,
    status: ready
      ? 'ready'
      : valid
        ? 'source-unavailable'
        : 'model-unavailable',
    hours: slots.map((s) => ({
      start: s.start,
      productionKwh: ready ? (values.get(s.start) ?? null) : null,
      baselineKwh: baseline.get(s.start) ?? null,
    })),
    score: siteTrialScore(history, now),
  };
}
