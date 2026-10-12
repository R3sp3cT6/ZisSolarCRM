# Local weather-conditioned residual correction — 12 October 2026

Purpose: preserve v3.2's useful physical/empirical shape while correcting recurring hourly bias. Direct CatBoost/Ridge/analogue forecasts did not beat it. This is a new, bounded model-output-statistics (MOS) hypothesis, not another fit of October's totals.

Background: IEA PVPS's [2024 handbook](https://iea-pvps.org/wp-content/uploads/2024/09/Best-Practices-Handbook-for-the-Collection-and-Use-of-Solar-Resource-Data-for-Solar-Energy-Applications-Fourth-Edition-.pdf), section 9.5, discusses local forecast postprocessing conditional on solar elevation and clear-sky index. These general methods do not imply any promised improvement at Resen.

## Frozen single candidate

- Target remains measured hourly Huawei AC energy. Baseline is the exact archived v3.2 replay, including its causal global gain. Weather features use the forecast that generated that baseline; no target-hour satellite observations.
- Features: solar hour and forecast irradiance / astronomical clear-sky irradiance (CSI, capped at 2). Estimate a local multiplicative correction by a weighted median of prior actual / baseline ratios. This minimizes local absolute error, not net daily error.
- Gaussian proximity kernel: bandwidth 2 solar hours and 0.25 CSI. Recency half-life 14 days; maximum history 30 days. Identity prior at ratio 1 has weight one-third of total data weight (25% of combined weight). Correction is bounded to [0.85, 1.15]. No grid search, switching candidates, additional tuning or day-specific override after scoring.
- Exclude baseline below 5 kWh or clear-sky GHI below 50 W/m² from fitting; retain their unchanged baseline in evaluation. Require at least 7 distinct training days, effective weighted sample size 20, and effective independent-day size 5; otherwise exact baseline fallback. Valid measured zeros stay in training and scores. No hindsight outage exclusions.
- Every forecast origin selects the latest revision actually received strictly before that origin, for a completed interval on a completed previous local day. Future and partial revisions cannot erase a valid completed revision. Missing actuals are never filled. Training provenance is retained per origin.
- September 9–17 is warm-up. Evaluate September 18–30 and October 1–11 separately and together. Dates have all been examined in earlier experiments: this is exploratory retrospective evidence, not an independent holdout. Run once, preserve failures as well as successes.
- Include all shared daylight/positive-production hours, unchanged low-light hours and fallback hours. Report WAPE, MAE, RMSE, signed MWh error, daily wins and correction coverage. Paired-day bootstrap uses 5,000 resamples, seed 42; it does not remove selection bias.
- Gate for an additional live trial: at least 2% relative WAPE improvement in both periods, no aggregate RMSE increase, no signed-bias deterioration greater than 2 percentage points. No official forecast replacement from retrospective results. If the gate fails, archive and retain existing models; do not publish a losing correction to users.
- Source provenance includes original lower-resolution GFS radiation already used by the baseline; this does not claim to fix cloud timing or spatial resolution. It does not repurpose the later native-hourly GFS model as the original weather source.

Freeze code/input hashes before evaluation; independently recompute metrics and verify all revision cutoffs. Save the experiment and full numeric inputs in append-only research SQL and project context. No new subscription, polling, scheduler, plant control or overwrite of actuals/old forecasts.
