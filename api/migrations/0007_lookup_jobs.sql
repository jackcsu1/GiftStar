-- Product lookups that the family computer does in a real browser (see agent/).
CREATE TABLE lookup_jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  result TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX lookup_jobs_pending ON lookup_jobs (status, created_at);

CREATE TABLE lookup_cache (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE agent_seen (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  seen_at INTEGER NOT NULL
);
