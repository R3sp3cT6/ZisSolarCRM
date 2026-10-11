CREATE TABLE IF NOT EXISTS forecast_settings (
 owner text PRIMARY KEY REFERENCES plants(owner),
 config jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS forecast_runs (
 id text PRIMARY KEY,
 owner text NOT NULL REFERENCES plants(owner),
 run_key text NOT NULL,
 issued_at timestamptz NOT NULL,
 model_version text NOT NULL,
 payload jsonb NOT NULL,
 inputs jsonb NOT NULL,
 UNIQUE(owner,run_key)
);
CREATE INDEX IF NOT EXISTS forecast_runs_owner_time ON forecast_runs(owner,issued_at DESC);
