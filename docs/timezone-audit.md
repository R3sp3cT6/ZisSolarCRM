# Timezone and daylight-saving audit — 13 October 2026

Plant calendar: **Europe/Skopje** (Resen). Measurement identities and persistence use UTC instants. No fixed `GMT+2` conversion is used for ingestion. The Postgres session reports `GMT`, which is appropriate for UTC storage; it must not be changed to a fixed local offset.

## Verified against production

`scripts/audit-timezone.mjs` performs read-only SQL and public MEMO requests; it does not call Huawei, change prices or send notifications. The sanitized result is in `timezone-audit.json`.

- 4,087 hourly readings: all start keys, observation and update times are canonical UTC ISO strings, with hourly starts aligned to real UTC hours.
- 4,848 prices: canonical UTC keys/receipts; every `market_date` agrees with the Europe/Skopje date of its start.
- 8,070 inverter samples: stored in `timestamptz`; no receipt precedes measurement time. These checks validate timestamp representation, not the physical inverter's clock configuration.
- Postgres and Node/Intl agree immediately before and after both transitions in 2026 and 2027.
- The latest three scheduled daily archive jobs completed successfully at approximately 04:15 UTC.
- No existing measurement or price was shifted, deleted or rewritten during this audit.

On 29 March 2026, 01:59 local is followed by 03:00 (23 real hours). On **25 October 2026**, 02:59 summer time is followed by 02:00 winter time (25 real hours). The two autumn 02:00 starts are `00:00Z` and `01:00Z`, respectively. They remain different database, cache, chart and forecast keys. The same cases were tested for 2027.

## Bugs found and corrected

1. **MEMO spring placeholder:** the real weekly HTML for 29 March 2026 includes `0,00` for the nonexistent 02–03 interval. The old parser rejected the whole Sunday. The parser now ignores only that non-delivery zero; it retains all 23 real prices, including genuine zero and negative prices.
2. **MEMO autumn order:** the real 26 October 2025 HTML places `02x–03x` before `02–03`. The previous parser followed HTML order and therefore reversed those prices. The [MEMO Trader Manual, Appendix G, printed page 161 / PDF page 163](https://dam.memo.mk/wp-content/uploads/2023/04/ETS-Trader-Client-Guide-for-MEMO-3.6.8.pdf#page=163) shows ordinary 02 first and 02X second. The parser now maps the marker explicitly: 75.97 EUR/MWh at `00:00Z`, 73.97 EUR/MWh at `01:00Z`. Zero placeholders in the extra row on the other six days no longer invalidate those days. Malformed intervals, unexpected nonzero placeholders, missing prices and ambiguous extra values remain rejected.
3. **Repeated-hour display:** ordinary dates keep plain local time. Only the repeated autumn hour shows `02:00 (UTC+2)` / `02:00 (UTC+1)` in production/market charts and tables and forecast hourly labels. This does not restore a permanent GMT suffix.
4. **Manual import receipt:** a supplied `observedAt` must include `Z` or an explicit offset, like the measurement start already did. Offset-free wall times can no longer depend on the server's timezone. Omitting the field still uses the actual receipt time.

Original public table facts, source row order and raw-response hashes are retained in `tests/fixtures/memo-dst-*`. Replaying them now produces the complete 167-hour spring week and 169-hour autumn week. These are historical public-source fixtures, not fabricated production records.

## Schedules

[Vercel cron expressions use UTC](https://vercel.com/docs/cron-jobs#cron-expression-limitations). Existing local-clock jobs already include both seasonal invocations and reject the unused one before database access.

| Job | Summer in Resen | Winter in Resen |
| --- | --- | --- |
| Huawei/MEMO daily archive (04:15 UTC) | 06:15 | 05:15 |
| Next-day MEMO | 11:05, fallback 12:05 | 11:05, fallback 12:05 |
| Forecast | 08:20, 12:20, 18:20 | 08:20, 12:20, 18:20 |
| Daily push | 21:00 | 21:00 |

The daily archive is intentionally a fixed UTC job per README, not a promise of fixed 06:15 local time. No cron frequency or SQL wake-up policy changed. Live polling and provider quotas use elapsed milliseconds; their durations do not gain/lose an hour when the clock changes. Calendar-day requests and coverage use actual 23/24/25-hour slot boundaries.

The day-ahead evaluation cutoff remains **18:00 UTC**, explicitly documented as 20:00 summer / 19:00 winter. It is a fixed evaluation protocol and was not retrospectively shifted. Weather and satellite valid times remain UTC; source time bounds are mapped to the same UTC delivery intervals.

EVN notice strings still lack an offset and a verified publication timestamp. They are archived as source wall time and are **not** automatically applied to generation forecasts; this audit does not invent their timezone or prove plant/feeder applicability.

## Verification and limits

- Full suite: **227 tests passed**, including counter-derived energy, revenue, partial retention, forecast scores, import offsets, real MEMO fixtures and seasonal cron selections.
- Production build / TypeScript passed. Targeted lint for changed time/parser/audit/tests passed. Existing unrelated repository lint findings remain.
- Identical calendar/label outputs under host `TZ=UTC`, `Europe/Skopje` and `America/New_York`.
- Upcoming 25 October Huawei responses have not occurred yet. Transition behavior is regression-tested, not claimed as an already observed live transition.
- The earlier lag in current production was a history-fetch/partial-retention issue (previous release), not evidence of a two-hour timezone shift. This audit does not improve or re-score the forecast model; official `weather-solar-v3.2` remains unchanged.

Deployment/readback receipt is recorded in project context after release.
