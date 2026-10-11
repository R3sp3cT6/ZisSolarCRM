# Measured clear-sky power persistence — exploratory protocol

The existing API supports archived five-minute inverter telemetry. Retrieved
October 11 through the shared session, lock and quota; the local database had
not retained these raw historical samples. Raw actual receipt remains today's
download. Historical delivery is unknown, so replay assumes collectTime +5min
and repeats with +10min. This is not an as-issued prospective test.

Potential flaw: the current measured/NWP ratio is capped at 0.5–1.5 and follows
NWP's future temporal shape. A large cloud-induced drop cannot be corrected
enough when the previous NWP irradiance is wrong. Test an alternative that
normalizes actual inverter power by modeled clear-sky AC power, then applies
this index to future clear-sky AC power (smart power persistence).

Fixed before scoring five-minute data: use two complete fresh inverter samples,
the same stopped/reset guards and maximum ten-minute measurement age. Require
clear-sky power ≥max(10kW, 3% AC). Index = 0.35 previous +0.65 latest, capped
at 1.5. Blend with existing satellite/NWP using 0.95 exp(-measurement age/60min).
Integrate the next four quarters in five-minute steps. Respect AC cap. No new
cloud-motion or fitted gain. Future weather/geometry may be used; future actual
production or satellite observations may not.

Compare old v3.4, the unchanged NWP background and this alternative on identical
quarters and lead bands using differences of complete cumulative inverter
counters. Require every intervening five-minute sample and no reset; retain
valid zeros. Where either forecast is unavailable, retain its original background
as fallback, and report availability/coverage. No removal of difficult intervals.
GFS replaces ICON only in this historical component test; do not claim a full
historical ICON test. Later deployment requires live branch verification and
prospective outcomes. All hourly October dates have previously been inspected.
