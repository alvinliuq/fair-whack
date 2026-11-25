-- Sharing (stage 7): friends by user name (@handle) or QR code, products shared between friends,
-- and notifications the app shows (pushed as an empty wake-up, then fetched by the service worker).
ALTER TABLE users ADD COLUMN handle TEXT;        -- lowercase, unique; chosen in Me -> My account
ALTER TABLE users ADD COLUMN friend_code TEXT;   -- random code inside the user's QR code
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users (handle);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code ON users (friend_code);

-- One row per pair of users (a < b). Both ways of adding need the other person to accept.
CREATE TABLE IF NOT EXISTS friendships (
  pair          TEXT PRIMARY KEY,      -- "<a>|<b>"
  a             TEXT NOT NULL,
  b             TEXT NOT NULL,
  status        TEXT NOT NULL,         -- pending | accepted | blocked
  requested_by  TEXT NOT NULL,
  blocked_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_a ON friendships (a);
CREATE INDEX IF NOT EXISTS idx_friend_b ON friendships (b);

CREATE TABLE IF NOT EXISTS shares (
  id          TEXT PRIMARY KEY,
  from_user   TEXT NOT NULL,
  to_user     TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  seen_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_to ON shares (to_user, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT,                    -- friend_request | friend_accepted | share
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  created_at  TEXT NOT NULL,
  shown_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, shown_at);
