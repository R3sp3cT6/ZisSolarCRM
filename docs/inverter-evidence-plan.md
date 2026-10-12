# Device evidence for operational interruptions

12 October 2026. The user confirmed the July interruption and directed us to identify shutdown/restart through Huawei inverter measurements. Inspect actual device evidence before fitting a generic low-output heuristic. No heuristic model was scored or activated in this turn.

Use the existing locked, quota-aware Huawei client and read-only `getDevHistoryKpi`. The reference supports up to 10 devices and 3 days per request. Existing shared minute/day limits apply; do not consume additional API calls in the application's collection path or bypass limits for historical research.

Retain individual device ID, actual collection/receipt times, power, lifetime counter, original state code, original startup/shutdown values and cautiously decoded timestamps. Preserve partial device coverage and unknown fields. Reject foreign devices, future/off-grid timestamps and ambiguous duplicate samples. Missing devices/measurements never become zeros or shutdowns. Archive raw research responses with hashes separately. No inverter control commands.

Distinguish manufacturer-reported shutdown with measured zero (known codes 768–773), power-limited state 513, self derating 514, normal grid operation 512, no irradiation 40960, standby/startup, unknown and contradictory evidence. An ordinary zero without shutdown status is not confirmed downtime. Unrecognized codes stay unknown. Do not infer the technical root cause, operator intent or meter export from these states.

Report intervals as observation bounds. Consecutive samples are five minutes apart; a gap splits evidence. Original open_time/close_time can be null, stale or provided in epoch seconds despite documentation mentioning milliseconds, so they do not automatically substitute for observed transitions. A producing observation after a gap is reported separately, without assuming continuous outage across the gap.

Save through the existing Redis queue and active/scheduled SQL flush. New append-only `forecast_inverter_samples` retains first actual receipt, with separate SQL archived_at. Runtime receives only SELECT/INSERT on the new table. Verify migration on the existing isolated branch, actual data insertion, deduplication, partial coverage, persistence retry, unchanged readings, and live callback reuse before production release.

This is evidence collection and classification, not an accuracy improvement claim. Do not remove outage actuals from primary WAPE or change official forecasts/revenue. Newly retrieved historic status was not recorded before historic forecast origins. Any subsequent historical training experiment must separate its current-archive assumption from strict receipt-causal/prospective evaluation, and must cover ordinary operating days as well as confirmed interruptions.

Sources: [Huawei SmartPVMS 25.2.0 NBI reference, manufacturer document mirrored on Scribd](https://www.scribd.com/document/980589962/SmartPVMS-25-2-0-Northbound-API-Reference), [Huawei device data interfaces](https://support.huawei.com/enterprise/mx/doc/EDOC1100306384/2630ae1b/device-data-interfaces), [RdTools availability example](https://rdtools.readthedocs.io/en/stable/examples/system_availability_example.html). The classifier is our conservative interpretation of telemetry, not an implementation of RdTools' meter/inverter loss estimation.
