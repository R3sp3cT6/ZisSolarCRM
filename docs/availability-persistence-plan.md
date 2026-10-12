# Day-ahead persistence of near-zero plant response

12 October 2026. Fixed diagnostic experiment before execution; no model promotion or retrospective removal of outages. The primary goal remains monthly hourly WAPE below 5% for forecasts issued the previous day by 18 UTC.

The existing full-history CatBoost uses weather and solar geometry. Its operational-training ablation only changed past training rows. Neither experiment explicitly persists an already observable, prolonged near-zero plant response into the next delivery day. This is a distinct causal hypothesis, not knowledge of tomorrow's inverter state.

Use the already frozen full-history inputs and CatBoost-all predictions. Do not refit, alter GFS inputs, touch the ongoing surface-flux experiment, or alter target measurements. Compare the original predictions with one fixed candidate: predict zero for the next day only when **both of the last two fully completed local calendar days before the issue time** meet all these conditions:

- Every daylight hour (original clear-sky value above zero) has a finite valid production measurement, from 0 through the known 875 kWh AC hourly bound.
- At least three of those hours have original forecast GHI of at least 300 W/m².
- Production in every daylight hour is at most 1% of the known AC capacity (8.75 kWh per hour).

Otherwise preserve the complete original prediction unchanged. At previous-day 18 UTC, the current local calendar day is unfinished, so the most recent eligible full day is delivery day minus two. No missing hours are filled with zero, no target-day data or later inverter statuses enter the rule, and no known interruption dates are used to select days. This flag is a **near-zero response persistence hypothesis**, not proof of commanded shutdown or proof of tomorrow's availability. Severe clouds and unexpected restarts can make it wrong; those errors remain scored.

Run two existing tracks: archive reconstruction explicitly assumes historical measurements were available, whereas receipt-causal uses only the last completed revisions actually received before the origin. Retain every original scored target hour, including outages, and the same origins. Report triggered dates, full provenance of prior measurements, retained/changed predictions, all-month WAPE, matched October v3.2 comparisons and failures on restarts. No threshold sweep or change after reading the result. Preserve the original benchmark exactly.

A retrospective improvement is not a verified future monthly accuracy claim. The result determines whether this causal factor merits a prospectively issued trial, not whether the goal is complete. Store inputs, policy/code, outputs and independent verification append-only in SQL.
