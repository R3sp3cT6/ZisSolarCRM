-- Apply with the maintenance connection after creating the LOGIN role securely.
-- Never store its password in migrations or deploy maintenance credentials.
ALTER ROLE zis_app_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO zis_app_runtime;
GRANT SELECT,INSERT,UPDATE ON plants,readings,prices,sync_runs,fusion_state,fusion_reports,users TO zis_app_runtime;
GRANT SELECT,INSERT ON reading_revisions,price_revisions TO zis_app_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,auth_limits,collector_runs TO zis_app_runtime;
ALTER ROLE zis_app_runtime SET statement_timeout='25s';
ALTER ROLE zis_app_runtime SET idle_in_transaction_session_timeout='10s';

GRANT SELECT,INSERT,UPDATE,DELETE ON push_subscriptions,push_deliveries TO zis_app_runtime;

GRANT SELECT,INSERT,UPDATE ON forecast_settings TO zis_app_runtime;
GRANT SELECT,INSERT ON forecast_runs TO zis_app_runtime;
GRANT SELECT ON contract_versions,contract_recalculations TO zis_app_runtime;
GRANT SELECT ON forecast_backtests TO zis_app_runtime;
