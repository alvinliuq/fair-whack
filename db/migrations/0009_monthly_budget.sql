-- Stage 6: monthly budget. Each run records which paid service it used (NULL = Apify, as before).
ALTER TABLE pipeline_runs ADD COLUMN provider TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_started ON pipeline_runs (started_at);
