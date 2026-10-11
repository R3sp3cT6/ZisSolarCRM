CREATE TABLE IF NOT EXISTS forecast_satellites (
 owner text NOT NULL REFERENCES plants(owner),
 slot_time timestamptz NOT NULL,
 received_at timestamptz NOT NULL,
 payload jsonb NOT NULL,
 PRIMARY KEY(owner,slot_time)
);
GRANT SELECT,INSERT ON forecast_satellites TO zis_app_runtime;
