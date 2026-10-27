-- When a family idea is merged into the person's own wish, remember who suggested it.
ALTER TABLE items ADD COLUMN suggested_by TEXT REFERENCES people(id) ON DELETE SET NULL;
