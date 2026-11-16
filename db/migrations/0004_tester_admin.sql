-- Tester management for admins: last active time, and names removed from the beta.
ALTER TABLE users ADD COLUMN last_active_at TEXT;
-- Best guess for testers who joined before this column existed: their latest search, else the day they joined.
UPDATE users SET last_active_at = COALESCE((SELECT MAX(q.created_at) FROM search_log q WHERE q.user_id = users.id), created_at);

-- A removed tester cannot sign back in under the same name until an admin allows it.
CREATE TABLE IF NOT EXISTS removed_users (
  id          TEXT PRIMARY KEY,      -- same id the users table used ("u:<name>")
  name        TEXT NOT NULL,
  removed_at  TEXT NOT NULL,
  removed_by  TEXT
);

-- The admin page counts searches per tester; without this each count read the whole search log.
CREATE INDEX IF NOT EXISTS idx_search_log_user ON search_log (user_id);
