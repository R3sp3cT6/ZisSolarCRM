# Adaptive satellite weighting — exploratory protocol, 11 October 2026

The regional-motion holdout is consumed. September 21–30 may no longer be called
independent validation for any new method developed after reading those results.
Motion failed promotion (only 0.0027 percentage points better WAPE, worse RMSE).
Keep it offline. Point satellite persistence improved GFS short-term WAPE from
30.7974% to 26.7928%, but still overpredicted cloudy days substantially.

Hypothesis: the fixed, conservative satellite blend leaves too much of an
incorrect earlier numerical-weather forecast during cloudy periods. Learn one
bounded strength from previous completed days; do not scale plant capacity or
change historical actual production. No cloud-advection term.

Fixed candidate strengths: 0.5, 1 (v3.4), 1.5, 2. At each integration point,
multiply the existing satellite weight by strength, capped at 0.95. Existing
quality/freshness guards, 120-minute decay and Huawei priority remain unchanged.

Use latest 14 completed local days whose actual revisions were available before
the issue time. Require ≥3 days and ≥30 paired intervals; choose minimum summed
absolute error with ties preferring 1. Validate that learning procedure on the
latest three eligible earlier days using only their prior records. Accept a
changed strength only if walk-forward MAE improves ≥2% relative to strength 1;
otherwise retain 1. Never train with unfinished origin-day intervals, future
receipts, known invalid counters, or a later revision of a past target.

Test all existing September days with walk-forward fits and all zeros/fallbacks.
This is additional exploratory retrospective evidence, not an unseen holdout.
Archive results regardless of outcome. A real-time trial must store the chosen
strength, training/validation evidence, all four alternatives and exact input
timestamps before outcomes arrive; it must be reported separately from v3.2
day-ahead forecasts. A future prospective check is still needed.
