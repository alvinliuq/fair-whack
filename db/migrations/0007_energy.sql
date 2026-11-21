-- FW2.0 Bills: Victorian residential electricity and gas plans from the AER (refreshed weekly by pipeline/energy.js).
CREATE TABLE IF NOT EXISTS energy_plan (
  id TEXT PRIMARY KEY,            -- AER plan id, e.g. AGD814405MR@VEC
  brand TEXT NOT NULL,            -- AER brand slug, e.g. agl
  fuel TEXT NOT NULL,             -- 'E' electricity, 'G' gas
  networks TEXT NOT NULL,         -- '|United Energy|'
  postcodes TEXT NOT NULL,        -- ',3104,3105,' (Victorian postcodes only)
  model TEXT NOT NULL,            -- compact JSON from shared/energy.js normalizePlan()
  last_updated TEXT,              -- AER lastUpdated (skip re-fetching unchanged plans)
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS energy_plan_fuel ON energy_plan (fuel);
