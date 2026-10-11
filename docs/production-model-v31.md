# Production model v3.1 — 11 October 2026

The production model now calibrates from recent complete **daylight** measurements and prefers free NOAA GFS surface shortwave radiation (DSWRF) over a cloud-fraction proxy. Model version `weather-solar-v3.1`; retrospective replay `weather-solar-v3.1-gfs-dswrf-replay-v1`.

## Diagnosis and changes

The previous training selector required all 24 production hours, including night. Huawei often returns null night production while its daylight measurements are complete. This discarded recent days, leaving nearly identical, older calibration coefficients throughout 1–10 October. The new selector requires every training-relevant hour (Haurwitz clear-sky GHI ≥ 50 W/m²), using up to 14 most recent complete solar days within 45 days, with at least seven days. Night gaps remain null in the measurement archive. Current and future days cannot enter training; recorded zeros are retained. Training dates and coefficients are saved with each forecast. The existing export-ratio estimator and financial contract are unchanged.

Cloud cover alone does not identify cloud optical thickness. In particular, the old cloud-fraction proxy heavily underestimated 7 October. GFS DSWRF directly forecasts downward shortwave radiation at the surface. The free UCAR THREDDS mirror supplies a small point subset at 41.0 N / 21.0 E near the verified plant GPS. MET still supplies temperature, wind and other weather context. SILAM remains available for context and fallback hours; its attenuation is not applied a second time to GFS radiation.

## Time and energy handling

- Select an explicit allowlisted GFS run from the catalog; never use `Best` across historical runs. Reject future runs and runs older than 24 hours.
- Validate the radiation unit `W.m-2`, CF time metadata and geographic point. Archive CSV, DAS metadata, `time_bounds`, run identity and retrieval time.
- NCSS reports interval **midpoints**. Match each label to its actual CF start/end bounds. GFS contains overlapping three-hour and six-hour means. Recover the latter three hours using `mean(second 3h) = 2 × mean(6h) − mean(first 3h)`.
- Allocate each non-overlapping three-hour radiation integral to hourly slots using the local clear-sky solar-geometry weights. Preserve energy; this does not infer real sub-hour cloud motion. Missing first halves, invalid negative derived means and incompatible metadata are rejected.
- Convert irradiance to AC energy using the calibrated plant response and existing temperature/wind model; cap hourly energy at the confirmed 875 kW AC × 1 h. DC size, tilt and azimuth remain unknown.
- GFS failure or uncovered hours retain an explicitly labelled MET cloud/fog/SILAM proxy; never invent actual readings or repeat an old production profile.

## Measured retrospective comparison

[Reproducible paired audit](production-improvement-v31.json), using 129 matched completed hours on **1–10 October**, 39.25359 MWh measured production:

| Metric | Previous model | v3.1 replay |
| --- | ---: | ---: |
| Hourly WAPE | 26.04% | 11.79% |
| Display match score, max(0, 100 − WAPE) | 73.96% | 88.21% |
| Hourly MAE | 0.07923 MWh | 0.03587 MWh |
| Hourly RMSE | 0.12030 MWh | 0.06544 MWh |
| Hourly signed bias | −0.06857 MWh | +0.01996 MWh |

Relative MAE reduction: **54.72%**. The new model's summed prediction on these paired hours is 41.82808 MWh, versus 30.40836 MWh before. Mean bias remains positive.

Daylight-selection-only ablation, with the original cloud proxy: WAPE 15.72%, MAE 0.04785 MWh. GFS radiation plus daylight selection achieves the additional reduction above. On 7–10 October, WAPE falls from 50.89% to 27.78%, but **8 and 9 October individually worsen**. Do not claim uniform daily improvement.

This is a retrospective diagnostic comparison, **not an independent holdout**: October errors were inspected before selecting the changes. Each simulated origin uses only original prior-day 12 UTC GFS forecasts and Huawei revisions available before the prior-day 18 UTC cutoff. Target production is not used to fit coefficients. The six-hour publication allowance is an assumption; original dissemination timestamps were not independently archived. Weather in the replay is GFS, while live temperature/wind remain MET. Ten October days cannot establish seasonal, multi-day or prospective accuracy. The 88.21% match score is descriptive, not a probability or guarantee.

Old forecast and replay records remain immutable. The new retrospective snapshot is a separate row; its latest replay can be shown on the comparison chart. True forecasts saved before a target hour retain priority over a reconstruction. Prospective validation remains version-specific in the forecast panel.

## Persistence and operation

No schema migration or new cron. Existing forecast schedule and admin refresh generate and save the new model. Shared radiation cache: three hours, fresh run ≤ 24 hours; provider failures cached for 15 minutes. All source requests are server-side, bounded and use fixed UCAR endpoints. Normal warm reads use the existing shared forecast cache rather than querying SQL or weather providers per user.

Original NOAA GRIB byte ranges, point values and SHA-256 provenance are archived by `scripts/download-gfs-radiation.py`. `scripts/replay-production.mjs` saves append-only replays with those source inputs; `scripts/evaluate-production-improvement.mjs` reads paired old/new results and actual measurements without changing them. Production persistence receipts are stored separately from the baseline audits.

## Sources

- [NOAA GFS DSWRF inventory](https://www.nco.ncep.noaa.gov/pmb/products/gfs/gfs.t00z.sfluxgrbf001.grib2.shtml): surface downward shortwave radiation and averaging intervals.
- [UCAR / Unidata NCSS reference](https://docs.unidata.ucar.edu/tds/5.6/adminguide/netcdf_subset_service_ref.html): point and time subsetting.
- [Explicit GFS catalog](https://thredds.ucar.edu/thredds/catalog/grib/NCEP/GFS/Global_0p25deg/catalog.html): run selection; raw run metadata are saved in each live forecast.
- [Prior model sources and limitations](forecast-weather-research.md): clear-sky model, empirical calibration, MET and SILAM.

Remaining useful improvements require longer prospective comparisons, confirmed panel DC capacity/tilt/azimuth, and information about shading, curtailment and outages. No plant-control actions are performed by this model.
