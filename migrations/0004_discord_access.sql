ALTER TABLE discord_subscribers
  ADD COLUMN access_status TEXT NOT NULL DEFAULT 'approved'
  CHECK (access_status IN ('pending', 'approved', 'denied'));

CREATE INDEX IF NOT EXISTS idx_discord_subscribers_access
  ON discord_subscribers(access_status, active);
