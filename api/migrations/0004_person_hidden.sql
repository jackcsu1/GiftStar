-- One person not seeing a whole household (one direction only).
CREATE TABLE person_hidden (
  viewer_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  household TEXT NOT NULL,
  PRIMARY KEY (viewer_id, household)
);
