import { localDate } from './energy';
export type SiteTrialHour = {
  start: string;
  productionKwh: number | null;
  baselineKwh: number | null;
};
export type SitePair = SiteTrialHour & { issuedAt: string; actualKwh: number };
export function siteTrialScore(input: SitePair[], now = new Date()) {
  const seen = new Map<string, SitePair>();
  for (const r of input.toSorted((a, b) =>
    a.issuedAt.localeCompare(b.issuedAt),
  )) {
    const start = Date.parse(r.start),
      issued = Date.parse(r.issuedAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(issued) ||
      issued >= start ||
      start + 3600000 > now.getTime() ||
      ![r.actualKwh, r.productionKwh, r.baselineKwh].every(
        (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
      ) ||
      localDate(
        new Date(Date.parse(localDate(r.issuedAt) + 'T12:00:00Z') + 86400000),
      ) !== localDate(r.start) ||
      (r.actualKwh === 0 && r.productionKwh === 0 && r.baselineKwh === 0)
    )
      continue;
    if (!seen.has(r.start)) seen.set(r.start, r);
  }
  const rows = [...seen.values()],
    actualKwh = rows.reduce((s, r) => s + r.actualKwh, 0);
  const errors = (key: 'productionKwh' | 'baselineKwh') =>
    rows.reduce((s, r) => s + Math.abs(r[key]! - r.actualKwh), 0);
  return {
    hours: rows.length,
    days: new Set(rows.map((r) => localDate(r.start))).size,
    actualMwh: actualKwh / 1000,
    candidateMwh: rows.reduce((s, r) => s + r.productionKwh!, 0) / 1000,
    candidateWape:
      actualKwh > 0 ? (100 * errors('productionKwh')) / actualKwh : null,
    baselineWape:
      actualKwh > 0 ? (100 * errors('baselineKwh')) / actualKwh : null,
  };
}
export type SiteTrialView = {
  version: string;
  artifactHash: string;
  method: string;
  trainedAt: string;
  validUntil: string;
  trainingHours: number;
  trainingDays: number;
  status: 'ready' | 'model-unavailable' | 'source-unavailable';
  hours: SiteTrialHour[];
  score: ReturnType<typeof siteTrialScore>;
};
