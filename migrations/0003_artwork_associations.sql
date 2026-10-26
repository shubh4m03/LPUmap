-- LPU Campus Atlas — owner verification of the campus illustration.
-- See docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.
--
-- Adds artwork_associations (one owner decision per artwork subject; the
-- curated registry is the baseline and a row here overrides it whole) and
-- rebuilds audit_events so it accepts the entity type 'artwork'.
-- Conventions as in 0001/0002: ISO-8601 UTC text timestamps, an
-- optimistic-concurrency `revision` on the mutable row.
--
-- Re-apply safety: docs/db/0003_down.sql deliberately KEEPS
-- artwork_associations (owner decisions must survive a rollback), so this
-- file uses IF NOT EXISTS for that table and its indexes, and the audit
-- rebuild restores the entity type of 'artwork.*' rows the rollback stored
-- as 'system'. On a fresh database both are no-ops.

-- One owner decision per subject (art:num-25, art:scene-091, art:area-…).
-- building_id: verified → the canonical building; approximate → the
-- candidate footprint shown as "Unconfirmed match" (never routed);
-- unresolved → NULL. evidence_json is public; note is private (never published).
CREATE TABLE IF NOT EXISTS artwork_associations (
  subject_id TEXT PRIMARY KEY NOT NULL
    CHECK (length(subject_id) BETWEEN 9 AND 64
      AND (subject_id GLOB 'art:num-[a-z0-9]*' OR subject_id GLOB 'art:scene-[a-z0-9]*' OR subject_id GLOB 'art:area-[a-z0-9]*')
      AND NOT (substr(subject_id, 5) GLOB '*[^a-z0-9-]*')),
  status TEXT NOT NULL CHECK (status IN ('verified', 'approximate', 'unresolved')),
  building_id TEXT
    CHECK (building_id IS NULL OR (length(building_id) BETWEEN 5 AND 200
      AND (building_id GLOB 'osm:way/[1-9]*' OR building_id GLOB 'osm:relation/[1-9]*'
        OR building_id GLOB 'cur:[a-z0-9]*' OR building_id GLOB 'stu:[a-z2-7]*'))),
  evidence_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'array' AND length(evidence_json) <= 8192),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  -- unresolved ⇔ no building; verified needs at least one piece of evidence.
  CHECK ((status = 'unresolved') = (building_id IS NULL)),
  CHECK (status <> 'verified' OR json_array_length(evidence_json) >= 1)
);

CREATE INDEX IF NOT EXISTS artwork_associations_building ON artwork_associations (building_id, subject_id);
CREATE INDEX IF NOT EXISTS artwork_associations_status ON artwork_associations (status, subject_id);

-- Rebuild audit_events with the wider entity_type CHECK (as 0002 did). Every
-- row is copied with its id, so the AUTOINCREMENT sequence follows the table
-- through the rename; indexes and append-only triggers are recreated exactly.
-- 'artwork.*' rows kept as 'system' by docs/db/0003_down.sql get 'artwork' back.
CREATE TABLE audit_events_0003 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 320),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('suggestion', 'location', 'override', 'session', 'system', 'building', 'template', 'artwork')),
  entity_id TEXT CHECK (entity_id IS NULL OR length(entity_id) <= 200),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failed')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 1000)
);

INSERT INTO audit_events_0003 (id, at, actor, action, entity_type, entity_id, before_json, after_json, outcome, detail)
SELECT id, at, actor, action,
  CASE WHEN entity_type = 'system' AND action GLOB 'artwork.*' THEN 'artwork' ELSE entity_type END,
  entity_id, before_json, after_json, outcome, detail
FROM audit_events
ORDER BY id;

DROP TABLE audit_events;

ALTER TABLE audit_events_0003 RENAME TO audit_events;

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
