# Huawei measurement retention — 13 October 2026

The reported disappearing chart values had three confirmed code paths: the preceding live-hour object was deleted on hour rollover; the dashboard hid cumulative energy after 15 minutes; and a successful response with missing counters could overwrite a known partial field with null. The pending-to-SQL handoff also acknowledged batches before publishing their rows to the warm dashboard cache.

Partial cumulative production and export are now merged separately by hour, with separate observation timestamps. Null, older, negative or regressing counters cannot erase an accepted partial value. Partial hours remain visible until completed archive fields supersede them. They carry `≈` / “Делумен час”, do not close archive coverage gaps, and are excluded from forecast scoring and final CSV exports. Instantaneous power still uses its existing freshness rules. Missing same-day daily totals retain their previous known value.

Partials are stored in the existing durable Redis `fusion` state (no expiry), then in `fusion_state` during the existing archive pass. They are not inserted into final `readings`. Known partials are currently retained in state without age pruning; completed fields win in the dashboard. This adds no Huawei request, new poller or SQL wake-up on the warm live path.

Completed queued rows are published to the dashboard cache after successful SQL save and before pending acknowledgement. Dashboard readers read pending batches before the snapshot so either copy is available during this handoff. Failed publication leaves the pending batch for idempotent replay.

Read-only production audit at 08:16:56 UTC found 9 current-day cache rows and the same 9 SQL rows, no pending batches. Current-hour fields were unknown because boundary anchors were from the preceding hour. Previously discarded partials cannot be reconstructed without real measurements; the fix preserves values received after release and allows later Huawei history to fill earlier gaps.

Validation: 215 tests passed across the full test command; production build/TypeScript passed. New regressions cover hour rollover, null/failed meter responses, per-field monotonic counters, completed replacements, cache acknowledgement, and exclusion of retained partials from day-ahead scoring. Targeted lint passed for changed data/cache helpers, tests and evidence scripts. Existing unrelated lint violations remain in the legacy `Envelope.data:any` and chart effects.

Source audit: `work/telemetry-retention/audit-2026-10-13T08-16-56.551Z.json` (sanitized; no credentials or session tokens). No plant-control calls were made.

## Follow-up: delayed hourly graph despite fresh power

The user reported at 10:30 local that the graph ended at the 08:00 interval while power was refreshed at 10:27. Production audit confirmed last archived interval 08:00–09:00, with current-hour anchors still at 09:00. A rolling 59-minute internal guard could defer the next hour's history request even after a new hour started. The existing `historyAt < currentHourStart` guard already permits only one history request per series per calendar hour.

The rolling guard is now five minutes, with the once-per-calendar-hour guard, 13 requests per series and 26 shared requests per rolling day unchanged. Automatic history starts after minute 15 of the hour to leave time for upstream publication; this is a collection policy, not a guarantee that Huawei publishes by that time. Both manual and active collectors share it. One series is collected per refresh so neither monopolizes the shared request budget.

Manual feedback now separately reports the end of the latest completed production interval. A fresh power response or repeated old rows cannot report an up-to-date hourly graph when the archive still trails the previous completed hour. The archive delay is shown explicitly. Two additional regression tests passed (217 total), as did the production build.
