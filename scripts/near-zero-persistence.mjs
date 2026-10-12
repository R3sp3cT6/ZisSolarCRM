// Research-only causal rule. A flag is not a confirmed shutdown command.
import { localDate } from '../lib/energy.ts';
const addDays = (day, amount) =>
  new Date(Date.parse(day + 'T12:00:00Z') + amount * 86400000)
    .toISOString()
    .slice(0, 10);
export function nearZeroPersistence({
  targetDate,
  originAt,
  days,
  known,
  acKw,
}) {
  if (
    !Number.isFinite(acKw) ||
    acKw <= 0 ||
    !Number.isFinite(Date.parse(originAt)) ||
    localDate(originAt) !== addDays(targetDate, -1)
  )
    throw Error('Invalid origin/capacity');
  const evidence = [-3, -2].map((lag) => {
    const date = addDays(targetDate, lag),
      day = days.find((d) => d.date === date);
    if (!day) return { date, status: 'missing-weather-day', hours: [] };
    const hours = day.hours
      .filter((h) => h.clearSky > 0)
      .map((h) => {
        const row = known.get(h.start);
        return {
          start: h.start,
          irradiance: h.irradiance,
          productionKwh: row?.productionKwh ?? null,
          index: row?.index ?? null,
          observedAt: row?.observedAt ?? null,
        };
      });
    const complete =
      hours.length > 0 &&
      hours.every(
        (h) =>
          typeof h.productionKwh === 'number' &&
          Number.isFinite(h.productionKwh) &&
          h.productionKwh >= 0 &&
          h.productionKwh <= acKw &&
          Number.isFinite(h.irradiance) &&
          Date.parse(h.start) + 3600000 < Date.parse(originAt),
      );
    const strongWeatherHours = hours.filter(
      (h) => Number.isFinite(h.irradiance) && h.irradiance >= 300,
    ).length;
    const maximumKwh = complete
      ? Math.max(...hours.map((h) => h.productionKwh))
      : null;
    return {
      date,
      hours,
      strongWeatherHours,
      maximumKwh,
      status: !complete
        ? 'incomplete'
        : strongWeatherHours < 3
          ? 'insufficient-forecast-radiation'
          : maximumKwh > acKw * 0.01
            ? 'producing'
            : 'near-zero',
    };
  });
  return { trigger: evidence.every((d) => d.status === 'near-zero'), evidence };
}

export function measurementsKnownAt(data, mode, originAt) {
  if (mode === 'archiveReconstruction')
    return new Map(data.actual.map((r, index) => [r.start, { ...r, index }]));
  if (mode !== 'receiptCausal') throw Error('Unknown receipt policy');
  const known = new Map(),
    origin = Date.parse(originAt);
  const rows = data.revisions
    .map((r, index) => ({ ...r, index }))
    .sort(
      (a, b) =>
        Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
        (String(a.id) < String(b.id)
          ? -1
          : String(a.id) > String(b.id)
            ? 1
            : 0),
    );
  for (const r of rows)
    if (
      Date.parse(r.observedAt) < origin &&
      Date.parse(r.start) + 3600000 <= Date.parse(r.observedAt)
    )
      known.set(r.start, r);
  return known;
}
