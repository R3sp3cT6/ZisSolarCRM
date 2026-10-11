import { localDate } from './energy';

export const SATELLITE_STRENGTHS = [0.5, 1, 1.5, 2] as const;
export type SatelliteStrength = (typeof SATELLITE_STRENGTHS)[number];
export type SatelliteTrainingPair = {
  start: string;
  end: string;
  issuedAt: string;
  availableAt: string;
  actualKwh: number | null;
  candidates: Record<string, number>;
};
export type SatelliteBlendCalibration = {
  status: 'insufficient' | 'accepted' | 'rejected';
  strength: SatelliteStrength;
  candidateStrength: SatelliteStrength;
  trainedAt: string;
  trainingDays: number;
  trainingIntervals: number;
  validationDays: number;
  baselineMaeKwh: number | null;
  candidateMaeKwh: number | null;
};
/** Reweight a convex satellite blend without another radiation calculation.
 * Both input powers are bounded AC power, so recovering the satellite end point
 * is exact; weight 0 always retains the fallback. */
export function adaptiveSatellitePower(
  baseKw: number,
  satellite: { powerKw: number; weight: number },
  strength: SatelliteStrength,
  acKw: number,
) {
  if (
    !(satellite.weight > 0) ||
    !Number.isFinite(baseKw) ||
    !Number.isFinite(satellite.powerKw)
  )
    return { powerKw: baseKw, weight: 0 };
  const factor = SATELLITE_STRENGTHS.includes(strength) ? strength : 1;
  const weight = Math.min(0.95, satellite.weight * factor);
  return {
    powerKw: Math.max(
      0,
      Math.min(
        acKw,
        baseKw + ((satellite.powerKw - baseKw) * weight) / satellite.weight,
      ),
    ),
    weight,
  };
}
/** Every fit, including validation folds, selects only revisions known before
 * that origin. The most recent revision replaces an earlier value of a pair. */
export function calibrateSatelliteBlend(
  input: SatelliteTrainingPair[],
  now: Date,
): SatelliteBlendCalibration {
  const result: SatelliteBlendCalibration = {
    status: 'insufficient',
    strength: 1,
    candidateStrength: 1,
    trainedAt: now.toISOString(),
    trainingDays: 0,
    trainingIntervals: 0,
    validationDays: 0,
    baselineMaeKwh: null,
    candidateMaeKwh: null,
  };
  const valid = input.filter(
    (p) =>
      [p.start, p.end, p.issuedAt, p.availableAt].every((t) =>
        Number.isFinite(Date.parse(t)),
      ) &&
      Date.parse(p.end) > Date.parse(p.start) &&
      Date.parse(p.issuedAt) <= Date.parse(p.start) &&
      Date.parse(p.availableAt) >= Date.parse(p.end) &&
      (p.actualKwh === null ||
        (Number.isFinite(p.actualKwh) && p.actualKwh >= 0)) &&
      SATELLITE_STRENGTHS.every(
        (s) => Number.isFinite(p.candidates[s]) && p.candidates[s] >= 0,
      ),
  );
  function knownAt(cutoff: number) {
    const latest = new Map<string, SatelliteTrainingPair>();
    for (const p of valid) {
      if (
        Date.parse(p.availableAt) >= cutoff ||
        localDate(p.start) >= localDate(new Date(cutoff)) ||
        Date.parse(p.start) < cutoff - 14 * 86400000
      )
        continue;
      const old = latest.get(p.start);
      if (!old || Date.parse(p.availableAt) > Date.parse(old.availableAt))
        latest.set(p.start, p);
    }
    return [...latest.values()].filter(
      (p): p is SatelliteTrainingPair & { actualKwh: number } =>
        p.actualKwh !== null &&
        (p.actualKwh > 0 || Object.values(p.candidates).some((v) => v > 0)),
    );
  }
  const days = (pairs: SatelliteTrainingPair[]) =>
    [...new Set(pairs.map((p) => localDate(p.start)))].sort();
  function choose(
    pairs: (SatelliteTrainingPair & { actualKwh: number })[],
  ): SatelliteStrength | null {
    if (pairs.length < 30 || days(pairs).length < 3) return null;
    return [...SATELLITE_STRENGTHS].sort((a, b) => {
      const loss = (s: SatelliteStrength) =>
        pairs.reduce(
          (total, p) => total + Math.abs(p.candidates[s] - p.actualKwh),
          0,
        );
      return loss(a) - loss(b) || Math.abs(a - 1) - Math.abs(b - 1);
    })[0];
  }
  const pairs = knownAt(now.getTime()),
    selected = choose(pairs);
  result.trainingDays = days(pairs).length;
  result.trainingIntervals = pairs.length;
  if (selected === null) return result;
  result.candidateStrength = selected;
  const folds = [];
  for (const day of days(pairs)) {
    const targets = pairs.filter((p) => localDate(p.start) === day);
    const origin = Math.min(...targets.map((p) => Date.parse(p.issuedAt)));
    const strength = choose(knownAt(origin));
    if (strength === null) continue;
    folds.push({
      n: targets.length,
      baseline: targets.reduce(
        (s, p) => s + Math.abs(p.candidates[1] - p.actualKwh),
        0,
      ),
      candidate: targets.reduce(
        (s, p) => s + Math.abs(p.candidates[strength] - p.actualKwh),
        0,
      ),
    });
  }
  const check = folds.slice(-3);
  result.validationDays = check.length;
  if (check.length < 3) return result;
  const n = check.reduce((s, f) => s + f.n, 0),
    base = check.reduce((s, f) => s + f.baseline, 0),
    candidate = check.reduce((s, f) => s + f.candidate, 0);
  result.baselineMaeKwh = base / n;
  result.candidateMaeKwh = candidate / n;
  result.status =
    base > 0 && candidate <= base * 0.98 ? 'accepted' : 'rejected';
  if (result.status === 'accepted') result.strength = selected;
  return result;
}
