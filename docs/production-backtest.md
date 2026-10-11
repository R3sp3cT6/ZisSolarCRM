# Historical production simulation — October 2026

Implemented and saved on 11 October 2026. This is a retrospective replay for **1–11 October**, not a forecast that this application issued on those dates. The current model and settings were selected afterwards. It is stored separately from prospective forecasts and must never improve their reported accuracy retroactively.

## Sources and information cutoff

- [NOAA GFS public archive](https://registry.opendata.aws/noaa-gfs-bdp-pds/): original prior-day **12 UTC** GFS runs, 0.25° grid, without credentials or a paid subscription. NOAA permits use of these data and requests attribution; no NOAA endorsement is implied.
- Each day uses an **18 UTC prior-day information cutoff**. The six-hour allowance for run publication is an explicit conservative assumption; historic dissemination timestamps were not independently archived.
- Instantaneous total cloud cover, 2 m temperature and 10 m wind-vector components are read from forecast steps 9–36 at three-hour intervals. Averaged cloud fields are excluded. Point values are interpolated to delivery-hour midpoints, without extrapolation or bridging gaps longer than three hours.
- Resen plant: 41.068056 N, 21.036111 E. Nearest GFS grid point: 41.0 N, 21.0 E, approximately 8.15 km away. Three-hour model data cannot resolve individual cloud shadows on panels.
- The downloader preserves GRIB byte ranges and indexes locally. PostgreSQL stores decoded point inputs, source URLs, run/valid times, units, byte ranges and SHA-256 hashes, along with calibration inputs and outputs. It does not store the global GRIB fields.
- MET's current global endpoint cannot recreate exactly what it returned here before we started saving it. See [MET FAQ](https://docs.api.met.no/doc/FAQ.html). [Open-Meteo Single Runs](https://open-meteo.com/en/docs/single-runs-api) is another technical option, but its [free service terms](https://open-meteo.com/en/terms) do not cover this commercial CRM. That free API was not used.

## Calculation and leakage controls

`weather-solar-v3.0-gfs-replay-v1` reuses the current empirical solar model: integrated Haurwitz clear sky, cloud attenuation, temperature/wind cooling and the configured 875 kW AC cap. Historical fog and aerosol inputs are unavailable in this replay, so it uses the reference atmosphere. This is a **different weather-source configuration from the live MET/SILAM model**, not a measurement of that model's prospective accuracy.

For each simulated day, SQL selects the latest `reading_revisions` revision for each delivery hour **created before the information cutoff**. The model excludes both the target day and the unfinished origin day. Calibration uses at most 14 complete days from the preceding 45 days and requires at least seven. Incomplete days and missing inputs are never filled with zero. The saved training records include revision identifiers and creation timestamps for audit.

This prevents using later Huawei revisions or the target day's measured output for calibration. It does not eliminate retrospective model-selection bias: the model/settings were chosen now. No parameter was tuned against this October score during this task.

## Display and scoring

The pale red dashed series appears in both line and column views. Historical values are labelled **Historical simulation / Историска симулација**. Where a real pre-issued forecast exists for the same hour, it takes precedence. Mixed monthly views explicitly label the series as forecast / historical simulation. Daily/monthly aggregate forecast points require all their hourly inputs.

The score is calculated from paired, completed hourly readings in the selected period. It excludes missing readings, the current partial hour and hours where both actual and simulation are zero. It retains false-positive or false-negative production hours.

- MAE = mean absolute hourly error.
- RMSE = square root of mean squared hourly error.
- Bias = mean(simulation − actual), retained in the receipt.
- WAPE = sum(abs(simulation − actual)) / sum(actual) × 100. Lower is better; **100 − WAPE is not a calibrated accuracy percentage**.

The overview balance strip also shows a descriptive **Match / Совпаѓање** score, `max(0, 100 − WAPE)`, in response to the requested percentage display. It is explicitly described as a score of the paired historical hours, not guaranteed future accuracy. It shows predicted MWh for those same paired completed hours, and a click/tap opens actual MWh, predicted MWh, hourly MAE in MWh, WAPE and the formula. Opposing hourly errors do not cancel. A zero actual denominator or no pairs produces an unavailable percentage, not 100%. Prospective forecasts and reconstructed simulations have separate entries and scores. These paired-hour totals can differ from the dashboard's complete-day/live totals because of missing or unfinished hours. UI values use three decimal places for MWh and one for percent, in MK/EN; currency changes do not affect them.

Production audit at `2026-10-11T15:33:48.536Z`: 264 reconstructed hours, 139 scored hours, MAE **79.236 kWh**, RMSE **119.418 kWh**, bias **−67.141 kWh**, WAPE **26.912%**. The UI recalculates against currently available actuals, so its score can change as missing measurements arrive. See [database receipt](october-production-backtest.json). The short sample is not proof of future performance, and paired-hour scoring does not establish full-day accuracy when actual readings are incomplete.

## Persistence, access and operations

Migration `008_forecast_backtests.sql` was tested on the isolated Neon validation branch, then applied to production. `forecast_backtests` contains append-only maintenance snapshots with actual creation timestamps, model version, period, result and input JSON. The application runtime role has **SELECT only**. Measurements, MEMO prices and prospective `forecast_runs` were fingerprinted before/after reconstruction and stayed unchanged.

Authenticated comparison reads use the existing server-derived plant owner, an owner-bound seven-day shared cache and the existing lock helper. Cached absence is also stored. A warm production comparison made **zero SQL queries**. No new cron or polling job was added. A maintenance publication replaces the cached backtest only after SQL readback succeeds.

### Reproducing the one-off replay

Use a private maintenance environment file and first validate on an isolated Neon branch. Apply migration 008 before running. Do not put credentials in Git or supply production Redis settings to a test database.

The download helper requires Python and `eccodes==2.49.0` (a maintenance dependency, not an application runtime dependency). This run installed it under ignored `work/forecast-research/grib-python`; set `PYTHONPATH` to that directory when using this installation. Downloads are restricted to the public NOAA bucket and selected fields. ecCodes decoding is serialized because initialization was not thread-safe in the tested Windows installation.

```powershell
python scripts/download-gfs-backtest.py --from-date 2026-10-01 --to-date 2026-10-11 --out work/forecast-research/gfs-october
node --env-file=<private-maintenance-env> --conditions=react-server --experimental-transform-types scripts/replay-production.mjs --from-date 2026-10-01 --to-date 2026-10-11 --source-dir work/forecast-research/gfs-october --audit-file <audit-output.json>
```

The replay intentionally inserts a new audit snapshot on each invocation. Do not rerun just to display an existing result. Optional `--publish` refreshes the shared cache after database verification; otherwise a cold read restores it. Never change `createdAt` to an earlier date or insert replay data into `forecast_runs`/`readings`.

Validation: 121 tests passed, including archived-run validation, unit conversion, as-of calibration, source precedence, incomplete-hour scoring, owner isolation and warm cache behavior. Next production build and TypeScript passed. Browser checks covered MK/EN, line/column and monthly comparison; no console errors were observed. Local test-branch screenshot: `outputs/october-historical-comparison.jpg` (ignored by Git).
