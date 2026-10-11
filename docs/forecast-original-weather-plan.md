# Original ICON/GFS comparison — 11 October 2026

This is a diagnostic comparison on an already inspected difficult day, not a new
holdout. Preserve unmodified original forecasts and their actual download times.

1. Archive ICON-EU 10 October 18 UTC, 11 October 00 UTC and 06 UTC while the
   original rolling files remain available. Archive GFS native hourly DSWRF from
   identical initializations. Neither source is a weather reanalysis.
2. Use common issuance cutoffs of initialization + 4 hours. Check every file's
   original Last-Modified time is no later than that cutoff. Later files are
   ineligible. Keep original issuance, publication and today's receipt separate.
3. De-average original accumulated means, use the same prior-day empirical
   plant calibration and the same archived temperature/wind for both radiation
   providers. No fitting on 11 October. Report v3.2 separately for context;
   its older run/gain is not a controlled comparison with fresher weather.
4. Compare only common measured, completed hours after the cutoff, including
   valid daytime zeros. Report WAPE, RMSE, bias, pair counts and hourly values.
5. Replay the deployed v3.4 short-term calculation on original ICON with archived
   Huawei and satellite inputs. Historical Huawei receipt is unknown: show
   both 5 and 10 minute assumptions; satellite creation + 2 and +10 minutes.
   Do not backdate the archived records or call these prospective results.
6. A single selected day cannot authorize promotion of a provider or retuned
   model. Any implementation correction must have an independent mathematical
   or source-contract justification, and retain unchanged scoring semantics.

Only existing measurement downloads are used; no extra Huawei quota, new
background schedule, plant control, paid service or rewritten chart forecast.
