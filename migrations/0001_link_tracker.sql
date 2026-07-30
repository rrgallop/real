PRAGMA foreign_keys = ON;

-- The edge knows only an opaque high-entropy token and its destination. Contact
-- identity and message/campaign context remain in reCRM.
CREATE TABLE tracked_links (
  token       TEXT PRIMARY KEY
              CHECK (length(token) BETWEEN 22 AND 128),
  target_url  TEXT NOT NULL
              CHECK (length(target_url) BETWEEN 1 AND 4096),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'revoked')),
  expires_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE INDEX ix_tracked_links_status_expiry
  ON tracked_links (status, expires_at);

-- Pending rows are an at-least-once delivery buffer. reCRM drains them, commits
-- the local event and durable alert, then acknowledges by id. Ack deletes rows.
-- Raw IP addresses and raw user-agent strings are deliberately absent.
CREATE TABLE link_events (
  id             TEXT PRIMARY KEY,
  token          TEXT NOT NULL,
  event_type     TEXT NOT NULL DEFAULT 'link_requested'
                 CHECK (event_type = 'link_requested'),
  occurred_at    TEXT NOT NULL,
  request_class  TEXT NOT NULL
                 CHECK (request_class IN ('suspected_machine', 'unclassified')),
  FOREIGN KEY (token) REFERENCES tracked_links(token) ON DELETE CASCADE
);

CREATE INDEX ix_link_events_pending
  ON link_events (occurred_at, id);
