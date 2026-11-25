-- Stage 7: "Same product in other stores". A tester can say a matched product is not the same:
-- it is hidden for them at once (match_hidden) and goes to Admin -> Possible matches as 'reported'.
CREATE TABLE IF NOT EXISTS match_hidden (
  user_id     TEXT NOT NULL,
  product_id  TEXT NOT NULL,     -- the product on their list
  other_id    TEXT NOT NULL,     -- the product they say is different
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id, other_id)
);
ALTER TABLE match_candidate ADD COLUMN reported_by TEXT;
ALTER TABLE match_candidate ADD COLUMN reported_other TEXT;   -- the product the tester said is different
