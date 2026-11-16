-- Cut database reads so the beta stays inside the free daily limit of Cloudflare D1.

-- Search index: one row per word (split into parts when a word is on very many products).
-- ids is a comma-separated list of compact product ids (see shared/search-index.js).
-- A search reads a handful of these rows instead of scanning every product.
CREATE TABLE IF NOT EXISTS word_index (
  word TEXT NOT NULL,
  part INTEGER NOT NULL,
  ids  TEXT NOT NULL,
  PRIMARY KEY (word, part)
) WITHOUT ROWID;

-- Saved answers for the heavy read-only screens (store totals, category counts, deal and
-- browse pages). Emptied by the pipeline whenever prices change.
CREATE TABLE IF NOT EXISTS api_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
