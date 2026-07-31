PRAGMA defer_foreign_keys = ON;

-- Existing tracked links are redirects. The kind is immutable so an opaque
-- token can never change from a destination redirect into a rendered page (or
-- vice versa) after it has been distributed.
ALTER TABLE tracked_links
  ADD COLUMN link_kind TEXT NOT NULL DEFAULT 'redirect'
  CHECK (link_kind IN ('redirect', 'wrapper'));

CREATE TRIGGER tr_tracked_links_link_kind_immutable
BEFORE UPDATE OF link_kind ON tracked_links
WHEN NEW.link_kind <> OLD.link_kind
BEGIN
  SELECT RAISE(ABORT, 'tracked link kind is immutable');
END;

CREATE TRIGGER tr_wrapper_link_destination_immutable
BEFORE UPDATE OF target_url, expires_at ON tracked_links
WHEN OLD.link_kind = 'wrapper'
  AND (
    NEW.target_url IS NOT OLD.target_url
    OR NEW.expires_at IS NOT OLD.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'wrapper destination and expiry are immutable');
END;

-- This table deliberately contains only the approved public wrapper copy and
-- rendering configuration. Contact identity, CRM ids, campaign/source context,
-- and recipient data remain in reCRM and are joined there by opaque token.
CREATE TABLE wrapper_pages (
  token                    TEXT PRIMARY KEY,
  schema_version           INTEGER NOT NULL
                           CHECK (schema_version = 1),
  content_hash             TEXT NOT NULL
                           CHECK (
                             length(content_hash) = 64
                             AND content_hash NOT GLOB '*[^0-9a-f]*'
                           ),
  dwell_threshold_seconds  INTEGER NOT NULL
                           CHECK (
                             dwell_threshold_seconds BETWEEN 5 AND 3600
                           ),
  listing_address          TEXT NOT NULL
                           CHECK (length(listing_address) BETWEEN 1 AND 250),
  property_intro           TEXT NOT NULL
                           CHECK (length(property_intro) BETWEEN 1 AND 2000),
  ryan_note                TEXT NOT NULL
                           CHECK (length(ryan_note) BETWEEN 1 AND 2000),
  fact_sections_json       TEXT NOT NULL
                           CHECK (
                             json_valid(fact_sections_json)
                             AND json_type(fact_sections_json) = 'array'
                             AND json_array_length(fact_sections_json)
                               BETWEEN 0 AND 4
                           ),
  hero_json                TEXT NOT NULL
                           CHECK (
                             json_valid(hero_json)
                             AND json_type(hero_json) = 'object'
                           ),
  created_at               TEXT NOT NULL,
  FOREIGN KEY (token) REFERENCES tracked_links(token) ON DELETE CASCADE
);

CREATE TRIGGER tr_wrapper_pages_require_wrapper_kind
BEFORE INSERT ON wrapper_pages
WHEN (
  SELECT link_kind
    FROM tracked_links
   WHERE token = NEW.token
) <> 'wrapper'
BEGIN
  SELECT RAISE(ABORT, 'wrapper page requires wrapper link kind');
END;

CREATE TRIGGER tr_wrapper_pages_immutable
BEFORE UPDATE ON wrapper_pages
BEGIN
  SELECT RAISE(ABORT, 'wrapper page is immutable');
END;

-- Rebuild the at-least-once buffer so it can hold wrapper evidence while
-- retaining every Phase A redirect event. Raw IP and user-agent data remain
-- absent. Client event ids exist only for browser wrapper telemetry and provide
-- retry deduplication without cookies or persistent browser storage.
CREATE TABLE link_events_next (
  id               TEXT PRIMARY KEY,
  token            TEXT NOT NULL,
  event_type       TEXT NOT NULL
                   CHECK (
                     event_type IN (
                       'link_requested',
                       'wrapper_viewed',
                       'wrapper_engaged'
                     )
                   ),
  occurred_at      TEXT NOT NULL,
  request_class    TEXT NOT NULL
                   CHECK (
                     request_class IN (
                       'suspected_machine',
                       'unclassified'
                     )
                   ),
  engagement_kind  TEXT
                   CHECK (
                     engagement_kind IS NULL
                     OR engagement_kind IN ('dwell', 'cta')
                   ),
  dwell_ms         INTEGER,
  client_event_id  TEXT,
  FOREIGN KEY (token) REFERENCES tracked_links(token) ON DELETE CASCADE,
  CHECK (
    (
      event_type = 'link_requested'
      AND engagement_kind IS NULL
      AND dwell_ms IS NULL
      AND client_event_id IS NULL
    )
    OR (
      event_type = 'wrapper_viewed'
      AND engagement_kind IS NULL
      AND dwell_ms IS NULL
      AND client_event_id IS NOT NULL
      AND length(client_event_id) = 36
    )
    OR (
      event_type = 'wrapper_engaged'
      AND client_event_id IS NOT NULL
      AND length(client_event_id) = 36
      AND (
        (
          engagement_kind = 'dwell'
          AND dwell_ms BETWEEN 5000 AND 3600000
        )
        OR (
          engagement_kind = 'cta'
          AND dwell_ms IS NULL
        )
      )
    )
  )
);

INSERT INTO link_events_next (
  id,
  token,
  event_type,
  occurred_at,
  request_class,
  engagement_kind,
  dwell_ms,
  client_event_id
)
SELECT
  id,
  token,
  event_type,
  occurred_at,
  request_class,
  NULL,
  NULL,
  NULL
FROM link_events;

DROP TABLE link_events;
ALTER TABLE link_events_next RENAME TO link_events;

CREATE INDEX ix_link_events_pending
  ON link_events (occurred_at, id);

CREATE UNIQUE INDEX ux_link_events_client_event_id
  ON link_events (client_event_id)
  WHERE client_event_id IS NOT NULL;

-- Privacy-preserving abuse controls are keyed only by opaque wrapper token,
-- UTC day, and evidence kind. They intentionally retain no IP address, user
-- agent, cookie, contact id, or other recipient identity. These counters live
-- independently of the drainable event buffer so acknowledging evidence does
-- not reset the daily allowance for a token.
CREATE TABLE wrapper_event_rate_buckets (
  token         TEXT NOT NULL,
  utc_day       TEXT NOT NULL
                CHECK (
                  length(utc_day) = 10
                  AND date(utc_day) IS utc_day
                ),
  event_kind    TEXT NOT NULL
                CHECK (event_kind IN ('view', 'dwell', 'cta')),
  event_count   INTEGER NOT NULL
                CHECK (event_count >= 1),
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (token, utc_day, event_kind),
  FOREIGN KEY (token) REFERENCES tracked_links(token) ON DELETE CASCADE
);

CREATE INDEX ix_wrapper_event_rate_buckets_day
  ON wrapper_event_rate_buckets (utc_day);

-- D1 executes this trigger and the outer event insert as one atomic statement.
-- A replayed client event id does not increment a bucket; a new event increments
-- its bucket and is rejected in the same transaction if that would cross the
-- daily limit. RAISE(ABORT) rolls the increment back along with the event.
-- Keep the three trigger bodies explicit instead of using CASE expressions.
-- Wrangler's remote D1 migration splitter treats CASE/END inside a trigger as
-- trigger-block delimiters and otherwise joins the migration ledger insert to
-- this statement. The event-specific form is logically equivalent and remains
-- atomic with the outer event insert.
CREATE TRIGGER tr_wrapper_view_rate_limit
BEFORE INSERT ON link_events
WHEN NEW.event_type = 'wrapper_viewed'
BEGIN
  DELETE FROM wrapper_event_rate_buckets
   WHERE utc_day < date(NEW.occurred_at, '-14 days');

  INSERT INTO wrapper_event_rate_buckets (
    token,
    utc_day,
    event_kind,
    event_count,
    updated_at
  )
  SELECT
    NEW.token,
    substr(NEW.occurred_at, 1, 10),
    'view',
    1,
    NEW.occurred_at
  WHERE NOT EXISTS (
    SELECT 1
      FROM link_events
     WHERE client_event_id = NEW.client_event_id
  )
  ON CONFLICT (token, utc_day, event_kind)
  DO UPDATE SET
    event_count = wrapper_event_rate_buckets.event_count + 1,
    updated_at = excluded.updated_at;

  SELECT RAISE(ABORT, 'wrapper_event_rate_limited')
  WHERE NOT EXISTS (
    SELECT 1
      FROM link_events
     WHERE client_event_id = NEW.client_event_id
  )
  AND (
    SELECT event_count
      FROM wrapper_event_rate_buckets
     WHERE token = NEW.token
       AND utc_day = substr(NEW.occurred_at, 1, 10)
       AND event_kind = 'view'
  ) > 12;
END;

CREATE TRIGGER tr_wrapper_dwell_rate_limit
BEFORE INSERT ON link_events
WHEN NEW.event_type = 'wrapper_engaged'
  AND NEW.engagement_kind = 'dwell'
BEGIN
  DELETE FROM wrapper_event_rate_buckets
   WHERE utc_day < date(NEW.occurred_at, '-14 days');

  INSERT INTO wrapper_event_rate_buckets (
    token,
    utc_day,
    event_kind,
    event_count,
    updated_at
  )
  SELECT
    NEW.token,
    substr(NEW.occurred_at, 1, 10),
    'dwell',
    1,
    NEW.occurred_at
  WHERE NOT EXISTS (
    SELECT 1
      FROM link_events
     WHERE client_event_id = NEW.client_event_id
  )
  ON CONFLICT (token, utc_day, event_kind)
  DO UPDATE SET
    event_count = wrapper_event_rate_buckets.event_count + 1,
    updated_at = excluded.updated_at;

  SELECT RAISE(ABORT, 'wrapper_event_rate_limited')
  WHERE NOT EXISTS (
    SELECT 1
      FROM link_events
     WHERE client_event_id = NEW.client_event_id
  )
  AND (
    SELECT event_count
      FROM wrapper_event_rate_buckets
     WHERE token = NEW.token
       AND utc_day = substr(NEW.occurred_at, 1, 10)
       AND event_kind = 'dwell'
  ) > 12;
END;

CREATE TRIGGER tr_wrapper_cta_rate_limit
BEFORE INSERT ON link_events
WHEN NEW.event_type = 'wrapper_engaged'
  AND NEW.engagement_kind = 'cta'
BEGIN
  DELETE FROM wrapper_event_rate_buckets
   WHERE utc_day < date(NEW.occurred_at, '-14 days');

  INSERT INTO wrapper_event_rate_buckets (
    token,
    utc_day,
    event_kind,
    event_count,
    updated_at
  )
  SELECT
    NEW.token,
    substr(NEW.occurred_at, 1, 10),
    'cta',
    1,
    NEW.occurred_at
  WHERE NOT EXISTS (
    SELECT 1
      FROM link_events
     WHERE client_event_id = NEW.client_event_id
  )
  ON CONFLICT (token, utc_day, event_kind)
  DO UPDATE SET
    event_count = wrapper_event_rate_buckets.event_count + 1,
    updated_at = excluded.updated_at;

  SELECT RAISE(ABORT, 'wrapper_event_rate_limited')
  WHERE NOT EXISTS (
    SELECT 1
      FROM link_events
     WHERE client_event_id = NEW.client_event_id
  )
  AND (
    SELECT event_count
      FROM wrapper_event_rate_buckets
     WHERE token = NEW.token
       AND utc_day = substr(NEW.occurred_at, 1, 10)
       AND event_kind = 'cta'
  ) > 6;
END;
