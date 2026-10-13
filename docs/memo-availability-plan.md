# Negative MEMO availability — fixed diagnostic protocol

12 October 2026, before scoring. The user confirms the operating rule is shutdown when **MEMO < 0 EUR/MWh**, with no inverter control. Zero MEMO and a positive MEMO with a negative contract net price do not activate this rule. No threshold tuning or inference from the target's actual production is allowed.

Prospective version `negative-memo-availability-v1` is recorded from 12 October 18:02:31 UTC. Save its separate next-day predictions in the existing forecast input snapshot alongside the unchanged official v3.2 baseline. Apply only to the configured ZIS owner. Use an official price actually received by the forecast origin and consistent with that hour's official price in the baseline. Missing/forecast prices and missing production remain unchanged/unknown. No grid outage adjustment until the feeder/location and source timestamps are verified. No old forecast or actual is rewritten.

For historical diagnostics, export the current durable price rows and append-only price revisions once, retaining their genuine known times. Report two clearly separated cases on the original full-history CatBoost-all scored cohorts (archive-reconstruction and receipt-causal) and the matched October v3.2 baseline:

1. **Historical price reconstruction**: use the latest stored historical price regardless of receipt, explicitly assuming it was available and today's stated shutdown rule also applied historically. This is a sensitivity test, not a causal score or prospective improvement claim.
2. **Price receipt-causal**: only a price revision demonstrably available by previous-day 18 UTC may change the prediction. Still label the historical policy assumption because user confirmation is new. If no eligible price exists, preserve the original prediction. Keep all original targets, including shutdowns and restarts.

Report price coverage, changed hours and dates, actual energy on changed hours (policy exceptions), WAPE, MAE, RMSE, MWh bias and matched controls for every available month. Never relabel retrospective confirmation or the newly supplied September screenshot as data received before those old forecast origins. The user-provided screenshot documents a planned 12 September 07:00–12:00 interruption for the Municipality of Resen and named routes; actual inverter evidence extended to around 17:00. Planned duration is not actual duration.

No model refit, sweep, automatic model promotion or physical plant action. This experiment is separate from the already frozen GFS surface-flux comparison.
