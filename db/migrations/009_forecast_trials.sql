-- Prospective trials are kept outside official day-ahead runs and replays.
CREATE TABLE IF NOT EXISTS forecast_trials (
 id text PRIMARY KEY,
 owner text NOT NULL REFERENCES plants(owner),
 run_key text NOT NULL,
 issued_at timestamptz NOT NULL,
 kind text NOT NULL CHECK(kind IN ('day-ahead','intraday')),
 model_version text NOT NULL,
 payload jsonb NOT NULL,
 inputs jsonb NOT NULL,
 UNIQUE(owner,run_key)
);
CREATE INDEX IF NOT EXISTS forecast_trials_owner_time ON forecast_trials(owner,issued_at DESC);
CREATE TABLE IF NOT EXISTS forecast_observations (
 owner text NOT NULL REFERENCES plants(owner),
 measured_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(owner,measured_at)
);
GRANT SELECT,INSERT ON forecast_trials,forecast_observations TO zis_app_runtime;
