# Hourly WAPE target — v3.2 (11 October 2026)

The dashboard now separates signed **total difference** from **hourly WAPE**. Both use identical completed, measured hours. Missing values and unfinished hours are excluded; double-zero hours do not inflate the sample count. A total can differ from the live Huawei meter because the meter includes a different measurement window.

For 11 October at 18:42 UTC: actual 1.763050 MWh, predicted 1.664068 MWh, net difference −0.098982 MWh (−5.6143%). Hourly WAPE is 39.4855%. Morning overprediction and midday underprediction cancel in the daily sum, but not in WAPE. The ambiguous headline “match = 100 − WAPE” was removed.

## Model change

v3.2 retains v3.1's solar/weather baseline and adds a day-ahead calibration targeting `Σ|actual − factor × baseline|`. On fixed hours, minimizing this numerator also minimizes WAPE. The unbounded optimum is the weighted median of `actual/baseline`, weighted by baseline energy. The factor is restricted to 0.7–1.3. One parameter was preferred to fitting separate hourly factors to the very short available history.

- Use up to 30 days; exclude the unfinished origin day. Require at least three training days and 30 paired hours, complete baseline coverage and all expected daylight measurements. NULL is never zero.
- Validate chronologically: for each validation day, refit using only measurement revisions that existed before its forecast origin. Require at least three validation days and 30 hours; use the latest six eligible validation days.
- Apply only if candidate WAPE is at least **2% relatively lower** than baseline WAPE on the same validation hours. Otherwise factor=1. This gate is a historical acceptance check, not a guarantee.
- Apply only to the next day's empirical GFS production. Do not extrapolate the fitted correction to days 2–7, MET cloud fallback or physical GTI. Preserve the AC limit.
- Keep `baseProductionKwh` and corrected production in every immutable run. Fit subsequent calibrations to the uncorrected baseline, avoiding feedback drift.
- Prefer first day-ahead prospective baselines from compatible model/configuration; bootstrap with the explicitly labelled v3.1 GFS replay when prospective data are absent. Preserve replay origins as simulations, never backdate forecast issuance.
- Persist coefficient, acceptance status, training dates, validation results, exact predictions and measurement revisions in `forecast_runs.payload/inputs`. No schema change, added polling or extra cron. Three bounded archive queries run during the existing forecast refresh only. Warm page reads still use shared cache.
- The Forecast page shows baseline → corrected WAPE for new prospective day-ahead predictions from the same model/configuration. A zero sample displays unavailable, not 100% accuracy.

## Evidence and limitations

Read-only audit: [hourly-wape-v32.json](hourly-wape-v32.json); reproducible script: `scripts/evaluate-hourly-wape.mjs`.

| Paired sample | Baseline WAPE | Gated v3.2 WAPE |
|---|---:|---:|
| 1–10 October, 129 hours | 11.7879% | 11.5213% |
| 11 October, 13 hours | 39.4855% | 40.8213% |

The guarded model only starts applying the correction on 9 October because earlier folds have insufficient validation. Across 1–10 October, improvement is **0.2666 percentage points / 2.26% relative**. It **worsens 11 October** by 1.3358 percentage points. The unguarded exploratory correction gave 10.34%, but that is **not** the deployed policy's score.

The latest six validation days, 5–10 October (77 hours), give 18.8243% → 16.0910%; tomorrow's accepted factor is 0.949497. These are historical validation numbers, not the overall deployed improvement. October was examined during development, so this is not an independent holdout. Live MET temperature/wind also differs from the GFS replay. Future prospective baseline/corrected errors must be assessed on the same hours.

A gain correction cannot predict cloud arrival times. GFS here still has a 0.25° weather grid and 3-hour radiation means allocated by solar geometry. NOAA offers hourly GRIB products, but the current free UCAR point service exposes 3-hour output; no hourly-cloud or satellite claim is made. Panel DC rating/tilt/azimuth remain unverified.

The old historical curve remains unchanged. A new model's historical result is not substituted for an earlier issued forecast just to improve displayed accuracy.

## Source reliability fix

During integration, the 11 October 12 UTC GFS run changed the DSWRF coordinate from `time/time_bounds` to `time1/time1_bounds`. The v3.1 hardcoded request returned HTTP 400, triggering the cloud-based fallback. The parser now discovers DSWRF's CF time coordinate and bounds from the same run, validates units/run/bounds, then fetches that bounds variable. No arbitrary path or query from external metadata is accepted. Cache namespace `gfs-v2` avoids retaining failed v1 entries. Verified against the real 12 UTC run: 216 radiation hours; existing midpoint/de-averaging checks still apply.

## Sources

- [Forecasting: Principles and Practice — time series cross-validation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation): chronological evaluation with observations available before each origin.
- [NOAA NOMADS](https://nomads.ncep.noaa.gov/): availability of GFS 0.25° hourly products.
- [UCAR GFS catalog](https://thredds.ucar.edu/thredds/catalog/grib/NCEP/GFS/Global_0p25deg/catalog.html): actual free point-data source and forecast runs.
- [Unidata NetCDF subset service](https://docs.unidata.ucar.edu/tds/5.6/adminguide/netcdf_subset_service_ref.html): service metadata and point extraction.

## Verification

138 tests passed (59 forecast); production build/TypeScript and targeted lint passed. New regression tests cover net error cancellation versus WAPE, hourly L1 fitting, chronological revision cutoffs, missing daylight/insufficient history, rejection of harmful correction, prospective precedence, horizon/source restrictions and changing CF time axes. Isolated Neon test branch persisted v3.2 run `6b1774a0-4dff-4d53-b1b6-c7d6906a0b24` with verified inputs, baseline and corrected totals. Measurements, prices and historical replays retained identical fingerprints. Branch warm reads use SQL because production Redis is deliberately disabled there; production cache verification is recorded separately.

Production: code `9879ffe`, deployment `dpl_9hJ5zWyC5HX1WAN8KbFxHByUokYq` READY. Run `0143246b-bf2e-4369-aae4-82ab74302b55` issued 18:50 UTC; [persistence receipt](production-v32-persistence.json), [release receipt](production-v32-release.json). Exact calibration inputs were read back from SQL. Warm cached dashboard plus forecast reads used zero SQL queries. Preview checked MK/EN, 390px mobile layout and scrollable popover, with no page overflow or browser errors.
