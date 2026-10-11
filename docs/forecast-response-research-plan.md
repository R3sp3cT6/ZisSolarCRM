# Response-model validation protocol — 11 October 2026

The last satellite test (October 1–11) reduced total hourly WAPE only from
12.7807% to 12.6362%, while eight of eleven days became worse. This is not
enough evidence to promote the combined trial over v3.2.

## Next comparison, fixed before examining September model scores

- Development: already inspected October results plus September 8–20.
- Reserved evaluation: September 21–30, not used to choose parameters or
  variants. It is a retrospective disjoint evaluation, not prospective evidence;
  current code and plant configuration were designed after those dates.
- Obtain actual production revisions with arrival timestamps, archived
  previous-day 12 UTC GFS inputs, and original LSA SAF 15-minute point files.
  Preserve raw values, times, quality flags and hashes. Never overwrite measured
  data or the existing chart replay.
- Diagnostic: integrate satellite irradiance at its approximate MSG scan times
  over each actual delivery hour. Do not treat a point measurement as an hourly
  average or use radiation observed during a target hour to forecast that hour.
- Compare the existing empirical upper-envelope AC response with a bounded,
  one-parameter multiplicative correction learned from earlier measured hourly
  production and satellite-based energy. A second candidate may use three broad
  solar-time bins with shrinkage toward that same global correction. No invented
  installed capacity, tilt or azimuth.
- Choose the response variant using development data only. Freeze its constants
  and checksum before scoring September 21–30. At each origin calibration may
  use only records available before the origin, not final revisions or any
  target-hour observation. Assess sensitivity to assumed historical delivery
  latency, which was not logged at the time.
- Evaluate day-ahead GFS and short-term satellite updates separately on identical
  completed hourly pairs, reporting WAPE, MAE, RMSE, signed bias, coverage and
  every daily result. Include fallback hours and retain valid measured zeros.
  Do not infer day-ahead skill from an intraday comparison.
- Promotion requires improvement on the reserved period, with inspection of
  daily regressions and coverage. Otherwise retain v3.2 and use the failed
  hypothesis as evidence for the next change. Never rerun the same reserved
  period as an independent holdout after tuning against its results.

The active model-improvement goal remains open until a more accurate implemented
model is supported by appropriate evidence. The 0–100 UI scale is presentation,
not a change in forecast skill.

## Regional-motion candidate, specified before its development scores

The simple response corrections failed on September 9–20: WAPE 23.39/23.40%
versus v3.2 22.70%; adding them to satellite persistence also worsened WAPE.
They will not be promoted. User-confirmed interruptions on September 11–12
remain in primary scores and are excluded only in a separately labelled diagnostic.

Next hypothesis: point persistence misses approaching cloud fields. Use three
consecutive 15-minute LSA SAF regional maps, 25 × 33 pixels, approximately
130 × 130 km around Resen. Convert valid land irradiance to clear-sky index (CSI)
at each pixel's approximate scan time; missing/low-sun pixels are not zero.
This is regional irradiance-pattern advection, not cloud-height retrieval or
individual-panel shadow tracking. It uses the existing surface product rather
than inventing cloud optical thickness or a cloud altitude.

- Estimate translation by minimum mean squared difference over the common inner
  grid, searching ±6 columns / ±5 rows per 15 minutes. Require at least 150
  valid pairs, CSI standard deviation ≥0.05, correlation ≥0.65, speed ≤40 m/s.
  Nonzero shifts must reduce matching error by at least 15% versus zero shift.
- Require two consecutive vectors to agree within 2.5 pixels; combine 30% older
  and 70% latest. Correlation and vector agreement determine confidence, capped
  at 0.8. Predict by backward bilinear sampling of the latest grid. Out-of-grid,
  bad-quality or rejected motion falls back exactly to existing point persistence.
- Blend the advected CSI with the point CSI using that confidence; preserve the
  existing 0.75 maximum satellite weight, 120-minute decay, plant AC cap and
  empirical response. No new response fit and no target-hour observations.
- Replays use nominal slots 60/45/30 minutes before hour start; actual scan and
  original creation timestamps must precede issue time. Assumed historical
  receipt is creation +2 minutes, with a +10-minute sensitivity test.
- First evaluate September 9–20. Only if it improves on satellite persistence,
  freeze code hashes before September 21–30. Report all candidate regressions,
  application/fallback counts, the unchanged day-ahead baseline, and common pairs.
  A failure does not authorize tuning on reserved dates.

Method background: [Sirch et al. (2017)](https://amt.copernicus.org/articles/10/409/2017/)
and [Papachristopoulou et al. (2024)](https://amt.copernicus.org/articles/17/1851/2024/).
Those methods/results do not establish accuracy for this simpler local implementation.
