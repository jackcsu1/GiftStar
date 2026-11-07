ALTER TABLE people ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE people SET is_admin = 1 WHERE lower(name) = 'matt';
