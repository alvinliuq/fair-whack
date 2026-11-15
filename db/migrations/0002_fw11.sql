-- FW1.1: tester profile, retailer category levels, search logs, settings.
ALTER TABLE users ADD COLUMN age_range TEXT;
ALTER TABLE users ADD COLUMN gender TEXT;
ALTER TABLE users ADD COLUMN household_size TEXT;
ALTER TABLE users ADD COLUMN fav_categories TEXT;      -- JSON array of merged category names
ALTER TABLE users ADD COLUMN profile_done_at TEXT;

ALTER TABLE retailer_product ADD COLUMN cat1 TEXT;     -- retailer's own top-level category
ALTER TABLE retailer_product ADD COLUMN cat2 TEXT;     -- retailer's own second-level category
UPDATE retailer_product SET cat1 = CASE
    WHEN category_path IS NULL OR category_path = '' THEN 'Other'
    WHEN instr(category_path, ' > ') > 0 THEN substr(category_path, 1, instr(category_path, ' > ') - 1)
    ELSE category_path END;
UPDATE retailer_product SET cat2 = CASE
    WHEN instr(category_path, ' > ') = 0 THEN NULL
    WHEN instr(substr(category_path, instr(category_path, ' > ') + 3), ' > ') > 0
      THEN substr(substr(category_path, instr(category_path, ' > ') + 3), 1, instr(substr(category_path, instr(category_path, ' > ') + 3), ' > ') - 1)
    ELSE substr(category_path, instr(category_path, ' > ') + 3) END;
CREATE INDEX IF NOT EXISTS idx_rp_cat ON retailer_product (retailer, cat1, cat2);
CREATE INDEX IF NOT EXISTS idx_rp_first_seen ON retailer_product (retailer, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_rp_category ON retailer_product (category);

CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  query TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_log_time ON search_log (created_at);

CREATE TABLE IF NOT EXISTS search_history (
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  last_at TEXT NOT NULL,
  PRIMARY KEY (user_id, query)
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
