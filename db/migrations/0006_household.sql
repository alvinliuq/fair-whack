-- FW2.0: household profile (About You and Your Family, Save more on Fuel, Save more on Bills).
-- One row per user; `data` is JSON: { about: {...}, fuel: {...}, bills: {...} } (see public/household.js).
-- Age, gender, household size and favourite categories stay on `users` (asked at sign-up).
CREATE TABLE IF NOT EXISTS household (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
