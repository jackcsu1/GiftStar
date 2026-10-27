-- GiftStar schema. One family, one occasion (Christmas 2026) for now;
-- `occasion` columns leave room to add more later.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  household TEXT NOT NULL,
  is_kid INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  sizes TEXT NOT NULL DEFAULT '',
  favorites TEXT NOT NULL DEFAULT '',
  dont_buy TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT ''
);

-- A device holds a random token (we store only its hash). A device can be
-- linked to several people (shared iPad); a person can be on several devices
-- only via an admin-issued code.
CREATE TABLE devices (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE device_people (
  token_hash TEXT NOT NULL REFERENCES devices(token_hash) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_hash, person_id)
);
CREATE INDEX device_people_person ON device_people(person_id);

CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  occasion TEXT NOT NULL DEFAULT 'christmas-2026',
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',       -- stored photo ("img:<key>") or external URL
  price TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 2,  -- 1 must-have, 2 would love, 3 nice
  qty INTEGER NOT NULL DEFAULT 1,
  sort REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX items_owner ON items(owner_id, occasion);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  claimer_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved', -- reserved | bought
  created_at INTEGER NOT NULL,
  UNIQUE (item_id, claimer_id)
);

-- Family-suggested ideas for someone; never shown to that someone.
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  occasion TEXT NOT NULL DEFAULT 'christmas-2026',
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  claimer_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  status TEXT,                           -- NULL | reserved | bought
  created_at INTEGER NOT NULL
);
CREATE INDEX ideas_target ON ideas(target_id, occasion);

-- Anonymous questions to a list owner, optionally about one item.
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  asker_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX questions_target ON questions(target_id);

CREATE TABLE group_gifts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  organizer_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  total_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE contributions (
  group_id TEXT NOT NULL REFERENCES group_gifts(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, person_id)
);

-- Grown-up buyer pairings, not secret.
CREATE TABLE assignments (
  occasion TEXT NOT NULL,
  giver_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (occasion, giver_id)
);
