# Negative MEMO price diagnostic

Evaluated: 2026-10-13T08:16:57.287Z.

No scored hour had a negative MEMO price. The policy changed zero predictions, so WAPE did not improve. No model was promoted and no inverter command was sent.

The archive reconstruction assumes historical availability of weather and prices. The receipt-causal track uses genuine receipt cutoffs. The shutdown policy was only confirmed on 12 October; applying it historically is an assumption in both tracks.

## archiveReconstruction

| Month | Hours | Actual MWh | Control WAPE | Reconstructed policy WAPE | Receipt policy WAPE |
|---|---:|---:|---:|---:|---:|
| 2026-04 | 224 | 73.80 | 30.18% | 30.18% | 30.18% |
| 2026-05 | 479 | 141.76 | 27.18% | 27.18% | 27.18% |
| 2026-06 | 504 | 159.25 | 12.70% | 12.70% | 12.70% |
| 2026-07 | 409 | 0.80 | 2288.17% | 2288.17% | 2288.17% |
| 2026-08 | 227 | 55.49 | 25.71% | 25.71% | 25.71% |
| 2026-09 | 403 | 113.64 | 23.04% | 23.04% | 23.04% |
| 2026-10 | 142 | 41.02 | 15.88% | 15.88% | 15.88% |
| All | 2388 | 585.74 | 24.97% | 24.97% | 24.97% |

Matched October: 142 hours. v3.2 WAPE 12.78%; CatBoost control 15.88%. Both are unchanged by the policy.

## receiptCausal

| Month | Hours | Actual MWh | Control WAPE | Reconstructed policy WAPE | Receipt policy WAPE |
|---|---:|---:|---:|---:|---:|
| 2026-04 | 0 | — | —% | —% | —% |
| 2026-05 | 0 | — | —% | —% | —% |
| 2026-06 | 0 | — | —% | —% | —% |
| 2026-07 | 0 | — | —% | —% | —% |
| 2026-08 | 0 | — | —% | —% | —% |
| 2026-09 | 288 | 77.24 | 28.83% | 28.83% | 28.83% |
| 2026-10 | 142 | 41.02 | 15.87% | 15.87% | 15.87% |
| All | 430 | 118.26 | 24.34% | 24.34% | 24.34% |

Matched October: 142 hours. v3.2 WAPE 12.78%; CatBoost control 15.87%. Both are unchanged by the policy.

All measured shutdown zeros and restarts remain in the original cohorts. Future negative prices can affect the separate saved candidate, but this test supplies no measured accuracy gain. Full hourly evidence and price coverage are in memo-availability-evaluation.json.
