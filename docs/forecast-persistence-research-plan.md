# Persistence follow-up, specified before its scores

Exploratory only: all available September/October periods have already been
inspected. No fresh independent holdout is claimed. The response and regional
motion candidates failed promotion. The learned blend produced only a small
aggregate improvement and no October change, so it is not activated.

Potential issue in v3.4: variability reduces satellite influence to as little as
30% of its usual weight, preserving most of an earlier NWP forecast precisely
when local cloud conditions change. The two-point average also adds lag.

Two fixed physical alternatives will be reported on every same paired hour:

1. Latest valid CSI smart persistence, weight = 0.9 × exp(-ageMinutes/90),
   capped at 0.9; use the same two-frame quality/arrival/freshness gate and the
   existing empirical irradiance-to-AC conversion. No variability penalty.
2. The same weighting with a damped CSI trend. Bound change per 15 minutes to
   ±0.25; extrapolate by rate × 30 × (1 - exp(-ageMinutes/30)). Clip CSI 0–1.5.

No target-hour measurement or satellite image enters either prediction. Keep
the day-ahead baseline, unchanged v3.4, adaptive variant, fallbacks and outage
zeros in the report. Report September development and the previously inspected
September/October validation periods separately. Do not select constants from
a grid search or hide worse days. These are hypotheses, not proof of live skill.
