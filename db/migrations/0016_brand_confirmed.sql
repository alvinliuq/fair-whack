-- A brand campaign shows as "Partner" only once the arrangement is confirmed with the brand.
-- Until then it is a "Demo" for the internal beta: labelled as such, no public share link, no push alerts.
ALTER TABLE brands ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE brands ADD COLUMN confirmed_at TEXT;
