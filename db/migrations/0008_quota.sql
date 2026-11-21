-- FW2.0c: usage counters that keep Google Maps Platform calls inside the free monthly allowance.
CREATE TABLE IF NOT EXISTS api_quota (
  key TEXT PRIMARY KEY,   -- e.g. 'gfuel:m:2026-11' (month, all users) or 'gfuel:d:u:ann:2026-11-22' (one user, one day)
  n INTEGER NOT NULL DEFAULT 0
);
