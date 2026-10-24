-- ROLLBACK of migrations/0002_building_studio.sql (docs/BUILDING_STUDIO_DESIGN.md §12).
--
-- Deliberately NOT under migrations/: wrangler must never apply it. Run it
-- by hand only after deploying the pre-studio server, and only after
-- exporting the studio tables (the export is the only copy of drafts and
-- published versions once this runs):
--
--   npx wrangler d1 export lpu-atlas --remote --table studio_buildings --output studio_buildings.sql
--   (repeat for studio_building_versions, studio_templates, studio_template_versions)
--   npx wrangler d1 execute lpu-atlas --remote --file docs/db/0002_down.sql
--
-- What it does:
--  1. drops the four studio tables (their triggers and indexes go with them);
--  2. rebuilds audit_events with the 0001 entity_type CHECK. Nothing is
--     removed from the append-only log: studio rows are kept with entity_type
--     'system' (their action keeps the 'building.' / 'template.' prefix and
--     entity_id is unchanged, so they stay identifiable). Ids are preserved;
--  3. bumps publication_version so clients refetch a publication that no
--     longer carries studio buildings;
--  4. forgets 0002 in d1_migrations so it can be re-applied later.

DROP TABLE studio_building_versions;
DROP TABLE studio_buildings;
DROP TABLE studio_template_versions;
DROP TABLE studio_templates;

CREATE TABLE audit_events_0001 (
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

INSERT INTO audit_events_0001 (id, at, actor, action, entity_type, entity_id, before_json, after_json, outcome, detail)
SELECT id, at, actor, action,
  CASE WHEN entity_type IN ('building', 'template') THEN 'system' ELSE entity_type END,
  entity_id, before_json, after_json, outcome, detail
FROM audit_events
ORDER BY id;

DROP TABLE audit_events;

ALTER TABLE audit_events_0001 RENAME TO audit_events;

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

UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'publication_version';
UPDATE meta SET value = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'publication_updated_at';

DELETE FROM d1_migrations WHERE name = '0002_building_studio.sql';
