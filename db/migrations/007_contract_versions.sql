-- ZIS Solar's shared supply contract, effective by local delivery date.
-- A null start retains the previously applied terms without inventing an old signing date.
CREATE TABLE IF NOT EXISTS contract_versions (
 version text PRIMARY KEY,
 effective_from date,
 share numeric(8,6) NOT NULL CHECK (share > 0 AND share <= 1),
 fixed_eur_mwh numeric(10,4) NOT NULL CHECK (fixed_eur_mwh >= 0),
 source text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_versions_effective_from ON contract_versions (COALESCE(effective_from, '-infinity'::date));
INSERT INTO contract_versions(version,effective_from,share,fixed_eur_mwh,source) VALUES
 ('excerpt-10A-94pct-2.2',NULL,0.94,2.20,'Previously applied clause 10A, retained before 2026-10-01'),
 ('excerpt-10A-20261001-94pct-2.5','2026-10-01',0.94,2.50,'User supplied October contract excerpt, clause 10A, Monday-Sunday, received 2026-10-11')
ON CONFLICT(version) DO NOTHING;
CREATE TABLE IF NOT EXISTS contract_recalculations (
 id text PRIMARY KEY,
 owner text NOT NULL REFERENCES plants(owner),
 contract_version text NOT NULL REFERENCES contract_versions(version),
 period_from date NOT NULL,
 period_to date NOT NULL CHECK (period_to > period_from),
 audit jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
