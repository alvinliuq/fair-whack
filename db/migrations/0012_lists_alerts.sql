-- Stage 7 My List: lists can be put in order; a list no longer limits stores (the store buttons filter instead);
-- every push is counted so a person gets at most 5 a day.
ALTER TABLE lists ADD COLUMN sort_order INTEGER;
-- Existing lists keep their current order (oldest first).
UPDATE lists SET sort_order = (SELECT COUNT(*) FROM lists l2 WHERE l2.user_id = lists.user_id AND (l2.created_at < lists.created_at OR (l2.created_at = lists.created_at AND l2.id <= lists.id)));
UPDATE lists SET retailer = NULL;
CREATE TABLE IF NOT EXISTS push_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,      -- item | items | summary
  sent_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_events_user ON push_events (user_id, sent_at);
