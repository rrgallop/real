PRAGMA foreign_keys = ON;

-- Campaign unsubscribe links are intentionally separate from tracked links.
-- The raw bearer token exists only in the public URL and request. D1 retains
-- its SHA-256 digest plus opaque CRM UUIDs and a category key. Contact identity,
-- addresses, message copy, campaign content, and raw tokens never enter D1.
CREATE TABLE campaign_unsubscribe_tokens (
  token_hash          TEXT PRIMARY KEY
                      CHECK (
                        length(token_hash) = 64
                        AND token_hash NOT GLOB '*[^0-9a-f]*'
                      ),
  campaign_id         TEXT NOT NULL
                      CHECK (length(campaign_id) = 36),
  enrollment_id       TEXT NOT NULL
                      CHECK (length(enrollment_id) = 36),
  marketing_category  TEXT NOT NULL
                      CHECK (length(marketing_category) BETWEEN 1 AND 64),
  expires_at          TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX ix_campaign_unsubscribe_tokens_expiry
  ON campaign_unsubscribe_tokens (expires_at);

-- This is an append-only, at-least-once handoff ledger. One token represents
-- one recipient/campaign enrollment, so the unique token digest makes
-- RFC 8058 POST retries idempotent without cookies or any browser identity.
CREATE TABLE campaign_unsubscribe_events (
  id                  TEXT PRIMARY KEY,
  token_hash          TEXT NOT NULL UNIQUE
                      CHECK (
                        length(token_hash) = 64
                        AND token_hash NOT GLOB '*[^0-9a-f]*'
                      ),
  campaign_id         TEXT NOT NULL
                      CHECK (length(campaign_id) = 36),
  enrollment_id       TEXT NOT NULL
                      CHECK (length(enrollment_id) = 36),
  marketing_category  TEXT NOT NULL
                      CHECK (length(marketing_category) BETWEEN 1 AND 64),
  occurred_at         TEXT NOT NULL,
  FOREIGN KEY (token_hash)
    REFERENCES campaign_unsubscribe_tokens(token_hash)
);

CREATE INDEX ix_campaign_unsubscribe_events_pending
  ON campaign_unsubscribe_events (occurred_at, id);

-- Acknowledgements are append-only too. Keeping them separate from the event
-- means reCRM can safely retry drains and acknowledgements without deleting
-- the evidence of a recipient's opt-out request.
CREATE TABLE campaign_unsubscribe_event_acks (
  event_id         TEXT PRIMARY KEY,
  acknowledged_at  TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES campaign_unsubscribe_events(id)
);
