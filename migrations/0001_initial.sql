-- LPU Campus Atlas — community contributions, owner locations, overrides,
-- audit log, sessions, rate limits. See docs/COMMUNITY_MODULE_CONTRACTS.md.
--
-- Conventions: timestamps are ISO-8601 UTC text (Date#toISOString, so they
-- sort lexicographically); ids are server-generated random strings; every
-- mutable row carries an optimistic-concurrency `revision`.
-- Applied by `wrangler d1 migrations apply` and by the server test harness.

-- Public submissions. Never visible publicly; only the owner can act on them.
CREATE TABLE suggestions (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'sug_*' AND length(id) BETWEEN 8 AND 64),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  category_id TEXT NOT NULL CHECK (length(category_id) BETWEEN 1 AND 64),
  lon REAL NOT NULL CHECK (typeof(lon) = 'real' AND lon BETWEEN -180 AND 180),
  lat REAL NOT NULL CHECK (typeof(lat) = 'real' AND lat BETWEEN -90 AND 90),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  landmark TEXT CHECK (landmark IS NULL OR length(landmark) <= 160),
  evidence_url TEXT CHECK (evidence_url IS NULL OR length(evidence_url) <= 500),
  details TEXT CHECK (details IS NULL OR length(details) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'needs_information', 'approved', 'rejected', 'duplicate')),
  duplicate_of TEXT CHECK (duplicate_of IS NULL OR length(duplicate_of) BETWEEN 1 AND 200),
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 1000),
  reviewed_by TEXT,
  reviewed_at TEXT,
  published_location_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- An approved suggestion always points at the location it published, and only then.
  CHECK ((status = 'approved') = (published_location_id IS NOT NULL)),
  CHECK (status <> 'duplicate' OR duplicate_of IS NOT NULL),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id)
);

CREATE INDEX suggestions_status_created ON suggestions (status, created_at, id);
CREATE INDEX suggestions_created ON suggestions (created_at, id);
CREATE INDEX suggestions_category_created ON suggestions (category_id, created_at, id);

-- Owner-created (own:) and approved community (com:) locations.
CREATE TABLE locations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 8 AND 64),
  origin TEXT NOT NULL CHECK (origin IN ('owner', 'community')),
  suggestion_id TEXT UNIQUE REFERENCES suggestions (id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  category_id TEXT NOT NULL CHECK (length(category_id) BETWEEN 1 AND 64),
  lon REAL NOT NULL CHECK (typeof(lon) = 'real' AND lon BETWEEN -180 AND 180),
  lat REAL NOT NULL CHECK (typeof(lat) = 'real' AND lat BETWEEN -90 AND 90),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  opening_hours TEXT CHECK (opening_hours IS NULL OR length(opening_hours) <= 200),
  wheelchair TEXT NOT NULL DEFAULT 'unknown' CHECK (wheelchair IN ('yes', 'limited', 'no', 'unknown')),
  website TEXT CHECK (website IS NULL OR length(website) <= 500),
  source_url TEXT CHECK (source_url IS NULL OR length(source_url) <= 500),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('verified', 'imported', 'estimated', 'unverified')),
  last_verified_at TEXT CHECK (last_verified_at IS NULL OR last_verified_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  access_node_id INTEGER CHECK (access_node_id IS NULL OR (typeof(access_node_id) = 'integer' AND access_node_id >= 0)),
  access_note TEXT CHECK (access_note IS NULL OR length(access_note) <= 300),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- Id prefix matches origin; community locations always come from exactly one suggestion.
  CHECK ((origin = 'owner' AND id GLOB 'own:*') OR (origin = 'community' AND id GLOB 'com:*')),
  CHECK ((origin = 'community') = (suggestion_id IS NOT NULL))
);

CREATE INDEX locations_status ON locations (status, id);
CREATE INDEX locations_origin ON locations (origin, status, id);

-- Owner overrides of base (OSM/curated) places, keyed by the stable base id.
CREATE TABLE overrides (
  target_id TEXT PRIMARY KEY NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
  fields_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(fields_json) AND json_type(fields_json) = 'object'),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  access_node_id INTEGER CHECK (access_node_id IS NULL OR (typeof(access_node_id) = 'integer' AND access_node_id >= 0)),
  access_note TEXT CHECK (access_note IS NULL OR length(access_note) <= 300),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  base_dataset_version TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

-- Append-only audit log. Never holds secrets, tokens, cookies or IP addresses.
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 320),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('suggestion', 'location', 'override', 'session', 'system')),
  entity_id TEXT CHECK (entity_id IS NULL OR length(entity_id) <= 200),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failed')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 1000)
);

CREATE INDEX audit_entity ON audit_events (entity_type, entity_id, id);
CREATE INDEX audit_at ON audit_events (at);
CREATE INDEX audit_action ON audit_events (action, id);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit log is append-only');
END;

-- Owner sessions (password mode). Only an HMAC-SHA256 of the token (keyed by the password hash) is stored.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY NOT NULL CHECK (length(id_hash) BETWEEN 32 AND 128),
  actor TEXT NOT NULL,
  csrf_token TEXT NOT NULL CHECK (length(csrf_token) >= 16),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX sessions_expires ON sessions (expires_at);

-- Fixed-window rate-limit counters. `bucket` is an HMAC of client + scope +
-- window, never a raw IP. Rows are purged once expired.
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL CHECK (length(bucket) BETWEEN 8 AND 256),
  count INTEGER NOT NULL CHECK (count >= 0),
  window_start TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX rate_limits_expires ON rate_limits (expires_at);

CREATE TABLE meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT INTO meta (key, value) VALUES
  ('publication_version', '0'),
  ('publication_updated_at', '1970-01-01T00:00:00.000Z');
