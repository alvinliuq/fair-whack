-- FW2.2 "Your Brand, Your Deal": partner brand campaigns on Home.
-- A brand runs campaigns (a sale on its own site, or a retailer event such as a Black Friday page).
-- Paid placement never touches search, store comparisons or Top 20: only this section.

CREATE TABLE IF NOT EXISTS brands (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  website     TEXT,
  logo_url    TEXT,
  color       TEXT,                 -- background behind the logo, e.g. #000000
  contact     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | paused
  checks      TEXT,                 -- JSON: admission checks ticked by the admin
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id           TEXT PRIMARY KEY,
  brand_id     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'brand',    -- brand (brand's own site) | retailer (a retailer's event page)
  title        TEXT NOT NULL,                    -- e.g. "Summer Sale"
  offer        TEXT NOT NULL,                    -- one line, e.g. "Up to 40% off running shoes"
  reason       TEXT,                             -- reason shown when nothing personal matches
  details      TEXT,                             -- what the offer is, in a few lines
  code         TEXT,                             -- Fair Whack exclusive code (optional)
  perk         TEXT,                             -- other extra benefit (optional)
  terms        TEXT,
  image_url    TEXT,
  landing_url  TEXT NOT NULL,
  add_utm      INTEGER NOT NULL DEFAULT 1,       -- add utm_source=fairwhack… (turn off for affiliate links)
  starts_at    TEXT NOT NULL,
  ends_at      TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,       -- higher shows first
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft | live | paused | ended
  target       TEXT,                             -- JSON: { sizes:[], ages:[], kids:true|false|null, pets:[] }
  notified_at  TEXT,                             -- brand alerts sent for this campaign
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status, ends_at);

-- Featured products on a campaign page. compare_ids: Fair Whack products that are the same item at stores.
CREATE TABLE IF NOT EXISTS campaign_products (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  name         TEXT NOT NULL,
  image_url    TEXT,
  price_cents  INTEGER,
  was_cents    INTEGER,
  url          TEXT,
  compare_ids  TEXT
);
CREATE INDEX IF NOT EXISTS idx_cprod_campaign ON campaign_products (campaign_id, sort);

-- Matching tags: category (Fair Whack category) | brand (brand name as it appears on products).
CREATE TABLE IF NOT EXISTS campaign_tags (
  campaign_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (campaign_id, kind, value)
);

CREATE TABLE IF NOT EXISTS user_brand_follow (
  user_id     TEXT NOT NULL,
  brand_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, brand_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_brand ON user_brand_follow (brand_id);

-- "Not interested": the brand is hidden from this person until `until` (90 days).
CREATE TABLE IF NOT EXISTS user_brand_hide (
  user_id     TEXT NOT NULL,
  brand_id    TEXT NOT NULL,
  until       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, brand_id)
);

-- view | open (share page, signed out) | click | share | wish | follow | hide. Views count once per person a day.
CREATE TABLE IF NOT EXISTS campaign_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  TEXT NOT NULL,
  user_id      TEXT,
  kind         TEXT NOT NULL,
  day          TEXT NOT NULL,
  ref          TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cevents ON campaign_events (campaign_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cevents_view ON campaign_events (campaign_id, user_id, day) WHERE kind = 'view';

-- Images uploaded in Admin (logos, campaign and product photos), served from /api/assets/<id>.
CREATE TABLE IF NOT EXISTS brand_assets (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,   -- base64
  bytes       INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN brand_alerts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN referred_by TEXT;
