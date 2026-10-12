# Full-history forecast evaluation — frozen before scoring

Requested on 12 October 2026: include every available plant month, not just October. The measured range is 3 April–11 October 2026. Exclude the unfinished 12 October. Preserve missing hours as missing, and valid measured zeros as zeros.

Use original NOAA GFS previous-day 12 UTC forecasts, cutoff 18 UTC, native hourly DSWRF. Download only indexed GRIB byte ranges, verify initialization, averaging intervals, publication headers, point geometry and hashes. Reuse the already archived August–October files. [NOAA public archive](https://registry.opendata.aws/noaa-gfs-bdp-pds/); [official product inventory](https://www.nco.ncep.noaa.gov/pmb/products/gfs/). No paid source, three-hour aggregation or observed target-day weather.

Two separately labelled tracks:

1. **Historical reconstruction with the current measurement archive.** At each daily origin use only measurements from completed earlier local days. Some of these values were imported/revised later: this is an explicit counterfactual data-availability assumption, never an as-issued forecast score. It permits seasonal diagnostics before CRM receipt tracking began on 8 September.
2. **Receipt-causal replay.** Use only the latest completed revision actually received before each origin, with the same earlier-day restriction. Show unavailable early months explicitly; do not invent receipt dates. Even these are newly reconstructed forecasts, not forecasts actually issued historically by this CRM.

Keep the existing 14 site features and fixed model parameters. Compare positive quadratic Ridge (alpha10) and CatBoost MAE (160 trees, depth4, learning rate0.05, l2=10, seed42, no bootstrap/random strength), each with a rolling45-day window and an expanding window using all available earlier history. Fit scalers/polynomials only on each fold's training rows. Require at least120 daylight training hours spanning10 days; bound predictions to0–875kWh and nighttime to0. No new hyperparameter search. No target-day fit, future revisions in causal mode, random split, whole-archive scaler or re-exported live artifact.

Use the currently verified Resen coordinates and875kW AC limit consistently. Historical changes to installed capacity/layout have not been established; this fixed-plant assumption is part of the retrospective test, not a newly verified historical fact.

Evaluate each available day after warmup; report paired monthly and total hourly WAPE, 100−WAPE bounded display scale, MAE, RMSE, measured/predicted MWh, signed bias, sample coverage and unscored days. Daylight means clear-sky GHI>0, plus any positive measurement at night. Common masks across the four algorithms; never average daily WAPE to get monthly WAPE. Compare against v3.2 only for identical previously preserved hours where that control exists, explicitly reporting its narrower period.

The user confirmed a July interruption on12October but gave no exact hours. Keep July zeros in all training and primary scores. Additional diagnostic excludes the whole July month plus previously confirmed11/12September days; label this as a broad exclusion, not exact outage detection. The confirmation is not backdated or used in a historical forecast input. Missing measurements remain excluded, with counts.

This test expands evidence, not an automatic promotion. April–August errors have not previously been evaluated by these candidates in this project; September/October have been examined repeatedly. Report all four fixed results; do not select and re-tune on the best full-history score. A change to the official model still needs independent prospective evidence, with the existing trials preserved. No new cron or SQL polling.

Archive inputs, measured revisions, original weather metadata, code hashes, fold provenance, predictions and verification append-only in SQL, and update PROJECT_CONTEXT.md. Do not change readings, revenue, historical original forecasts or production model parameters.
