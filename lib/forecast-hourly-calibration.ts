import { localDate, slotsForDay } from './energy';
import { backtestScores } from './forecast-backtest';

export const HOURLY_CALIBRATION_VERSION = 'hourly-wape-v1';
export type CalibrationPrediction = {
  start: string;
  baseKwh: number;
  originAt: string;
  source: 'prospective' | 'historical';
};
export type CalibrationRevision = {
  start: string;
  productionKwh: number | null;
  observedAt: string;
};
type Pair = CalibrationPrediction & { actual: number };
export type HourlyCalibration = {
  version: string;
  status: 'accepted' | 'insufficient' | 'rejected' | 'unavailable';
  factor: number;
  candidateFactor: number;
  trainedAt: string;
  trainingDays: string[];
  trainingHours: number;
  source: 'prospective' | 'historical' | 'mixed' | null;
  validation: {
    days: number;
    hours: number;
    baselineWape: number | null;
    candidateWape: number | null;
  };
};

export function emptyHourlyCalibration(now: Date): HourlyCalibration {
  return {
    version: HOURLY_CALIBRATION_VERSION,
    status: 'insufficient',
    factor: 1,
    candidateFactor: 1,
    trainedAt: now.toISOString(),
    trainingDays: [],
    trainingHours: 0,
    source: null,
    validation: { days: 0, hours: 0, baselineWape: null, candidateWape: null },
  };
}

/** argmin_f Σ|actual − f × base| = weighted median(actual/base, weight=base).
 * This minimizes hourly L1/WAPE on fixed pairs, NOT the net daily total error.
 * One bounded parameter avoids fitting a flexible curve to a few cloudy days. */
export function fitHourlyFactor(pairs: { baseKwh: number; actual: number }[]) {
  const sorted = pairs
    .filter(
      (p) =>
        Number.isFinite(p.baseKwh) &&
        p.baseKwh > 0 &&
        Number.isFinite(p.actual) &&
        p.actual >= 0,
    )
    .map((p) => ({ ratio: p.actual / p.baseKwh, weight: p.baseKwh }))
    .sort((a, b) => a.ratio - b.ratio);
  const weight = sorted.reduce((sum, p) => sum + p.weight, 0);
  if (!weight) return 1;
  let cumulative = 0;
  for (const p of sorted) {
    cumulative += p.weight;
    if (cumulative >= weight / 2) return Math.max(0.7, Math.min(1.3, p.ratio));
  }
  return 1;
}

/** Day-ahead baseline only. A later revision cannot enter an earlier fold's fit.
 * Replay origins are explicitly historical; they are never labelled prospective.
 * Run only when generating a forecast, with a bounded 30-day window, not on page reads. */
export function calibrateHourly(
  predictions: CalibrationPrediction[],
  revisions: CalibrationRevision[],
  now: Date,
  acKw = Infinity,
): HourlyCalibration {
  const result = emptyHourlyCalibration(now),
    today = localDate(now);
  const from = now.getTime() - 30 * 86400000;
  const byStart = new Map<string, CalibrationPrediction>();
  for (const p of predictions) {
    const start = Date.parse(p.start),
      issued = Date.parse(p.originAt);
    if (
      !Number.isFinite(start) ||
      start % 3600000 ||
      !Number.isFinite(issued) ||
      start < from ||
      localDate(p.start) >= today ||
      issued >= start ||
      !Number.isFinite(p.baseKwh) ||
      p.baseKwh < 0
    )
      continue;
    const previousDay = new Date(
      Date.parse(localDate(p.start) + 'T12:00:00Z') - 86400000,
    )
      .toISOString()
      .slice(0, 10);
    if (localDate(p.originAt) !== previousDay) continue;
    const key = new Date(start).toISOString(),
      old = byStart.get(key);
    if (
      !old ||
      (p.source === 'prospective' && old.source === 'historical') ||
      (p.source === old.source && issued < Date.parse(old.originAt))
    )
      byStart.set(key, { ...p, start: key });
  }
  const ordered = revisions
    .filter(
      (r) =>
        Number.isFinite(Date.parse(r.observedAt)) &&
        Number.isFinite(Date.parse(r.start)) &&
        Date.parse(r.start) >= from &&
        Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt),
    )
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  function pairsAt(cutoff: Date): Pair[] {
    const readings = new Map<string, number | null>();
    for (const r of ordered)
      if (Date.parse(r.observedAt) < cutoff.getTime())
        readings.set(new Date(r.start).toISOString(), r.productionKwh);
    const days = new Map<string, CalibrationPrediction[]>();
    for (const p of byStart.values()) {
      const day = localDate(p.start);
      if (day >= localDate(cutoff)) continue; // Exclude the unfinished origin day.
      days.set(day, [...(days.get(day) ?? []), p]);
    }
    return [...days].flatMap(([day, rows]) => {
      // A missing daylight measurement must not bias the fitted gain.
      if (
        rows.length !== slotsForDay(day).length ||
        rows.filter((p) => p.baseKwh > 5).length < 5 ||
        rows.some(
          (p) =>
            p.baseKwh > 5 &&
            (readings.get(p.start) == null ||
              !Number.isFinite(readings.get(p.start)) ||
              readings.get(p.start)! < 0),
        )
      )
        return [];
      return rows.flatMap((p) => {
        const actual = readings.get(p.start);
        return actual != null &&
          Number.isFinite(actual) &&
          actual >= 0 &&
          (actual > 0 || p.baseKwh > 0)
          ? [{ ...p, actual }]
          : [];
      });
    });
  }
  const pairs = pairsAt(now);
  const dates = [...new Set(pairs.map((p) => localDate(p.start)))].sort();
  result.trainingDays = dates;
  result.trainingHours = pairs.length;
  const sources = new Set(pairs.map((p) => p.source));
  result.source = sources.size === 2 ? 'mixed' : (pairs[0]?.source ?? null);
  if (dates.length < 3 || pairs.length < 30) return result;
  result.candidateFactor = fitHourlyFactor(pairs);
  const checked: { pair: Pair; corrected: number }[] = [];
  let validationDays = 0;
  // Walk forward once per delivery day. Latest six eligible validation days;
  // every fold refits using only revisions available before that day's origin.
  for (const day of dates) {
    const targets = pairs.filter((p) => localDate(p.start) === day);
    const origin = new Date(
      Math.min(...targets.map((p) => Date.parse(p.originAt))),
    );
    const train = pairsAt(origin);
    if (
      new Set(train.map((p) => localDate(p.start))).size < 3 ||
      train.length < 30
    )
      continue;
    validationDays++;
    const factor = fitHourlyFactor(train);
    checked.push(
      ...targets.map((pair) => ({
        pair,
        corrected: Math.min(acKw, pair.baseKwh * factor),
      })),
    );
  }
  const lastDays = [
    ...new Set(checked.map((p) => localDate(p.pair.start))),
  ].slice(-6);
  const sample = checked.filter((p) =>
    lastDays.includes(localDate(p.pair.start)),
  );
  const actual = sample.map(({ pair }) => ({
    start: pair.start,
    productionKwh: pair.actual,
  }));
  const baseline = backtestScores(
    actual,
    sample.map(({ pair }) => ({
      start: pair.start,
      productionKwh: pair.baseKwh,
    })),
  );
  const candidate = backtestScores(
    actual,
    sample.map(({ pair, corrected }) => ({
      start: pair.start,
      productionKwh: corrected,
    })),
  );
  result.validation = {
    days: Math.min(validationDays, 6),
    hours: baseline.hours,
    baselineWape: baseline.wapePercent,
    candidateWape: candidate.wapePercent,
  };
  if (result.validation.days < 3 || baseline.hours < 30) return result;
  const accepted =
    baseline.wapePercent !== null &&
    candidate.wapePercent !== null &&
    baseline.wapePercent > 0 &&
    candidate.wapePercent <= baseline.wapePercent * 0.98;
  result.status = accepted ? 'accepted' : 'rejected';
  result.factor = accepted ? result.candidateFactor : 1;
  return result;
}
