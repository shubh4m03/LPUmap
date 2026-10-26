-- ROLLBACK of migrations/0003_artwork_associations.sql
-- (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.4).
--
-- Deliberately NOT under migrations/: wrangler must never apply it. Run it by
-- hand only after deploying the pre-0003 server, and only on a database you
-- have exported first (the export is the recovery copy):
--
--   npx wrangler d1 export lpu-atlas --remote --output before-0003-down.sql
--   npx wrangler d1 execute lpu-atlas --remote --file docs/db/0003_down.sql
--
-- NON-DESTRUCTIVE by design (owner rule: artwork links, verification
-- decisions and audit history must survive rollback and re-apply):
--  1. artwork_associations is KEPT, rows and all. The pre-0003 server never
--     reads it, so it is inert; re-applying 0003 (CREATE TABLE IF NOT EXISTS)
--     picks the same rows up again unchanged.
--  2. audit_events is rebuilt with the 0002 entity_type CHECK. No row is
--     removed: 'artwork' rows are kept with entity_type 'system' (action keeps
--     its 'artwork.' prefix and entity_id is unchanged), and re-applying 0003
--     restores 'artwork'. Ids and the AUTOINCREMENT sequence are preserved.
--  3. publication_version is bumped so clients refetch a publication without
--     artwork decisions (the pre-0003 server publishes v2).
--  4. 0003 is forgotten in d1_migrations so it can be re-applied.
-- Removing artwork_associations for good is a separate, explicitly
-- destructive step (export, then DROP TABLE by hand); it is not part of any
-- documented procedure here.
--
-- Re-apply after a rollback (when the 0003 server is deployed again):
--
--   npx wrangler d1 migrations apply lpu-atlas --remote
--
-- Rehearsal on an ISOLATED local database (never --remote), as run for the
-- artwork workflow: the same commands with --local. `d1 export --local` has no
-- --persist-to flag and reads ./.wrangler/state of the working directory, so
-- run the rehearsal from a short directory (Windows paths over 259 characters
-- make local D1 fail with "internal error"):
--
--   npx wrangler d1 migrations apply lpu-atlas --local      (0001..0003)
--   … owner decisions through the admin API …
--   npx wrangler d1 export lpu-atlas --local --output before-0003-down.sql
--   npx wrangler d1 execute lpu-atlas --local --file docs/db/0003_down.sql
--   npx wrangler d1 migrations apply lpu-atlas --local      (re-applies 0003)
--
-- Expected (tests/server/artwork/persistence.test.ts asserts the rollback and
-- re-apply parts; the export restore was rehearsed by hand): after the
-- rollback every artwork_associations row and every audit row is unchanged
-- (audit entity 'artwork' stored as 'system'); after the re-apply both are
-- byte-identical to before the rollback, the audit AUTOINCREMENT sequence is
-- unchanged, and restoring the export into an empty database reproduces them.

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
SELECT id, at, actor, action,
  CASE WHEN entity_type = 'artwork' THEN 'system' ELSE entity_type END,
  entity_id, before_json, after_json, outcome, detail
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

UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'publication_version';
UPDATE meta SET value = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'publication_updated_at';

DELETE FROM d1_migrations WHERE name = '0003_artwork_associations.sql';
