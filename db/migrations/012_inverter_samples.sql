-- Retain device state and real arrival times without changing aggregate readings.
CREATE TABLE IF NOT EXISTS forecast_inverter_samples (
 owner text NOT NULL REFERENCES plants(owner),
 device_id bigint NOT NULL,
 measured_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb NOT NULL,
 PRIMARY KEY(owner,device_id,measured_at),
 CHECK(received_at>=measured_at)
);
CREATE INDEX IF NOT EXISTS forecast_inverter_samples_owner_time ON forecast_inverter_samples(owner,measured_at);
GRANT SELECT,INSERT ON forecast_inverter_samples TO zis_app_runtime;
