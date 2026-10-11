-- Historical replays are separate from genuinely prospective forecast_runs.
CREATE TABLE IF NOT EXISTS forecast_backtests (
 id text PRIMARY KEY,
 owner text NOT NULL REFERENCES plants(owner),
 created_at timestamptz NOT NULL DEFAULT now(),
 period_from date NOT NULL,
 period_to date NOT NULL CHECK(period_to >= period_from),
 model_version text NOT NULL,
 payload jsonb NOT NULL,
 inputs jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS forecast_backtests_owner_created ON forecast_backtests(owner,created_at DESC);
