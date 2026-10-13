import {
  addDays,
  type ForecastPayload,
  type ForecastPrice,
} from './forecast-model';
import { localDate } from './energy';

// User confirmation recorded on 12 October. This is not backdated to old forecasts.
export const ZIS_AVAILABILITY_POLICY = {
  version: 'negative-memo-availability-v1',
  plant: 'ZIS Solar',
  recordedAt: '2026-10-12T18:02:31.000Z',
  source: 'user-confirmed',
  thresholdEurMwh: 0,
  comparison: 'strictly-less-than',
  physicalControl: false,
} as const;

/** Price observations after the origin cannot influence a day-ahead decision. */
export function negativeMemoDecision(
  prices: ForecastPrice[],
  start: string,
  originAt: string,
) {
  const origin = Date.parse(originAt),
    target = Date.parse(start);
  const eligible = prices.filter(
    (p) =>
      Date.parse(p.start) === target &&
      Number.isSafeInteger(p.eur_cents) &&
      Number.isFinite(Date.parse(p.fetched_at)) &&
      Date.parse(p.fetched_at) <= origin,
  );
  const latest = Math.max(...eligible.map((p) => Date.parse(p.fetched_at)));
  const versions = eligible.filter((p) => Date.parse(p.fetched_at) === latest);
  if (
    !Number.isFinite(target) ||
    !Number.isFinite(origin) ||
    !versions.length ||
    new Set(versions.map((p) => p.eur_cents)).size !== 1
  )
    return { state: 'unknown' as const, memoEurMwh: null, receivedAt: null };
  const price = versions[0];
  return {
    state:
      price.eur_cents < 0 ? ('negative' as const) : ('nonnegative' as const),
    memoEurMwh: price.eur_cents / 100,
    receivedAt: new Date(latest).toISOString(),
  };
}

/** Separate prospective comparison. The official payload remains untouched. */
export function makeAvailabilityCandidate(
  forecast: ForecastPayload,
  prices: ForecastPrice[],
) {
  if (
    Date.parse(forecast.issuedAt) <
    Date.parse(ZIS_AVAILABILITY_POLICY.recordedAt)
  )
    return null;
  const date = addDays(localDate(forecast.issuedAt), 1);
  const day = forecast.days.find((d) => d.date === date);
  if (!day) return null;
  return {
    policy: ZIS_AVAILABILITY_POLICY,
    issuedAt: forecast.issuedAt,
    date,
    baselineVersion: forecast.version,
    baselineId: forecast.id,
    appliedToOfficial: false,
    gridNoticeAdjustment: 'unconfirmed-not-applied',
    hours: day.hours.map((h) => {
      const price = negativeMemoDecision(prices, h.start, forecast.issuedAt);
      const known =
        h.priceSource === 'official' &&
        price.memoEurMwh !== null &&
        h.memo !== null &&
        Math.round(h.memo * 100) === Math.round(price.memoEurMwh * 100);
      const expectedShutdown = known && price.state === 'negative';
      return {
        start: h.start,
        end: h.end,
        controlKwh: h.productionKwh,
        predictionKwh:
          h.productionKwh === null
            ? null
            : expectedShutdown
              ? 0
              : h.productionKwh,
        expectedShutdown,
        memoEurMwh: known ? price.memoEurMwh : null,
        priceReceivedAt: known ? price.receivedAt : null,
        reason: known
          ? expectedShutdown
            ? 'confirmed-negative-memo-policy'
            : 'nonnegative-memo'
          : 'price-not-known-at-origin',
      };
    }),
  };
}
