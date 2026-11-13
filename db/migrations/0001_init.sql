-- Fair Whack beta schema (Cloudflare D1 / SQLite)
-- Money is stored in integer cents. Times are ISO-8601 UTC strings.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- One row per product per retailer. Current price fields are denormalised
-- from the latest snapshot so the app can read them without joins.
CREATE TABLE IF NOT EXISTS retailer_product (
  id                     TEXT PRIMARY KEY,          -- "<retailer>:<retailer_product_id>"
  retailer               TEXT NOT NULL,             -- woolworths | coles | aldi | costco
  retailer_product_id    TEXT NOT NULL,
  name                   TEXT NOT NULL,
  brand                  TEXT,
  size_text              TEXT,
  size_value             REAL,                      -- total quantity in size_unit
  size_unit              TEXT,                      -- g | ml | each
  pack_count             INTEGER,
  uses_per_pack          INTEGER,
  gtin                   TEXT,
  category_path          TEXT,
  category               TEXT,                      -- Fair Whack category
  image_url              TEXT,
  product_url            TEXT,
  canonical_product_id   TEXT,
  match_method           TEXT,                      -- gtin | rule | manual | self
  match_confidence       REAL,
  family_id              TEXT,
  comparable_group_id    TEXT,
  cur_price_cents        INTEGER,
  cur_was_cents          INTEGER,
  cur_unit_cents         INTEGER,                   -- our own unit price
  cur_unit_basis         TEXT,                      -- 100g | 1L | each
  cur_retailer_unit_text TEXT,
  cur_is_special         INTEGER NOT NULL DEFAULT 0,
  cur_promo_type         TEXT,
  cur_promo_text         TEXT,
  cur_multibuy_qty       INTEGER,
  cur_multibuy_cents     INTEGER,
  cur_in_stock           INTEGER,
  cur_source             TEXT,
  cur_captured_at        TEXT,
  special_since          TEXT,                      -- start of the current special streak
  low12_cents            INTEGER,
  median12_cents         INTEGER,
  history_weeks          INTEGER,
  discount_flag          TEXT,                      -- low12 | inflated | NULL
  price_flag             TEXT,                      -- anomaly | NULL
  first_seen_at          TEXT,
  last_seen_at           TEXT,
  UNIQUE (retailer, retailer_product_id)
);
CREATE INDEX IF NOT EXISTS idx_rp_canonical ON retailer_product(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_rp_family    ON retailer_product(family_id);
CREATE INDEX IF NOT EXISTS idx_rp_group     ON retailer_product(comparable_group_id);
CREATE INDEX IF NOT EXISTS idx_rp_special   ON retailer_product(cur_is_special, retailer);
CREATE INDEX IF NOT EXISTS idx_rp_gtin      ON retailer_product(gtin);

-- Append-only price history.
CREATE TABLE IF NOT EXISTS price_snapshot (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id       TEXT NOT NULL,
  price_cents      INTEGER,
  was_cents        INTEGER,
  unit_cents       INTEGER,
  unit_basis       TEXT,
  is_special       INTEGER NOT NULL DEFAULT 0,
  promo_type       TEXT,
  promo_text       TEXT,
  multibuy_qty     INTEGER,
  multibuy_cents   INTEGER,
  in_stock         INTEGER,
  price_context    TEXT,
  source           TEXT NOT NULL,                  -- scraper | manual | user_report
  reported_by      TEXT,
  evidence_url     TEXT,
  captured_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ps_product ON price_snapshot(product_id, captured_at);

CREATE TABLE IF NOT EXISTS canonical_product (
  id                   TEXT PRIMARY KEY,
  gtin                 TEXT,
  display_name         TEXT,
  brand                TEXT,
  size_value           REAL,
  size_unit            TEXT,
  family_id            TEXT,
  comparable_group_id  TEXT,
  category             TEXT
);

-- Possible cross-retailer matches that need a human decision.
CREATE TABLE IF NOT EXISTS match_candidate (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_a   TEXT NOT NULL,
  product_b   TEXT NOT NULL,
  score       REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  created_at  TEXT NOT NULL,
  decided_by  TEXT,
  UNIQUE (product_a, product_b)
);

CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  retailer    TEXT,                                -- NULL = any supermarket
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);

CREATE TABLE IF NOT EXISTS list_items (
  id            TEXT PRIMARY KEY,
  list_id       TEXT NOT NULL,
  product_id    TEXT NOT NULL,                     -- retailer_product.id
  alert_mode    TEXT NOT NULL DEFAULT 'any',       -- any | half | target | off
  target_cents  INTEGER,
  created_at    TEXT NOT NULL,
  UNIQUE (list_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_items_product ON list_items(product_id);

CREATE TABLE IF NOT EXISTS push_subs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  promo_key   TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  UNIQUE (user_id, product_id, promo_key)
);

CREATE TABLE IF NOT EXISTS user_reports (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  retailer     TEXT NOT NULL DEFAULT 'costco',
  name         TEXT NOT NULL,
  brand        TEXT,
  size_text    TEXT,
  price_cents  INTEGER NOT NULL,
  store        TEXT,
  gtin         TEXT,
  observed_on  TEXT NOT NULL,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected
  product_id   TEXT,
  created_at   TEXT NOT NULL,
  reviewed_by  TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mode         TEXT NOT NULL,
  retailer     TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,                      -- running | ok | failed | skipped
  items        INTEGER,
  cost_usd     REAL,
  message      TEXT
);
