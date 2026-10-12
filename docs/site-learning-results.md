# ZIS Solar: learned plant-response results

Selected on September only: **Quadratic ridge**. Fixed settings; no October retuning.

| Model | WAPE 21-30 Sep | WAPE 1-11 Oct | WAPE all21days |
|---|---:|---:|---:|
| v3.2 | 30.80% | 12.78% | 20.57% |
| Hourly GFS + old response | 31.80% | 13.99% | 21.69% |
| CatBoost | 37.21% | 18.97% | 26.86% |
| Quadratic ridge | 33.02% | 17.55% | 24.24% |
| Weather analogues | 34.23% | 15.36% | 23.52% |

Common comparison: 272hourly intervals, 72.28493MWh actual. Selected model MAE64.43kWh, RMSE93.45kWh, signed error-6.308MWh. Daily wins: 8/21.

11October: measured1.76305MWh; v3.2 predicts1.58073MWh/WAPE40.82%; selected model predicts1.24708MWh/WAPE45.99%.

October paired-day bootstrap95% interval for selected-minus-v3.2 WAPE difference: -0.33 to +9.89percentage points (5000resamples, seed42). This small, already inspected historical period is not independent prospective evidence.

## Limits and release decision

- The original hourly GFS archive spans57days. Training uses available prior revisions only, rolling45days. Target outcomes are not fitting inputs. Missing daylight training labels are excluded; valid measured zeros remain.
- Three candidates were fixed before their scores. September chooses the algorithm; all October candidates and every daily score are retained. Dates had previously been explored with different methods.
- GFS has0.25degree spatial resolution. Hourly radiation helps temporal detail but cannot reveal individual cloud-shadow motion.
- The native-weather ablation retains the old plant response and its original calibration gain.
- The selected model is deployed as a separate seven-day frozen challenger, with its own issued forecasts and matched prospective WAPE. It does not replace v3.2 or overwrite old chart forecasts.
- Live GFS cycles may differ from the12UTC retrospective inputs. Live outcomes are independently scored; retrospective percentages are never displayed as live accuracy.
- The existing ICON/GFS/ARPEGE and satellite/Huawei trials continue. No new paid service or keep-alive polling.

Full reproducible sources: `solar-learning-plan.md`, `site-learning-frozen.json`, `site-learning-evaluation.json`, `site-learning-verification.json`, and the SQL research receipt.
