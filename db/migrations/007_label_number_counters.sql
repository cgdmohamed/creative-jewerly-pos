BEGIN;

CREATE TABLE IF NOT EXISTS label_number_counters (
  label_date DATE PRIMARY KEY,
  last_value INT NOT NULL CHECK (last_value > 0)
);

COMMIT;
