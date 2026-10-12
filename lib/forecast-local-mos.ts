import { getTimes } from 'suncalc';
import { localDate } from './energy';
import type { ForecastConfig } from './forecast-model';
import { clearSkyIrradiance } from './forecast-solar';

export const LOCAL_MOS_VERSION = 'solar-local-mos-v1';
export type MosHour = {
  start: string;
  originAt: string;
  baseKwh: number;
  solarHour: number;
  csi: number;
  clearSky: number;
};
export type MosRevision = {
  id: string | number;
  start: string;
  observedAt: string;
  productionKwh: number | null;
};
export type MosPair = MosHour & {
  actualKwh: number;
  observedAt: string;
  revisionId: string | number;
};

export function mosFeatures(
  start: string,
  irradiance: number,
  config: ForecastConfig,
) {
  const clearSky = clearSkyIrradiance(start, config);
  if (
    clearSky === null ||
    !Number.isFinite(irradiance) ||
    irradiance < 0 ||
    irradiance > 1800
  )
    return null;
  const midpoint = new Date(Date.parse(start) + 1800000);
  const noon = getTimes(
    midpoint,
    config.latitude!,
    config.longitude!,
  ).solarNoon;
  return {
    clearSky,
    solarHour: 12 + (midpoint.getTime() - noon.getTime()) / 3600000,
    csi: clearSky >= 50 ? Math.min(2, irradiance / clearSky) : 0,
  };
}

/** Select revisions before fitting, never the final target truth. */
export function mosTraining(
  hours: MosHour[],
  revisions: MosRevision[],
  origin: Date,
  acKw: number,
): MosPair[] {
  const cutoff = origin.getTime();
  if (!Number.isFinite(cutoff) || !Number.isFinite(acKw) || acKw <= 0)
    return [];
  const known = new Map<string, MosRevision>();
  for (const r of revisions.toSorted(
    (a, b) =>
      Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
      String(a.id).localeCompare(String(b.id)),
  )) {
    const start = Date.parse(r.start),
      receipt = Date.parse(r.observedAt);
    if (
      Number.isFinite(start) &&
      Number.isFinite(receipt) &&
      receipt < cutoff &&
      start + 3600000 <= receipt &&
      start >= cutoff - 30 * 86400000 &&
      localDate(r.start) < localDate(origin)
    )
      known.set(new Date(start).toISOString(), r);
  }
  const seen = new Set<string>();
  return hours
    .toSorted((a, b) => a.originAt.localeCompare(b.originAt))
    .flatMap((h) => {
      const t = Date.parse(h.start),
        issued = Date.parse(h.originAt);
      if (
        !Number.isFinite(t) ||
        t % 3600000 ||
        !Number.isFinite(issued) ||
        issued >= t ||
        issued >= cutoff ||
        seen.has(h.start) ||
        ![h.baseKwh, h.solarHour, h.csi, h.clearSky].every(Number.isFinite) ||
        h.baseKwh < 5 ||
        h.baseKwh > acKw ||
        h.clearSky < 50 ||
        h.csi < 0 ||
        h.csi > 2
      )
        return [];
      const r = known.get(h.start);
      if (
        !r ||
        r.productionKwh === null ||
        !Number.isFinite(r.productionKwh) ||
        r.productionKwh < 0 ||
        r.productionKwh > acKw
      )
        return [];
      seen.add(h.start);
      return [
        {
          ...h,
          actualKwh: r.productionKwh,
          observedAt: new Date(r.observedAt).toISOString(),
          revisionId: r.id,
        },
      ];
    });
}

export function localMos(
  train: MosPair[],
  target: MosHour,
  origin: Date,
  acKw: number,
) {
  const unchanged = (status: 'low-light' | 'insufficient' | 'invalid') => ({
    productionKwh: target.baseKwh,
    factor: 1,
    status,
    effectiveHours: 0,
    effectiveDays: 0,
  });
  if (
    !Number.isFinite(acKw) ||
    acKw <= 0 ||
    !Number.isFinite(origin.getTime()) ||
    ![target.baseKwh, target.clearSky, target.solarHour, target.csi].every(
      Number.isFinite,
    ) ||
    target.baseKwh < 0 ||
    target.baseKwh > acKw ||
    target.csi < 0 ||
    target.csi > 2 ||
    !Number.isFinite(Date.parse(target.start)) ||
    Date.parse(target.start) <= origin.getTime()
  )
    return unchanged('invalid');
  if (target.baseKwh < 5 || target.clearSky < 50) return unchanged('low-light');
  const days = new Map<string, number>();
  const seen = new Set<string>();
  const pairs = train.flatMap((r) => {
    const t = Date.parse(r.start),
      receipt = Date.parse(r.observedAt),
      issued = Date.parse(r.originAt);
    const age = (origin.getTime() - t) / 86400000;
    if (
      ![
        t,
        receipt,
        issued,
        r.baseKwh,
        r.actualKwh,
        r.solarHour,
        r.csi,
        r.clearSky,
      ].every(Number.isFinite) ||
      receipt >= origin.getTime() ||
      t + 3600000 > receipt ||
      issued >= t ||
      age < 0 ||
      age > 30 ||
      localDate(r.start) >= localDate(origin) ||
      r.baseKwh < 5 ||
      r.baseKwh > acKw ||
      r.actualKwh < 0 ||
      r.actualKwh > acKw ||
      r.clearSky < 50 ||
      r.csi < 0 ||
      r.csi > 2 ||
      seen.has(r.start)
    )
      return [];
    seen.add(r.start);
    const proximity = Math.exp(
      -0.5 *
        (((r.solarHour - target.solarHour) / 2) ** 2 +
          ((r.csi - target.csi) / 0.25) ** 2),
    );
    const weight = r.baseKwh * proximity * 2 ** (-age / 14);
    days.set(localDate(r.start), (days.get(localDate(r.start)) ?? 0) + weight);
    return [{ ratio: r.actualKwh / r.baseKwh, weight }];
  });
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  const effectiveHours =
    total ** 2 / pairs.reduce((s, p) => s + p.weight ** 2, 0);
  const effectiveDays =
    total ** 2 / [...days.values()].reduce((s, w) => s + w ** 2, 0);
  if (!(total > 0) || days.size < 7 || effectiveHours < 20 || effectiveDays < 5)
    return unchanged('insufficient');
  pairs.push({ ratio: 1, weight: total / 3 });
  pairs.sort((a, b) => a.ratio - b.ratio);
  let cumulative = 0,
    factor = 1;
  for (const p of pairs) {
    cumulative += p.weight;
    if (cumulative >= (total * 2) / 3) {
      factor = Math.max(0.85, Math.min(1.15, p.ratio));
      break;
    }
  }
  return {
    productionKwh: Math.min(acKw, target.baseKwh * factor),
    factor,
    status: 'ready' as const,
    effectiveHours,
    effectiveDays,
  };
}
