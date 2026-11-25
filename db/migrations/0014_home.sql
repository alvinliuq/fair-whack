-- Stage 7.4 Home: product page views per day, for "Most Popular".
CREATE TABLE IF NOT EXISTS product_views (
  product_id  TEXT NOT NULL,
  day         TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
  views       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, day)
);
CREATE INDEX IF NOT EXISTS idx_views_day ON product_views(day);
CREATE INDEX IF NOT EXISTS idx_items_created ON list_items(created_at);
