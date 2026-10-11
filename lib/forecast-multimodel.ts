import { localDate } from './energy';

export const MULTIMODEL_VERSION = 'solar-multimodel-shadow-v1';
export const BASE_MODELS = ['icon', 'gfs', 'arpege'] as const;
export const MODEL_KEYS = [
  ...BASE_MODELS,
  'mean',
  'median',
  'learned',
] as const;
export type BaseModel = (typeof BASE_MODELS)[number];
export type ModelKey = (typeof MODEL_KEYS)[number];
export type Weights = Record<BaseModel, number>;
export type ModelHour = {
  start: string;
  values: Record<ModelKey, number | null>;
};
export type ModelPair = ModelHour & { actualKwh: number; issuedAt: string };
export type ModelScore = {
  hours: number;
  days: number;
  actualKwh: number;
  predictedKwh: number;
  wape: number | null;
  rmse: number | null;
  biasPercent: number | null;
};
export function scoreModel(rows: ModelPair[], key: ModelKey): ModelScore {
  const pairs = rows.filter(
    (r) =>
      Number.isFinite(r.actualKwh) &&
      r.actualKwh >= 0 &&
      r.values[key] !== null &&
      Number.isFinite(r.values[key]) &&
      r.values[key]! >= 0,
  );
  const actualKwh = pairs.reduce((s, r) => s + r.actualKwh, 0),
    predictedKwh = pairs.reduce((s, r) => s + r.values[key]!, 0),
    absolute = pairs.reduce(
      (s, r) => s + Math.abs(r.values[key]! - r.actualKwh),
      0,
    );
  return {
    hours: pairs.length,
    days: new Set(pairs.map((r) => localDate(r.start))).size,
    actualKwh,
    predictedKwh,
    wape: actualKwh > 0 ? (100 * absolute) / actualKwh : null,
    rmse: pairs.length
      ? Math.sqrt(
          pairs.reduce((s, r) => s + (r.values[key]! - r.actualKwh) ** 2, 0) /
            pairs.length,
        )
      : null,
    biasPercent:
      actualKwh > 0 ? (100 * (predictedKwh - actualKwh)) / actualKwh : null,
  };
}
export function commonModelPairs(
  rows: ModelPair[],
  now = new Date(),
): ModelPair[] {
  const seen = new Map<string, ModelPair>();
  for (const row of rows.toSorted(
    (a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt),
  )) {
    const start = Date.parse(row.start),
      issued = Date.parse(row.issuedAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(issued) ||
      issued >= start ||
      start + 3600000 > now.getTime() ||
      !Number.isFinite(row.actualKwh) ||
      row.actualKwh < 0 ||
      BASE_MODELS.some(
        (k) =>
          row.values[k] === null ||
          !Number.isFinite(row.values[k]) ||
          row.values[k]! < 0,
      ) ||
      (row.actualKwh === 0 && BASE_MODELS.every((k) => row.values[k] === 0))
    )
      continue;
    if (!seen.has(row.start)) seen.set(row.start, row);
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}
export function blendModels(
  base: Record<BaseModel, number | null>,
  weights: Weights | null,
): Record<ModelKey, number | null> {
  const values = BASE_MODELS.map((k) => base[k]);
  const complete = values.every(
    (v) => v !== null && Number.isFinite(v) && v >= 0,
  );
  if (
    weights &&
    (BASE_MODELS.some((k) => !Number.isFinite(weights[k]) || weights[k] < 0) ||
      Math.abs(BASE_MODELS.reduce((s, k) => s + weights[k], 0) - 1) > 1e-9)
  )
    throw Error('Invalid ensemble weights');
  return {
    ...base,
    mean: complete ? values.reduce<number>((s, v) => s + v!, 0) / 3 : null,
    median: complete ? (values as number[]).toSorted((a, b) => a - b)[1] : null,
    learned:
      complete && weights
        ? BASE_MODELS.reduce((s, k) => s + weights[k] * base[k]!, 0)
        : null,
  };
}
export type WeightSelection = {
  status: 'collecting' | 'not-better' | 'validated-candidate';
  days: number;
  hours: number;
  weights: Weights | null;
  trainingDays: number;
  validationDays: number;
  validation?: {
    candidate: ModelScore;
    bestIndividual: BaseModel;
    individual: ModelScore;
  };
};
/** Frozen grid search, chronological validation and a future-only challenger.
 * Never optimize or score against a day still in progress. Valid daytime zeros
 * stay in the loss. A successful gate does not change the official model. */
export function selectWeights(
  input: ModelPair[],
  now = new Date(),
): WeightSelection {
  const cutoff = now.getTime() - 60 * 86400000;
  const rows = commonModelPairs(input, now).filter(
    (r) => Date.parse(r.start) >= cutoff && localDate(r.start) < localDate(now),
  );
  const days = [...new Set(rows.map((r) => localDate(r.start)))].sort();
  const initial: WeightSelection = {
    status: 'collecting',
    days: days.length,
    hours: rows.length,
    weights: null,
    trainingDays: 0,
    validationDays: 0,
  };
  if (days.length < 28) return initial;
  const validationDays = new Set(days.slice(-14)),
    trainingDays = new Set(days.slice(-44, -14));
  const train = rows.filter((r) => trainingDays.has(localDate(r.start))),
    validation = rows.filter((r) => validationDays.has(localDate(r.start)));
  if (train.length < 150 || validation.length < 150) return initial;
  let best = Infinity,
    weights: Weights = { icon: 1, gfs: 0, arpege: 0 };
  // Nonnegative weights on a 10% grid, including single-model candidates.
  for (let i = 0; i <= 10; i++)
    for (let g = 0; g <= 10 - i; g++) {
      const w = { icon: i / 10, gfs: g / 10, arpege: (10 - i - g) / 10 };
      const error = train.reduce(
        (s, r) =>
          s +
          Math.abs(
            BASE_MODELS.reduce((v, k) => v + w[k] * r.values[k]!, 0) -
              r.actualKwh,
          ),
        0,
      );
      if (error < best - 1e-9) {
        best = error;
        weights = w;
      }
    }
  const scored = validation.map((r) => ({
    ...r,
    values: blendModels(r.values, weights),
  }));
  const candidate = scoreModel(scored, 'learned'),
    individuals = BASE_MODELS.map((model) => ({
      model,
      score: scoreModel(scored, model),
    })),
    bestIndividual = individuals.sort(
      (a, b) => (a.score.wape ?? Infinity) - (b.score.wape ?? Infinity),
    )[0];
  const reference = bestIndividual.score;
  const eligible =
    candidate.wape !== null &&
    reference.wape !== null &&
    candidate.wape < reference.wape * 0.98 &&
    candidate.rmse! <= reference.rmse! * 1.03 &&
    Math.abs(candidate.biasPercent!) <= Math.abs(reference.biasPercent!) + 2;
  return {
    status: eligible ? 'validated-candidate' : 'not-better',
    days: days.length,
    hours: rows.length,
    weights: eligible ? weights : null,
    trainingDays: trainingDays.size,
    validationDays: validationDays.size,
    validation: {
      candidate,
      bestIndividual: bestIndividual.model,
      individual: reference,
    },
  };
}
export type ModelsView = {
  version: string;
  issuedAt: string;
  date: string;
  complete: boolean;
  configVersion: string;
  sources: Record<
    BaseModel,
    { status: string; runAt: string | null; fetchedAt: string | null }
  >;
  hours: ModelHour[];
  selection: WeightSelection;
  scores: Record<ModelKey, ModelScore>;
};
