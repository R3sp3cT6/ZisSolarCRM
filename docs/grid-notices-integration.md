# Day-ahead grid availability — 12 October 2026

The user reports that negative MEMO prices are published the previous day and that planned regional outages are usually announced by EVN. This is evidence that availability may be partly knowable before delivery. The user subsequently confirmed shutdown at MEMO < 0 EUR/MWh, without inverter control. The exact feeder mapping remains unknown.

## Verified public source

- [EVN FAQ](https://www.evn.mk/faq-qa.aspx?cat=9) states planned interventions are announced at least 24 hours ahead.
- The [official outage map](https://elektrodistribucija.mk/Grid/OutagesMap.aspx) loads the public JSON service `https://portal-api.elektrodistribucija.mk/DSO/Prekini/ZemiPrekini`.
- A real request at **2026-10-12 17:57:11 UTC** returned HTTP 200 and 71 planned notices, with start dates from 12 October to 6 November. Fields include an ID, customer center ID, type, settlement, location, start, end and voltage level.
- No returned settlement/address contains `Ресен` or `Resen`. This is only a text search, not proof that the plant has no planned interruption. The plant may be identified by another settlement, transformer or feeder.
- The service has no notice publication timestamp, coordinates, cancellation flag or revision ID. The observed response also has no Last-Modified/ETag. It is a current list, not a verified historical archive.
- Source start/end values have no timezone offset. Keep the original wall-clock strings and seconds. No automatic UTC conversion or application to production is enabled until time semantics and the connection mapping are verified. In particular, do not silently resolve the repeated DST hour.

## Implemented collection

`fetchGridOutages()` makes one bounded, credential-free request alongside each existing non-deduplicated forecast run. The existing forecast INSERT stores the exact decoded JSON, its byte SHA-256, actual request/receipt times, normalized notices and source URL in `forecast_runs.inputs.gridOutages`. There is no separate poller, cron, SQL write or database wake-up for this source. Existing forecast cache reads and deduplicated runs do not fetch it.

Collection errors are archived as unavailable; they are not interpreted as a confirmed empty outage schedule. Non-JSON, oversized, malformed, duplicate-ID or invalid interval responses are rejected. A valid empty list remains distinguishable from a failure. This is optional evidence: an unavailable public feed does not prevent the weather forecast.

The collector is **observation only**: `appliedToForecast=false`, `applicability=unconfirmed`. It does not change production, revenue, the official v3.2 forecast, any score or inverter state. Public notice data stays in internal inputs, not the forecast API payload.

## Before using notices in predictions

1. Confirm the plant's settlement and electrical feeder/transformer. Geographic proximity or the word Resen alone is insufficient.
2. Verify source timezone semantics; use interval overlap, retaining planned boundary uncertainty. An announcement is not proof of the actual shutdown/restart instant.
3. Confirm the actual operating rule for negative MEMO versus negative net selling price versus manual decisions. The user subsequently confirmed MEMO < 0 EUR/MWh; the separate prospective candidate is described in `memo-availability-plan.md`. No physical controls are part of this work.
4. Freeze notices, applicability decisions, price observations and policy versions before the forecast origin. A notice first collected today cannot be treated as known in July or September. Missing historical notices remain unknown, not normal operation.
5. Evaluate availability-adjusted forecasts as a separate day-ahead candidate against the unchanged control on the same measured hours, including outages and unexpected restarts. Report changed hours, coverage, WAPE and energy error separately.

This integration provides prospective evidence; no new accuracy improvement is claimed. The fixed, full-range GFS surface-flux experiment continues separately without adding this unvalidated feature.
