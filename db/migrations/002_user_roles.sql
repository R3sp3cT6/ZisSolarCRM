ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer'));
ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN plant_owner text REFERENCES plants(owner);
UPDATE users SET plant_owner=id, role='admin';
ALTER TABLE users ALTER COLUMN plant_owner SET NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_id_fkey;
CREATE INDEX idx_users_plant_owner ON users(plant_owner);
