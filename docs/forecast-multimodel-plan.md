# More independent weather models — 11 October 2026

User request: combine more free providers to improve production accuracy.

This first comparison is diagnostic, not a new holdout or a model promotion.
11 October has already been examined. Do not fit weights on this day.

## Verified sources

- DWD ICON-EU and NOAA GFS: existing archived original native-hourly solar
  fields. Different underlying models, not two wrappers of the same forecast.
- Météo-France ARPEGE Europe: public 0.1-degree SP1 GRIB2 packages cover Resen.
  `ssrd` is accumulated downward shortwave energy, J/m², at native hourly
  horizons 1–48. Adjacent totals / 3,600 give hourly mean W/m². Do not use
  surface net radiation instead. A nearest grid point is an atmospheric model
  estimate, not a measurement on the panels.
  [Official catalogue](https://www.data.gouv.fr/datasets/paquets-arpege-resolution-0-1deg),
  [parameter documentation](https://static.data.gouv.fr/resources/paquets-arpege-resolution-0-1deg/20240228-193031/description-paquets-modele-arpege.pdf).
  Free Open Licence 2.0, attribute Météo-France/source/date. The September
  cumulative API incident did not affect the packages and is marked resolved:
  [official notice](https://confluence-meteofrance.atlassian.net/wiki/spaces/OpenDataMeteoFrance/pages/1862467624).
- ECMWF IFS: free CC BY 4.0 open subset, 0.25 degree, 3-hour steps to 144h;
  AIFS has 6-hour steps. Useful auxiliary comparison but not a replacement
  for native-hourly cloud/radiation timing. Do not label interpolation as
  hourly source data. [Official source](https://www.ecmwf.int/en/forecasts/datasets/open-data).

## Frozen diagnostic

1. Add ARPEGE from exactly the same 10 October 18 UTC initialization to the
   existing ICON/GFS diagnostic. Require Last-Modified of every package no
   later than the shared 22 UTC cutoff. Keep actual download time separate.
2. Use the same historical plant calibration and archived temperature/wind,
   with no provider-specific fitting. Compare radiation sources in isolation.
3. Predefine three simple candidates: equal average of three; median of three;
   equal average of ICON + ARPEGE. These are untrained diagnostic baselines,
   not optimized weights. Keep all results, including worse ones.
4. One common completed-measurement mask for every candidate, including real
   zero output. Report WAPE, MAE, RMSE, bias and paired MWh/hour counts. Official
   v3.2 is contextual only: it used a different origin and GFS calibration.
5. Preserve original package checksums, extracted cumulative values, native
   hourly intervals, numeric plant/weather inputs, source code and outcomes.
   Binary packages stay locally; research records go to forecast_evaluations,
   never to the chart's forecast_backtests or into readings.

## Production design after source qualification

- Archive each model's forecast as issued, then compare the same measured
  production hours. Run identity, actual receipt, valid interval, native
  resolution, model/config version, source, grid point and fallback status
  must remain explicit. No hindsight weather or backdated receipt.
- Separate day-ahead weights from 0–1h / 1–3h intraday weights. Huawei and LSA
  SAF observations may correct future intraday forecasts, not yesterday's
  day-ahead prediction. Different API providers serving IFS are not independent
  extra votes.
- Start with individual, equal-average and median challenger forecasts.
  Learn nonnegative weights summing to one from prior days only (e.g. a rolling
  30-day window), with a minimum 14 complete days / 150 common daylight hours.
  Initially use global weights by horizon; avoid fitting weather-regime weights
  until enough examples exist. Preserve the strongest individual benchmark.
- Select weights using chronological training/validation, and require at least
  14 additional future days before a promotion decision. Examine WAPE, RMSE,
  signed energy bias, daily regressions, coverage and confirmed outages. A
  candidate must beat the strongest eligible individual, not merely old v3.2.
  These are proposed evaluation minima, not a guarantee of statistical power.
- Persist source runs, each model's kWh, combined kWh, weights and evidence.
  Show model spread as disagreement; it is not a calibrated probability band.
  Fall back to available qualified providers without interpreting missing data
  as zero. Avoid a silent switch when source sets change.
- Fetch on the existing bounded forecast refresh schedule, share cached model
  data across users, write during existing forecast runs. No extra background
  database polling. Large public packages need an ingestion budget before
  adding them to synchronous Vercel requests.

Current scope: source proof + reproducible comparison and SQL archive. No
automatic weighting or new production provider is activated by this experiment.
