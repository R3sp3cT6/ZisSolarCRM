# Free weather inputs for ZIS Solar, Resen

Research and implementation: 11 October 2026. Plant: **41.068056 N, 21.036111 E**, verified from Huawei inventory. Model: `weather-solar-v3.0`. No new API subscription or API key is required.

## Source decision

| Source | Use in this CRM | Important limits |
| --- | --- | --- |
| [MET Norway Locationforecast](https://docs.api.met.no/doc/locationforecast/datamodel.html), `complete` endpoint | Total/low/mid/high cloud, fog where available, air temperature, relative humidity, 10 m wind, precipitation at the plant coordinates | Numerical forecast, not cloud tracking. Hourly samples become 6-hourly farther ahead. Global source does not supply irradiance here. [CC BY 4.0](https://docs.api.met.no/doc/License). |
| [FMI SILAM](https://silam.fmi.fi/), global v6.1 surface dataset | Total aerosol and dust optical depth at 550 nm. Queried directly from FMI's THREDDS service | Hourly means, 0.2° grid; nearest point in the live check was 41.000 N, 21.000 E, about 8 km away. Seven days from model initialization, so less than seven future delivery days may be covered. [FMI open-data licence](https://en.ilmatieteenlaitos.fi/open-data-licence): CC BY 4.0. |
| [Open-Meteo](https://open-meteo.com/en/pricing) | Existing optional customer GTI adapter retained; not enabled for this request | The hosted free API is for non-commercial use. It is not silently substituted for a paid customer endpoint in this commercial application. |
| [EUMETSAT cloud products](https://user.eumetsat.int/s3/eup-strapi-media/Cloud_Products_for_Nowcasting_Applications_over_Europe_CMA_CT_CTTH_Factsheet_6b7db82644.pdf) | Candidate for a later satellite nowcasting pipeline | Requires access setup, product-specific licence review and processing. [Data Store FAQ](https://user.eumetsat.int/resources/user-guides/frequently-asked-questions-for-data-store) distinguishes free and commercial licensing. No account or licence was created here. |
| DWD MOSMIX / Bright Sky | Not selected | Live checks did not provide a nearby Resen station with the required radiation forecast. Skopje is not used as a proxy for the plant. |

This is a practical choice for **free, unattended, location-specific forecasts**, not evidence that it is the most accurate service at this plant. That requires prospective comparison against Huawei measurements.

## Calculation and assumptions

1. Preserve UTC hour intervals and Europe/Skopje delivery dates, including 23/25-hour DST days. MET instant values are linearly interpolated to hourly midpoints only between valid samples at most six hours apart. Unknown optional fields stay null. One-hour rain totals are used directly; a six-hour total is divided evenly only over a six-hour source interval and labelled approximate.
2. Integrate Haurwitz clear-sky horizontal irradiance at six 10-minute midpoint solar positions per hour. Night is zero. Cloud attenuation uses the existing Kasten–Czeplak relationship, `1 − 0.75 × (cover / 100)^3.4`. For available fog, `cover = max(total cloud, fog)`: an explicitly approximate obscuration proxy. Low/mid/high cloud fractions overlap and are **not** summed. We do not know their optical thickness.
3. SILAM `ocd_part_w550` is total aerosol optical depth; `ocd_dust_w550` is a subset, not another multiplier. `time: mean` values are labelled at the end of the preceding hourly interval, consistent with the [SILAM output guide](https://silam.fmi.fi/doc/SILAM_v5_userGuide_general.pdf). Convert them to interval starts. No temporal extrapolation, gap filling, or carry-forward beyond the model horizon.
4. Estimate **relative aerosol sensitivity**, not measured dust loss, with [Simplified Solis](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.clearsky.simplified_solis.html). Convert AOD550 to AOD700 using an assumed Ångström exponent of 1.3. Compute an hourly GHI ratio against reference AOD550=0.1, holding reference water at 1 cm and pressure at 101325 Pa. Multiply estimated GHI by this ratio. Cleaner-than-reference air may increase it. These reference values are not historical observations at the plant. AOD700 outside 0–0.45 is outside the formula's valid range: retain the baseline, show missing correction coverage, and do not extrapolate. Missing SILAM data also retains the baseline and is shown explicitly. Provider-supplied GTI is never attenuated again.
5. Temperature correction retains configurable NOCT and gamma. When wind is present, scale the NOCT temperature rise by `31.84 / (25 + 6.84 × v2m)`, using [Faiman heat-transfer coefficients](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.temperature.faiman.html) and `v2m = v10m × (2/10)^0.2`. This preserves the existing NOCT rise at reference wind 1 m/s. A 2 m module height, exponent 0.2 and generic coefficients are assumptions requiring site calibration. Without wind, use the previous NOCT relation. Relative humidity and rain are context, not independent extra loss percentages.
6. Apply the established empirical plant response learned from completed Huawei days. Its coefficients already include orientation, AC conversion and static losses; do not apply those losses again. Clip at the configured 875 kW model cap. Feed hourly energy into the existing export-ratio and revenue calculations. Weather affects **production and revenue**, not the current MEMO price benchmark.

## What this does not measure

- Movement or shadows of individual clouds over individual panel strings, or minute-by-minute ramps. A 10 m wind vector is not cloud motion at cloud height.
- Dust deposited on glass, cleaning, rain wash-off, snow accumulation, nearby trees/buildings, row-to-row shading, terrain horizons, outages or curtailment. Airborne dust AOD is not surface soiling.
- Confirmed module geometry: DC kWp, tilt and azimuth are still unknown; they are not inferred from the nominal inverter AC ratings.

For those effects, collect panel geometry and a horizon survey, cleaning/snow records, on-site irradiance/module-temperature measurements and sufficiently frequent inverter telemetry. Satellite cloud-motion forecasting is a separate pipeline and would still need validation at Resen. No 100% accuracy claim is made.

## Cache, provenance and validation

MET retains its shared cache, conditional HTTP revalidation and 24-hour issuance limit. SILAM selects a fixed allowlisted run, rejects initialization older than 48 hours or in the future, validates units/location/timestamps, bounds requests and responses, shares results for six hours and caches failures for 15 minutes. Optional aerosol failure does not remove the core weather forecast.

The existing three forecast runs at **08:20, 12:20, 18:20 local time** are unchanged. No additional cron or visitor-triggered generation is introduced. Ordinary forecast reads still use the shared Redis snapshot; the change adds no periodic SQL polling. Frozen runs store the raw MET response, SILAM CSV/run identity, source timestamps, configuration and model version. New-version prospective production errors are evaluated separately from old versions.

Automated tests cover cloud/fog overlap, optional-unit handling, six-hour rain allocation, model validity bounds, night, wind cooling, AC clipping, aerosol effects on production, missing coverage, no double counting, provider outages, cache freshness, existing DST/cutoff rules and authorization. These are implementation checks, **not proof of forecast skill**. Collect forward-issued predictions and compare them with completed Huawei observations before claiming a measured accuracy improvement.
