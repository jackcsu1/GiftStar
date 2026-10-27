-- Photos live in D1 (small, resized JPEGs) so the free tier needs no extra services.
CREATE TABLE images (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
