-- Product page, Google Shopping rail: a tester can ignore one shop's result for one product (greyed, left out of "Lowest").
CREATE TABLE IF NOT EXISTS user_web_ignore (
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  store_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id, store_key)
);
