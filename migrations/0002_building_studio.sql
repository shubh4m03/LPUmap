-- LPU Campus Atlas — Building Studio. See docs/BUILDING_STUDIO_DESIGN.md §8.
--
-- Adds owner templates (versioned), studio buildings (one mutable head per
-- building + immutable published versions) and rebuilds audit_events so it
-- accepts the entity types 'building' and 'template'. Conventions as in
-- 0001: ISO-8601 UTC text timestamps, server-generated random ids, an
-- optimistic-concurrency `revision` on every mutable row.
--
-- Rollback: docs/db/0002_down.sql (kept OUT of migrations/ so wrangler never
-- applies it). No new meta keys: studio publishes bump the existing
-- publication_version in the same batch as the change.

-- Owner templates: variants of a code generator. The head row is mutable
-- (name, status, latest_version); every definition lives in an immutable
-- version row. Retiring hides a template from new placements only.
CREATE TABLE studio_templates (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'stv:*' AND length(id) BETWEEN 24 AND 36 AND NOT (substr(id, 5) GLOB '*[^a-z2-7]*')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  latest_version INTEGER NOT NULL CHECK (typeof(latest_version) = 'integer' AND latest_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE INDEX studio_templates_status ON studio_templates (status, name, id);

-- Immutable template versions (TemplateDefinition JSON). Never updated or
-- deleted: instances store their full resolved model, so a template version
-- is provenance, and generator versions in use stay queryable.
CREATE TABLE studio_template_versions (
  template_id TEXT NOT NULL REFERENCES studio_templates (id),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  definition_json TEXT NOT NULL
    CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object' AND length(definition_json) <= 16384),
  generator_id TEXT NOT NULL CHECK (length(generator_id) BETWEEN 1 AND 64),
  generator_version INTEGER NOT NULL CHECK (typeof(generator_version) = 'integer' AND generator_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, version)
);

CREATE INDEX studio_template_versions_generator ON studio_template_versions (generator_id, generator_version);

CREATE TRIGGER studio_template_versions_no_update BEFORE UPDATE ON studio_template_versions
BEGIN
  SELECT RAISE(ABORT, 'template versions are immutable');
END;

CREATE TRIGGER studio_template_versions_no_delete BEFORE DELETE ON studio_template_versions
BEGIN
  SELECT RAISE(ABORT, 'template versions are immutable');
END;

-- Studio buildings: one head per building. target_id is NULL for a new
-- building (public id = id) or the base building it models (public id =
-- target_id; at most one studio record per base building). draft_json holds
-- the editable StudioDraft (may fail publish validation); it is cleared by a
-- publish. published_version is the latest published version and is kept
-- while archived so restore can re-publish it.
CREATE TABLE studio_buildings (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id GLOB 'stu:*' AND length(id) BETWEEN 24 AND 36 AND NOT (substr(id, 5) GLOB '*[^a-z2-7]*')),
  target_id TEXT UNIQUE
    CHECK (target_id IS NULL OR (length(target_id) BETWEEN 5 AND 200
      AND (target_id GLOB 'osm:way/[1-9]*' OR target_id GLOB 'osm:relation/[1-9]*' OR target_id GLOB 'cur:[a-z0-9]*'))),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  draft_json TEXT
    CHECK (draft_json IS NULL OR (json_valid(draft_json) AND json_type(draft_json) = 'object' AND length(draft_json) <= 16384)),
  draft_revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(draft_revision) = 'integer' AND draft_revision >= 0),
  draft_saved_by TEXT,
  draft_saved_at TEXT,
  published_version INTEGER
    CHECK (published_version IS NULL OR (typeof(published_version) = 'integer' AND published_version >= 1)),
  archived_by TEXT,
  archived_at TEXT,
  archive_reason TEXT CHECK (archive_reason IS NULL OR length(archive_reason) <= 500),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  -- A never-published record is a draft and always has draft content.
  CHECK (status <> 'draft' OR (published_version IS NULL AND draft_json IS NOT NULL)),
  CHECK (status <> 'published' OR published_version IS NOT NULL),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  CHECK (archive_reason IS NULL OR archived_at IS NOT NULL),
  CHECK ((draft_json IS NULL) = (draft_saved_at IS NULL)),
  CHECK ((draft_saved_at IS NULL) = (draft_saved_by IS NULL)),
  CHECK (draft_json IS NULL OR draft_revision >= 1)
);

CREATE INDEX studio_buildings_status ON studio_buildings (status, updated_at, id);
CREATE INDEX studio_buildings_updated ON studio_buildings (updated_at, id);

-- Permanent delete only for archived records (typed confirmation in the API).
CREATE TRIGGER studio_buildings_delete_archived_only BEFORE DELETE ON studio_buildings
WHEN OLD.status <> 'archived'
BEGIN
  SELECT RAISE(ABORT, 'only archived studio buildings can be deleted');
END;

-- Immutable published snapshots, including the server-derived footprint and
-- the campus membership computed at publish. record_json is the full
-- StudioDraft as published (private notes included; the public payload is
-- derived from it without notes, actors or drafts).
CREATE TABLE studio_building_versions (
  building_id TEXT NOT NULL REFERENCES studio_buildings (id),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  record_json TEXT NOT NULL
    CHECK (json_valid(record_json) AND json_type(record_json) = 'object' AND length(record_json) <= 16384),
  footprint_json TEXT NOT NULL
    CHECK (json_valid(footprint_json) AND json_extract(footprint_json, '$.type') = 'Polygon' AND length(footprint_json) <= 32768),
  footprint_area_m2 REAL NOT NULL CHECK (footprint_area_m2 > 0),
  membership_json TEXT NOT NULL CHECK (json_valid(membership_json) AND json_type(membership_json) = 'object'),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json) AND json_type(validation_json) = 'object'),
  acknowledgements_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(acknowledgements_json) AND json_type(acknowledgements_json) = 'array'),
  change_summary TEXT NOT NULL CHECK (length(change_summary) BETWEEN 3 AND 500),
  model_config_version INTEGER NOT NULL CHECK (typeof(model_config_version) = 'integer' AND model_config_version >= 1),
  generator_id TEXT NOT NULL CHECK (length(generator_id) BETWEEN 1 AND 64),
  generator_version INTEGER NOT NULL CHECK (typeof(generator_version) = 'integer' AND generator_version >= 1),
  accuracy_class TEXT NOT NULL CHECK (accuracy_class IN ('generic-prefab', 'stylized', 'source-backed', 'surveyed')),
  position_corrected INTEGER NOT NULL DEFAULT 0 CHECK (position_corrected IN (0, 1)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (building_id, version)
);

CREATE INDEX studio_building_versions_generator ON studio_building_versions (generator_id, generator_version);

CREATE TRIGGER studio_building_versions_no_update BEFORE UPDATE ON studio_building_versions
BEGIN
  SELECT RAISE(ABORT, 'published versions are immutable');
END;

-- Versions go only together with their archived building (permanent delete).
CREATE TRIGGER studio_building_versions_delete_archived_only BEFORE DELETE ON studio_building_versions
WHEN (SELECT status FROM studio_buildings WHERE id = OLD.building_id) IS NOT 'archived'
BEGIN
  SELECT RAISE(ABORT, 'versions are deleted only with their archived building');
END;

-- Rebuild audit_events with the wider entity_type CHECK. Every row is copied
-- with its id; the AUTOINCREMENT sequence follows the table through the
-- rename (no row was ever deleted, so it equals MAX(id)). The indexes and
-- the append-only triggers are recreated exactly as in 0001.
CREATE TABLE audit_events_0002 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 320),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  entity_type TEXT NOT NULL
    CHECK (entity_type IN ('suggestion', 'location', 'override', 'session', 'system', 'building', 'template')),
  entity_id TEXT CHECK (entity_id IS NULL OR length(entity_id) <= 200),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failed')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 1000)
);

INSERT INTO audit_events_0002 (id, at, actor, action, entity_type, entity_id, before_json, after_json, outcome, detail)
SELECT id, at, actor, action, entity_type, entity_id, before_json, after_json, outcome, detail
FROM audit_events
ORDER BY id;

DROP TABLE audit_events;

ALTER TABLE audit_events_0002 RENAME TO audit_events;

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
