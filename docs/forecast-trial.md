# ICON-EU, Huawei and LSA SAF trial — 11 October 2026

The official production forecast remains `weather-solar-v3.2`. The separate trial is now `weather-solar-v3.4-satellite` (superseding v3.3-shadow). It saves prospective predictions for comparison; it does not replace real Huawei readings, revenue or historical simulations. Satellite irradiance now changes the numerical short-term forecast.

## Day ahead

DWD ICON-EU regional radiation at the nearest 0.0625° grid point (41.0625 N, 21.0625 E) supplies direct plus diffuse horizontal irradiance. ASWDIR_S and ASWDIFD_S are means since model start. Hourly flux is recovered as `n × mean(n) − (n − 1) × mean(n − 1)`. Missing adjacent means are not bridged. The previous v3.2 empirical plant curve and MET temperature/wind are retained; the GFS-specific fitted gain is not applied to ICON.

Both models are frozen together for tomorrow's 23/24/25 local hours. First-issued predictions are scored on the same completed measured hours; WAPE is not a probability or a guaranteed accuracy. Source run, acquisition time, extracted means, URLs, SHA-256 hashes, calibration and baseline snapshot are persisted in `forecast_trials.inputs`. No future observations enter an earlier forecast.

## Short term

Existing Huawei refreshes supply two complete inverter samples with genuine `collectTime`, active power and cumulative generation. Duplicate, missing, future, stale, stopped-inverter, reset-counter and unstable samples cannot produce a Huawei correction. Expected power is approximated by interpolating ICON hourly averages at interval midpoints. The measured/expected ratio is clamped to 0.5–1.5, decays over 90 minutes, and respects the 875 kW AC cap. Four upcoming 15-minute intervals are integrated in five-minute steps. With valid satellite data, a satellite-only correction can run without two Huawei samples; a known stopped/reset inverter blocks the combined result.

For two consecutive valid LSA SAF daytime slots, estimate the MSG acquisition time using PUM sections 6.2–6.3: project the point to the original MSG 0° full-disk line, then add `760 − line / 5` seconds. Do not use the remapped NetCDF row index. This is an approximation. Normalize each irradiance by instantaneous Haurwitz clear-sky GHI (minimum 50 W/m²), cap the index at 1.5, then weight the newer index 0.65 and older 0.35. Both actual `receivedAt` and file `createdAt` must precede issuance; the latest nominal slot must be at most 45 minutes old. Night, bad quality, wrong coordinates and gaps are rejected.

The persisted index predicts future GHI from future solar geometry, converted with the existing plant calibration and temperature/wind. Blend satellite power with ICON using `wS = 0.75 × max(0, 1 − ageMinutes / 120) × stability`, where stability is `max(0.3, 1 − |indexChange| / 1.5)`. For fresh Huawei data, `wH = max(0, 1 − leadMinutes / 90)`: combined power is `(1 − wH) × satelliteBlend + wH × ICONpower × HuaweiRatio`, subject to the AC cap. This is a convex combination of estimates, not multiplication of two cloud-loss factors. Coefficients were fixed before inspecting the satellite replay result. Day-ahead and seven-day forecasts do not use today's satellite index.

Evaluation uses counter differences only when both 15-minute boundaries and the intervening five-minute samples exist, with consistent inverter counts and no counter reset. The first prediction per interval and 30-minute lead-time band is retained. Every interval saves uncorrected ICON, the version without satellite, the combined prediction and an earlier v3.2 forecast when available. The v3.2 hourly mean is held constant within that hour, preserving its original hourly energy. v3.2 and combined WAPE use the same available subset and report its count. Sparse active-user sampling may leave many intervals unevaluable; missing observations are not zeros.

## LSA SAF connection

Server-only Basic authentication uses `LSA_SAF_USERNAME` and `LSA_SAF_PASSWORD`, stored as Vercel production Secrets. Credentials are never in URLs, SQL snapshots, Git, client bundles or browser storage. TLS certificate verification remains enabled and redirects are rejected. The public file catalog is read without credentials; authenticated requests go only to `thredds.lsasvcs.ipma.pt`.

MDSSFTD / LSA-207 NetCDF point subsets retrieve DSSF_TOT, FRACTION_DIFFUSE and quality_flag near Resen: **41.050003 N, 21.050003 E**. Validate the coordinates, variable units, scale factors, time origin and quality bits before use. NetCDF scaling is multiply by 0.1 for W/m² and 0.01 for diffuse fraction (different from the HDF5 divisor notation). Reject low-quality, failed or missing retrievals; night is explicitly labelled. A stale slot (>45 minutes) is not current radiation.

Verified daylight example: 2026-10-11 12:00 UTC slot (14:00 Resen), **442.3 W/m², 0.53 diffuse fraction, flag 9**, cloudy method processing OK. Night retrievals return 0 W/m² with flag 173. These are satellite estimates over a grid cell, not panel sensors. Slot time is the nominal scan reference; the northern image lines are acquired later (roughly up to 12 minutes according to the PUM), so it must not be mistaken for the exact plant acquisition second. Observed file production latency in these samples is about 17–18 minutes after the nominal slot; delivery latency can vary.

Satellite point data, metadata and raw OpenDAP ASCII subset are archived in `forecast_satellites` and trial inputs. **Satellite data now adjusts short-term production numerically.** No optical-flow cloud motion or panel shadow tracking is implemented: this is clear-sky-index persistence with decaying influence, not a cloud-motion model.

## Historical satellite-component evaluation

[Detailed paired results](satellite-replay-evaluation.json), [production persistence receipt](satellite-evaluation-persistence.json). The separate append-only `forecast_evaluations` table stores the report and all inputs, including 278 original satellite subsets/metadata, the frozen baseline replay, revisions and actual readings. It cannot overwrite the historical chart's `forecast_backtests` or prospective `forecast_trials`.

For 1–11 October, 142 identical completed hours: v3.2 replay WAPE **12.780715%**, satellite-on-v3.2 **12.636160%** (1.131% relative reduction, 0.145 percentage points). Satellite affects 107 hours; the other 35 retain baseline. MAE 36.917 → 36.499 kWh; RMSE 64.416 → 58.315 kWh. Signed total bias worsens: +5.180% → +8.083%. Only 3/11 days improve; 8 days worsen. On 11 October alone, WAPE 40.821307% → 34.397557%. This small overall gain does not justify replacing official v3.2.

At each hour start, use only earlier slots with original `date_created + 2 minutes <= origin`, then predict the full coming hour using twelve five-minute samples. Actual historical delivery timestamps are unknown; this modeled receipt time is applied only to a replay copy. The raw downloaded records retain their actual present-day receipt time. Production uses real receipt timestamps, with no override. Plant calibration and v3.2 gains use only earlier available revisions; target-hour satellite and production are excluded.

This is a retrospective **satellite-component** test on the archived GFS-based v3.2 background, not a full ICON/Huawei test: those historical short-term inputs are unavailable. October was inspected during prior development, so it is not independent holdout accuracy. Short-term updates have later observations than the day-ahead baseline and do not demonstrate improved day-ahead forecasting. Prospective combined-model WAPE must wait for future measurements. Scripts: `download-satellite-replay.mjs`, `evaluate-satellite-replay.mjs`, `save-satellite-evaluation.mjs`.

## Operation

The Forecast page has an administrator-only “Refresh trial” button; viewers can read/refresh the saved view. Server-side admin, origin and rate-limit checks protect writes. The existing 08:20 / 12:20 / 18:20 local forecast cron also calculates the trial. No new cron or continuous polling was introduced.

Satellite source data has a shared 15-minute Redis cache. Existing active Huawei refreshes queue short observations and satellite points; SQL flushing follows existing archive activity or the forecast calculation. Day-ahead inputs persist immediately during the scheduled/manual calculation. Failures leave the queue retryable. Warm trial reads use Redis; cold cache or explicit calculation can wake Postgres. Short-term collection requires the configured shared Redis; it is skipped when Redis is absent. The UI marks stale short-term output and has no fabricated WAPE before outcomes arrive.

Sources:

- [DWD ICON-EU open data](https://opendata.dwd.de/weather/nwp/icon-eu/grib/)
- [DWD ICON tutorial](https://www.dwd.de/EN/ourservices/nwp_icon_tutorial/pdf_volume/icon_tutorial2025_en.pdf?__blob=publicationFile&v=3)
- [LSA SAF radiation products](https://lsa-saf.eumetsat.int/en/data/products/radiation/)
- [LSA-207 Product User Manual, issue 3, tables 3–4 and section 6.3](https://nextcloud.lsasvcs.ipma.pt/s/bA9gYoa5mQX2yJw)
- [Official LSA SAF data access examples](https://gitlab.com/helpdesk.landsaf/lsasaf_data_access)
- [LSA SAF access/licensing](https://lsa-saf.eumetsat.int/en/data/data-access/): MDSSFTD was provided by EUMETSAT LSA SAF, CC BY 4.0.
