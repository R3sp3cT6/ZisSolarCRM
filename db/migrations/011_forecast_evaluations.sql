-- Research evaluations stay separate from chart replays and prospective trials.
CREATE TABLE IF NOT EXISTS forecast_evaluations (
 id text PRIMARY KEY,
 owner text NOT NULL REFERENCES plants(owner),
 created_at timestamptz NOT NULL DEFAULT now(),
 model_version text NOT NULL,
 payload jsonb NOT NULL,
 inputs jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS forecast_evaluations_owner_version
 ON forecast_evaluations(owner,model_version,created_at DESC);
GRANT SELECT ON forecast_evaluations TO zis_app_runtime;
