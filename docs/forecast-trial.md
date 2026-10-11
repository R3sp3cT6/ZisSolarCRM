# ICON-EU, Huawei and LSA SAF trial — 11 October 2026

The official production forecast remains `weather-solar-v3.2`. The separate `weather-solar-v3.3-shadow` panel on Forecast saves prospective predictions for comparison; it does not replace real Huawei readings, revenue or historical simulations.

## Day ahead

DWD ICON-EU regional radiation at the nearest 0.0625° grid point (41.0625 N, 21.0625 E) supplies direct plus diffuse horizontal irradiance. ASWDIR_S and ASWDIFD_S are means since model start. Hourly flux is recovered as `n × mean(n) − (n − 1) × mean(n − 1)`. Missing adjacent means are not bridged. The previous v3.2 empirical plant curve and MET temperature/wind are retained; the GFS-specific fitted gain is not applied to ICON.

Both models are frozen together for tomorrow's 23/24/25 local hours. First-issued predictions are scored on the same completed measured hours; WAPE is not a probability or a guaranteed accuracy. Source run, acquisition time, extracted means, URLs, SHA-256 hashes, calibration and baseline snapshot are persisted in `forecast_trials.inputs`. No future observations enter an earlier forecast.

## Short term

Existing Huawei refreshes supply two complete inverter samples with genuine `collectTime`, active power and cumulative generation. Duplicate, missing, future, stale, stopped-inverter, reset-counter and unstable samples cannot produce a ready forecast. Expected power is approximated by interpolating ICON hourly averages at interval midpoints. The measured/expected ratio is clamped to 0.5–1.5, decays over 90 minutes, and respects the 875 kW AC cap. Four upcoming 15-minute intervals are saved separately; this heuristic has no demonstrated local skill yet.

Evaluation uses counter differences only when both 15-minute boundaries and the intervening five-minute samples exist, with consistent inverter counts and no counter reset. The first prediction per interval and 30-minute lead-time band is retained. Its comparator is uncorrected ICON, not the day-ahead v3.2 series. Sparse active-user sampling may leave many intervals unevaluable; missing observations are not zeros.

## LSA SAF connection

Server-only Basic authentication uses `LSA_SAF_USERNAME` and `LSA_SAF_PASSWORD`, stored as Vercel production Secrets. Credentials are never in URLs, SQL snapshots, Git, client bundles or browser storage. TLS certificate verification remains enabled and redirects are rejected. The public file catalog is read without credentials; authenticated requests go only to `thredds.lsasvcs.ipma.pt`.

MDSSFTD / LSA-207 NetCDF point subsets retrieve DSSF_TOT, FRACTION_DIFFUSE and quality_flag near Resen: **41.050003 N, 21.050003 E**. Validate the coordinates, variable units, scale factors, time origin and quality bits before use. NetCDF scaling is multiply by 0.1 for W/m² and 0.01 for diffuse fraction (different from the HDF5 divisor notation). Reject low-quality, failed or missing retrievals; night is explicitly labelled. A stale slot (>45 minutes) is not current radiation.

Verified daylight example: 2026-10-11 12:00 UTC slot (14:00 Resen), **442.3 W/m², 0.53 diffuse fraction, flag 9**, cloudy method processing OK. Night retrievals return 0 W/m² with flag 173. These are satellite estimates over a grid cell, not panel sensors. Slot time is the nominal scan reference; the northern image lines are acquired later (roughly up to 12 minutes according to the PUM), so it must not be mistaken for the exact plant acquisition second. Observed file production latency in these samples is about 17–18 minutes after the nominal slot; delivery latency can vary.

Satellite point data, metadata and raw OpenDAP ASCII subset are archived in `forecast_satellites` and trial inputs. **Satellite data currently provides observation/validation only; it does not yet adjust the numerical production forecast.** No optical-flow cloud motion or panel shadow tracking is implemented. Those require a regional image sequence, scan-time treatment and prospective validation, not simply another multiplicative cloud factor on already cloud-adjusted radiation.

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
