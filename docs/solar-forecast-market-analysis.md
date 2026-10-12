# A different forecast architecture for ZIS Solar

Research checked: 12 October 2026. Site: Resen, 41.068056N, 21.036111E, 875kW AC. Panel DC capacity, tilt and orientation remain unverified. This is not a promise of 100% accuracy.

## What the specialised services actually do

| Approach | Evidence | Implication for ZIS |
|---|---|---|
| Satellite cloud motion for minutes/hours; NWP blend for later horizons | [SolarAnywhere methodology](https://www.solaranywhere.com/support/forecast-data/model/) describes cloud motion for its short horizon and location/horizon-dependent NWP blending beyond it. | A next-hour correction and tomorrow's forecast must be separate products and separately scored. |
| Learned correction of weather-model errors | [Solcast's attention-based model](https://solcast.com/blog/how-we-improved-day-ahead-solar-forecasts-by-9--with-an-attention-based-model) uses multiple NWP inputs and satellite cloud-opacity targets. Its stated 9% relative GHI improvement concerns its North American evaluation. | More providers help only if their errors differ and local validation supports the blend. The provider's percentage does not transfer to Resen or mean nine accuracy points. |
| Local statistical postprocessing and ensembles | [IEA PVPS handbook, section 9.5](https://iea-pvps.org/wp-content/uploads/2024/09/Best-Practices-Handbook-for-the-Collection-and-Use-of-Solar-Resource-Data-for-Solar-Energy-Applications-Fourth-Edition-.pdf) discusses model output statistics, machine learning, blending, uncertainty and observation quality. | Learn this plant's response and retain paired forecasts and actuals. Do not optimise using later measurements. |
| Physical PV conversion | [pvlib ModelChain](https://pvlib-python.readthedocs.io/en/stable/reference/modelchain.html) connects irradiance, geometry, temperature and DC/AC models. [Forecast.Solar](https://forecast.solar/) also needs system configuration. | These are useful when hardware geometry is known; supplying guessed tilt/DC size would create false precision. |
| Generic time-series AI | [Google TimesFM](https://github.com/google-research/timesfm) and the completed local experiment in `timesfm-results.md`. | It did not outperform our baseline on the tested dates. Model size/name is not evidence of solar-forecast skill. |

These are methodology comparisons, not a procurement recommendation. Commercial satellite/NWP products have not been purchased. Public documentation is not an independent Resen performance audit.

## Chosen free implementation

Replace the candidate's hand-shaped response curve with a **supervised weather-to-power model specific to the plant**. Original NOAA GFS hourly radiation is the weather input; Huawei hourly production is the training label. The candidate learns nonlinear response to radiation, sun position, time of day, season and forecast radiation ramps. All weather features for a target day come from one forecast that was available before it.

This is substantially different from projecting yesterday's production or applying a scalar to v3.2. Compare three fixed, lightweight approaches: CatBoost MAE boosting, regularised quadratic regression, and nearest weather analogues. The pre-score selection and validation rules are in [the protocol](solar-learning-plan.md).

[NOAA documents native hourly GFS output through 120 hours](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gfs.php). We obtain the original hourly surface DSWRF records, check their interval metadata, and de-average adjacent forecast interval means. This does not make a 0.25-degree grid observe individual clouds above the panels. It removes an avoidable temporal-input limitation while retaining the real spatial limitation.

Training is local and isolated. Vercel runs only a small numerical artifact, without Python, GPU, model downloads or training on page requests. The artifact has a site/capacity check, fixed feature schema, training timestamp and seven-day expiry. No expired or incompatible model silently produces a valid-looking number. Future retraining is explicit; a frozen challenger is not advertised as self-updating.

## What still determines the achievable accuracy

- A cloud arriving at 11:00 instead of 12:00 can preserve daily MWh while creating a large hourly error. Better plant conversion cannot correct an unknown cloud arrival time.
- Original ICON-EU, GFS and ARPEGE live forecasts are already being archived. Their blend needs new common outcomes, not retrospectively invented forecasts for October.
- LSA SAF and fresh Huawei observations remain the short-horizon path. Observations collected during a target hour cannot be used to claim day-ahead accuracy.
- Unscheduled outages, curtailment, snow/soiling and meter revisions affect actual production. Confirmed old outages are not retroactively supplied as if known at the forecast origin.
- A full physical model requires measured hardware configuration. A learned response can accommodate local patterns but cannot identify the true panel geometry from this short archive.

## Validation and CRM behaviour

The fixed comparison separates **better weather resolution** from **better conversion logic**: preserved v3.2; native-hourly GFS with the old conversion/gain; and the three learned candidates. Scores use the same valid hourly actuals, not rounded daily sums. Candidate selection uses 21–30 September; 1–11 October is then scored chronologically. These dates have appeared in previous experiments, so this is exploratory historical evidence rather than an untouched holdout.

The selected candidate is a separate issued challenger in Forecast, with predicted MWh and matched prospective WAPE against v3.2. Historical scores stay labelled historical. Existing scheduled collection and shared cache are reused; no new database keep-alive or polling job. Original issued forecasts, billing calculations and historic measured production are never rewritten to make the new model look better.
