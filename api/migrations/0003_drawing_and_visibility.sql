-- Who takes part in the grown-up name drawing; everyone else never sees it.
ALTER TABLE people ADD COLUMN in_drawing INTEGER NOT NULL DEFAULT 0;

-- Pairs of households that don't see each other's lists (checked both ways).
CREATE TABLE household_hidden (
  household_a TEXT NOT NULL,
  household_b TEXT NOT NULL,
  PRIMARY KEY (household_a, household_b)
);
