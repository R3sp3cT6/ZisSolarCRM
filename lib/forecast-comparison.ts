import { hourLabel, localDate } from './energy';
import type { buildDashboard } from './dashboard';

export type ForecastComparisonHour = {
  start: string;
  productionKwh: number;
  issuedAt: string;
  modelVersion: string;
};
export type ForecastComparison = {
  hours: ForecastComparisonHour[];
  unavailable?: boolean;
};

// Frozen, prospective predictions only. UTC keys keep the repeated DST hour distinct.
export function firstForecasts(hours: ForecastComparisonHour[]) {
  const first = new Map<string, ForecastComparisonHour>();
  for (const hour of hours) {
    const start = Date.parse(hour.start),
      issued = Date.parse(hour.issuedAt);
    if (
      !Number.isFinite(start) ||
      start % 3600000 !== 0 ||
      !Number.isFinite(issued) ||
      issued >= start ||
      !Number.isFinite(hour.productionKwh) ||
      hour.productionKwh < 0
    )
      continue;
    const key = new Date(start).toISOString();
    const previous = first.get(key);
    if (!previous || issued < Date.parse(previous.issuedAt))
      first.set(key, { ...hour, start: key });
  }
  return first;
}

export function attachForecastComparison(
  data: ReturnType<typeof buildDashboard>,
  comparison: ForecastComparison,
) {
  const forecasts = firstForecasts(comparison.hours);
  const actual = new Map(data.chart.map((point) => [point.key, point]));
  const bins = new Map<string, { label: string; starts: string[] }>();
  for (
    let ms = Date.parse(data.range.from);
    ms < Date.parse(data.range.to);
    ms += 3600000
  ) {
    const start = new Date(ms).toISOString(),
      date = localDate(start);
    const key =
      data.period === 'year'
        ? date.slice(0, 7)
        : data.period === 'month'
          ? date
          : start;
    const bin = bins.get(key) ?? {
      label:
        data.period === 'year'
          ? date.slice(5, 7)
          : data.period === 'month'
            ? date.slice(8, 10)
            : hourLabel(start),
      starts: [],
    };
    bin.starts.push(start);
    bins.set(key, bin);
  }
  let coveredHours = 0;
  const chart = [...bins].map(([key, bin]) => {
    const predicted = bin.starts.flatMap((start) => forecasts.get(start) ?? []);
    coveredHours += predicted.length;
    // A partial forecast sum must never look like a complete day/month prediction.
    const complete = predicted.length === bin.starts.length;
    return {
      key,
      label: bin.label,
      productionKwh: null,
      exportKwh: null,
      revenue: null,
      missingPrice: false,
      partial: false,
      ...actual.get(key),
      forecastProductionKwh: complete
        ? predicted.reduce((sum, h) => sum + h.productionKwh, 0)
        : null,
      forecastIssuedAt:
        complete && predicted.length === 1 ? predicted[0].issuedAt : null,
      forecastModelVersion:
        complete && predicted.length === 1 ? predicted[0].modelVersion : null,
    };
  });
  return {
    ...data,
    chart,
    forecastComparison: {
      status: comparison.unavailable
        ? ('unavailable' as const)
        : coveredHours === 0
          ? ('missing' as const)
          : coveredHours ===
              (Date.parse(data.range.to) - Date.parse(data.range.from)) /
                3600000
            ? ('complete' as const)
            : ('partial' as const),
      coveredHours,
    },
  };
}
