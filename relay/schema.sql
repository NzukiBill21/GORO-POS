CREATE TABLE IF NOT EXISTS mpesa_events (
  id TEXT PRIMARY KEY,
  checkout_request_id TEXT NOT NULL UNIQUE,
  tenant_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mpesa_events_pending ON mpesa_events (delivered_at, created_at);
