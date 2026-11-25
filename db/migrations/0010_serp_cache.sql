-- Stage 6: Google Shopping results (SerpApi), saved per keyword so each keyword is looked up at most once a day.
CREATE TABLE IF NOT EXISTS serp_cache (
  q          TEXT PRIMARY KEY,   -- normalised keyword
  fetched_at TEXT NOT NULL,
  data       TEXT NOT NULL       -- JSON: { results: [...] }
);
