# Automatic model comparison — 11 October 2026

`solar-multimodel-shadow-v1` runs alongside official v3.2 and trial v3.4. It
does not replace either forecast or control the plant.

- Existing `/api/forecast-sync` calls the collector after the existing trial,
  only on authenticated scheduled forecast refreshes. No new cron or polling.
  If preceding work consumed 150 seconds, collection is deferred to preserve
  the primary response within the route's 300-second budget.
- `/api/forecast-models`: authenticated owner-scoped GET; same-origin,
  rate-limited administrator POST. The Forecast page shows model totals for
  the target date, original run times and prospective WAPE/pair counts.
- ICON uses the previously persisted, matching v3.4 context, at most 18 hours
  old, with a weather initialization at most 18 hours old. ARPEGE Europe is
  decoded from the current official Météo-France SP1 packages. GFS is decoded
  from original NOAA S3 hourly DSWRF fields via indexed byte ranges. A five-hour
  allowance selects a disseminated GFS run. All three retain their own origin;
  this operational comparison does not pretend the source cycles are identical.
- All three use the same plant configuration/calibration and already available
  MET temperature/wind. Native hourly radiation is reconstructed by differencing
  cumulative ARPEGE J/m² or de-averaging GFS blocks. No 3h interpolation. GRIB
  units, initialization, scan/grid layout, point coordinates and hours are
  checked; net radiation is never accepted as downward radiation.
- Public source data is shared in Redis by provider, coordinates and target
  date, with a one-hour freshness window and a 15-minute failure backoff. Two
  workers per provider, maximum 85 seconds, 120 MB/package or 4 MB/GFS field.
  Unsupported or incomplete input stays unavailable, not zero. No SQL in source
  collectors. Each generation is deduplicated for 30 minutes by owner/config.
- Each run is append-only in `forecast_trials`, its own model version and run
  key. Payload includes each prediction, untrained mean/median and optional
  learned challenger. Inputs archive original decoded fields, URLs, hashes,
  publish/receipt times, calibration/context and exact training pairs. Numeric
  archives remain reproducible; runtime does not keep full global GRIB binaries.
- Warm GET reads cache only; cold reads restore the last persisted owner view.
  Database history/scoring runs during generation, not ordinary repeated views.
  New sources cannot break official v3.2/v3.4 refreshes.

## Learned challenger gate

Use only previously issued next-day predictions with the same model/config,
completed actual hours and a common valid three-model mask. Earliest complete
run per target hour is selected deterministically. Real daytime zeros stay in
the score. Hours with all predictions and actual zero are omitted; forecast
false positives at zero output are retained. No current-day data enters fitting.

At least 28 distinct past dates are needed: the latest 14 for chronological
validation and up to 30 preceding training dates, at least 150 matched hours in
each portion. This is a minimum-data gate, not a statement of statistical power
or a guarantee of full measurement coverage on every date. WAPE and hour counts
remain explicit. Grid search minimizes training absolute error over nonnegative
weights in 10% increments summing to 1, including individual-model extremes.

The frozen candidate must have at least 2% relative lower validation WAPE than
the strongest individual, RMSE no more than 3% worse, and absolute energy bias
no more than 2 percentage points worse. A passed candidate generates future
**trial** predictions only. Official promotion still requires prospective
evidence and is not performed automatically. Missing a source disables the
blend; weights are never silently redistributed.

## First real run and verification

[Runtime receipt](multimodel-runtime-receipt.json): 24 hours for 12 October;
ICON 2.866837 MWh, native-hourly GFS 2.891250 MWh, ARPEGE 3.716895 MWh,
equal mean 3.158327 MWh, median 3.172285 MWh. No outcomes yet; weights are null.
Initial source collection took approximately 44 s / 237.5 MB for ARPEGE and
12 s / 21.5 MB for GFS, in parallel on this machine. This is a measured sample,
not a server latency guarantee. Provider failures remain explicit.

187 tests pass (16 new), TypeScript and production build pass. New tests cover
energy conversion, accumulated block boundaries, real WASM GRIB decoding on
documented synthetic fixtures, missing inputs, chronology/future leakage,
failed validation, cache isolation/reuse, persistence failure and authorization.
Exact SQL payload readback and original inputs verified with runtime DB role;
warm dashboard + official forecast + trial + model comparison uses 0 SQL calls.
Deployment/UI verification is recorded in the runtime receipt and project context.

Production release: code `a9691d2` plus browser date-format correction `8dd7c6e`,
deployment `dpl_3q6ZauShNAsjanLSoYzASLXXaZrg` READY. Authenticated browser GET
and administrator refresh show the persisted values; anonymous API is 401,
login is 200. Desktop and 390px mobile layouts were checked in Macedonian and
English with no horizontal overflow or console errors. Existing chart initial
measurement warnings remain. [UI receipt](multimodel-ui-verification.json).
The source downloads above were measured locally; a fresh Vercel cold-source
download is not claimed by this cached production endpoint verification.

Fixture metadata: `tests/fixtures/*-solar-test.grib2` are synthetic 2×2 regular
GRIB2 grids generated with ecCodes, 11 Oct 2026 12 UTC / lead 1, values
100/200/300/400 W/m² (ARPEGE multiplied by 3,600 for J/m²). They are not observed
weather or production data.
