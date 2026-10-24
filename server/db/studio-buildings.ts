/**
 * Building Studio repository (migration 0002): one mutable head row per
 * building (`studio_buildings`) and its immutable published versions
 * (`studio_building_versions`). JSON columns are stored as written by the
 * domain (already schema-checked) and parsed leniently on read: an unknown or
 * newer shape is kept as raw JSON (never dropped) and the domain decides how
 * to present it (docs/BUILDING_STUDIO_DESIGN.md §12).
 *
 * Every mutating statement is optimistic (`WHERE id = ? AND revision = ?`)
 * and is composed into one db.batch by the domain.
 */
import type { SqlDatabase, SqlStatement } from './types.ts';
import { clampLimit, likeContains, stmt } from './sql.ts';

export type StudioStatus = 'draft' | 'published' | 'archived';

export interface StudioBuildingRow {
  id: string;
  targetId: string | null;
  status: StudioStatus;
  /** Parsed draft_json (unvalidated), or null when there is no draft. */
  draft: unknown;
  draftRevision: number;
  draftSavedBy: string | null;
  draftSavedAt: string | null;
  publishedVersion: number | null;
  archivedBy: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

export interface StudioVersionRow {
  buildingId: string;
  version: number;
  /** Parsed record_json (the StudioDraft as published, private notes included). */
  record: unknown;
  footprint: unknown;
  footprintAreaM2: number;
  membership: unknown;
  validation: unknown;
  acknowledgements: unknown;
  changeSummary: string;
  modelConfigVersion: number;
  generatorId: string;
  generatorVersion: number;
  accuracyClass: string;
  positionCorrected: boolean;
  publishedBy: string;
  publishedAt: string;
}

type Row = Record<string, unknown>;
const str = (r: Row, k: string): string => String(r[k]);
const optStr = (r: Row, k: string): string | null =>
  r[k] === null || r[k] === undefined ? null : String(r[k]);
const num = (r: Row, k: string): number => Number(r[k]);
const optNum = (r: Row, k: string): number | null =>
  r[k] === null || r[k] === undefined ? null : Number(r[k]);

/** JSON column → value; unparsable text (never written by this code) → null. */
export function parseJsonColumn(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  try {
    return JSON.parse(String(v)) as unknown;
  } catch {
    return null;
  }
}

export function rowToStudioBuilding(r: Row): StudioBuildingRow {
  return {
    id: str(r, 'id'),
    targetId: optStr(r, 'target_id'),
    status: str(r, 'status') as StudioStatus,
    draft: parseJsonColumn(r.draft_json),
    draftRevision: num(r, 'draft_revision'),
    draftSavedBy: optStr(r, 'draft_saved_by'),
    draftSavedAt: optStr(r, 'draft_saved_at'),
    publishedVersion: optNum(r, 'published_version'),
    archivedBy: optStr(r, 'archived_by'),
    archivedAt: optStr(r, 'archived_at'),
    archiveReason: optStr(r, 'archive_reason'),
    createdBy: str(r, 'created_by'),
    createdAt: str(r, 'created_at'),
    updatedBy: str(r, 'updated_by'),
    updatedAt: str(r, 'updated_at'),
    revision: num(r, 'revision'),
  };
}

export function rowToStudioVersion(r: Row): StudioVersionRow {
  return {
    buildingId: str(r, 'building_id'),
    version: num(r, 'version'),
    record: parseJsonColumn(r.record_json),
    footprint: parseJsonColumn(r.footprint_json),
    footprintAreaM2: num(r, 'footprint_area_m2'),
    membership: parseJsonColumn(r.membership_json),
    validation: parseJsonColumn(r.validation_json),
    acknowledgements: parseJsonColumn(r.acknowledgements_json),
    changeSummary: str(r, 'change_summary'),
    modelConfigVersion: num(r, 'model_config_version'),
    generatorId: str(r, 'generator_id'),
    generatorVersion: num(r, 'generator_version'),
    accuracyClass: str(r, 'accuracy_class'),
    positionCorrected: num(r, 'position_corrected') === 1,
    publishedBy: str(r, 'published_by'),
    publishedAt: str(r, 'published_at'),
  };
}

// --- head --------------------------------------------------------------------

/** A new head as the domain builds it (draft_json already serialized and size-checked). */
export interface NewStudioBuilding {
  id: string;
  targetId: string | null;
  draftJson: string;
  actor: string;
  now: string;
}

/**
 * INSERT of a new draft head (rev 1, draftRevision 1). ON CONFLICT DO NOTHING:
 * a second record for the same target (UNIQUE target_id) changes nothing, so
 * the caller sees 0 changes and answers 409 with the existing head.
 */
export function insertStudioBuildingStmt(db: SqlDatabase, b: NewStudioBuilding): SqlStatement {
  return stmt(
    db,
    `INSERT INTO studio_buildings (id, target_id, status, draft_json, draft_revision, draft_saved_by, draft_saved_at,
       published_version, archived_by, archived_at, archive_reason, created_by, created_at, updated_by, updated_at, revision)
     VALUES (?, ?, 'draft', ?, 1, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, 1)
     ON CONFLICT DO NOTHING`,
    b.id,
    b.targetId,
    b.draftJson,
    b.actor,
    b.now,
    b.actor,
    b.now,
    b.actor,
    b.now,
  );
}

/** Precondition of every optimistic head write: the row still has this revision (and status). */
export function headGuard(
  id: string,
  revision: number,
  status?: StudioStatus,
): { sql: string; values: (string | number)[] } {
  return status
    ? {
        sql: 'EXISTS (SELECT 1 FROM studio_buildings WHERE id = ? AND revision = ? AND status = ?)',
        values: [id, revision, status],
      }
    : {
        sql: 'EXISTS (SELECT 1 FROM studio_buildings WHERE id = ? AND revision = ?)',
        values: [id, revision],
      };
}

/** Saves draft content (draftRevision + 1). Never applies to an archived record. */
export function saveDraftStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  draftJson: string,
  actor: string,
  now: string,
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_buildings SET draft_json = ?, draft_revision = draft_revision + 1, draft_saved_by = ?,
       draft_saved_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ? AND status <> 'archived'`,
    draftJson,
    actor,
    now,
    actor,
    now,
    id,
    expectedRevision,
  );
}

/** Clears the draft of a published record (the public record is unchanged). */
export function discardDraftStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  actor: string,
  now: string,
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_buildings SET draft_json = NULL, draft_saved_by = NULL, draft_saved_at = NULL,
       updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ? AND status = 'published' AND draft_json IS NOT NULL`,
    actor,
    now,
    id,
    expectedRevision,
  );
}

/**
 * Publish: status 'published', published_version = `version`, draft cleared.
 * `guard` is an extra condition (publish passes `changes() > 0`: only when the
 * version row was inserted by the statement before it).
 */
export function markPublishedStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  version: number,
  actor: string,
  now: string,
  guard?: { sql: string; values?: (string | number)[] },
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_buildings SET status = 'published', published_version = ?, draft_json = NULL,
       draft_saved_by = NULL, draft_saved_at = NULL, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ? AND status <> 'archived' AND draft_json IS NOT NULL${guard ? ` AND (${guard.sql})` : ''}`,
    version,
    actor,
    now,
    id,
    expectedRevision,
    ...(guard?.values ?? []),
  );
}

/** Archive (from draft or published). The draft and published_version are kept for restore. */
export function archiveStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  reason: string | null,
  actor: string,
  now: string,
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_buildings SET status = 'archived', archived_by = ?, archived_at = ?, archive_reason = ?,
       updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ? AND status <> 'archived'`,
    actor,
    now,
    reason,
    actor,
    now,
    id,
    expectedRevision,
  );
}

/**
 * Restore: back to 'published' (it has a version) or 'draft' (never published).
 * `guard` is an extra condition (restore passes `changes() > 0`: only when the
 * guarded audit row before it was written).
 */
export function restoreStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  to: 'published' | 'draft',
  actor: string,
  now: string,
  guard?: { sql: string; values?: (string | number)[] },
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_buildings SET status = ?, archived_by = NULL, archived_at = NULL, archive_reason = NULL,
       updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ? AND status = 'archived'${guard ? ` AND (${guard.sql})` : ''}`,
    to,
    actor,
    now,
    id,
    expectedRevision,
    ...(guard?.values ?? []),
  );
}

/** Permanent delete (archived only; the 0002 trigger enforces it too). */
export function deleteStudioBuildingStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
): SqlStatement {
  return stmt(
    db,
    "DELETE FROM studio_buildings WHERE id = ? AND revision = ? AND status = 'archived'",
    id,
    expectedRevision,
  );
}

export async function getStudioBuildingRow(db: SqlDatabase, id: string): Promise<StudioBuildingRow | null> {
  const row = await stmt(db, 'SELECT * FROM studio_buildings WHERE id = ?', id).first();
  return row ? rowToStudioBuilding(row) : null;
}

export async function getStudioBuildingByTarget(
  db: SqlDatabase,
  targetId: string,
): Promise<StudioBuildingRow | null> {
  const row = await stmt(db, 'SELECT * FROM studio_buildings WHERE target_id = ?', targetId).first();
  return row ? rowToStudioBuilding(row) : null;
}

export interface StudioListFilter {
  status?: StudioStatus | undefined;
  targetId?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  /** Keyset cursor: rows strictly after (updatedAt DESC, id DESC). */
  after?: { updatedAt: string; id: string } | undefined;
}

/**
 * Heads, newest change first, with the latest published record alongside
 * (for titles and the name search when there is no draft). `q` matches the
 * draft or published name, the id or the target id (LIKE, escaped).
 */
export async function listStudioBuildingRows(
  db: SqlDatabase,
  f: StudioListFilter,
): Promise<{ rows: { head: StudioBuildingRow; published: unknown }[]; more: boolean }> {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (f.status) {
    where.push('b.status = ?');
    binds.push(f.status);
  }
  if (f.targetId) {
    where.push('b.target_id = ?');
    binds.push(f.targetId);
  }
  const q = f.q?.trim();
  if (q) {
    const pattern = likeContains(q.slice(0, 120));
    where.push(
      `(json_extract(b.draft_json, '$.identity.name') LIKE ? ESCAPE '\\'
        OR json_extract(v.record_json, '$.identity.name') LIKE ? ESCAPE '\\'
        OR b.id = ? OR b.target_id = ?)`,
    );
    binds.push(pattern, pattern, q, q);
  }
  if (f.after) {
    where.push('(b.updated_at < ? OR (b.updated_at = ? AND b.id < ?))');
    binds.push(f.after.updatedAt, f.after.updatedAt, f.after.id);
  }
  const limit = clampLimit(f.limit, 50, 200);
  const sql = `SELECT b.*, v.record_json AS published_record_json
    FROM studio_buildings b
    LEFT JOIN studio_building_versions v ON v.building_id = b.id AND v.version = b.published_version
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.updated_at DESC, b.id DESC LIMIT ?`;
  const { results } = await stmt(db, sql, ...binds, limit + 1).all();
  return {
    rows: results
      .slice(0, limit)
      .map((r) => ({ head: rowToStudioBuilding(r), published: parseJsonColumn(r.published_record_json) })),
    more: results.length > limit,
  };
}

// --- versions ------------------------------------------------------------------

export interface NewStudioVersion {
  buildingId: string;
  version: number;
  recordJson: string;
  footprintJson: string;
  footprintAreaM2: number;
  membershipJson: string;
  validationJson: string;
  acknowledgementsJson: string;
  changeSummary: string;
  modelConfigVersion: number;
  generatorId: string;
  generatorVersion: number;
  accuracyClass: string;
  positionCorrected: boolean;
  publishedBy: string;
  publishedAt: string;
}

/** INSERT of an immutable version, only if `guard` (the head precondition) holds. */
export function insertStudioVersionIfStmt(
  db: SqlDatabase,
  v: NewStudioVersion,
  guard: { sql: string; values: (string | number)[] },
): SqlStatement {
  return stmt(
    db,
    `INSERT INTO studio_building_versions (building_id, version, record_json, footprint_json, footprint_area_m2,
       membership_json, validation_json, acknowledgements_json, change_summary, model_config_version, generator_id,
       generator_version, accuracy_class, position_corrected, published_by, published_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
    v.buildingId,
    v.version,
    v.recordJson,
    v.footprintJson,
    v.footprintAreaM2,
    v.membershipJson,
    v.validationJson,
    v.acknowledgementsJson,
    v.changeSummary,
    v.modelConfigVersion,
    v.generatorId,
    v.generatorVersion,
    v.accuracyClass,
    v.positionCorrected ? 1 : 0,
    v.publishedBy,
    v.publishedAt,
    ...guard.values,
  );
}

/** Deletes every version of an archived building whose head still has `revision` (permanent delete). */
export function deleteStudioVersionsStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
): SqlStatement {
  return stmt(
    db,
    `DELETE FROM studio_building_versions WHERE building_id = ?
       AND EXISTS (SELECT 1 FROM studio_buildings WHERE id = ? AND revision = ? AND status = 'archived')`,
    id,
    id,
    expectedRevision,
  );
}

export async function getStudioVersionRow(
  db: SqlDatabase,
  id: string,
  version: number,
): Promise<StudioVersionRow | null> {
  const row = await stmt(
    db,
    'SELECT * FROM studio_building_versions WHERE building_id = ? AND version = ?',
    id,
    version,
  ).first();
  return row ? rowToStudioVersion(row) : null;
}

export async function listStudioVersionRows(db: SqlDatabase, id: string): Promise<StudioVersionRow[]> {
  const { results } = await stmt(
    db,
    'SELECT * FROM studio_building_versions WHERE building_id = ? ORDER BY version',
    id,
  ).all();
  return results.map(rowToStudioVersion);
}

/**
 * The columns the publication needs from a published version. Validation
 * results, acknowledgements, change summaries and actors are never read for
 * the public layer (they are large and private).
 */
export type PublishedStudioVersionRow = Pick<
  StudioVersionRow,
  | 'buildingId'
  | 'version'
  | 'record'
  | 'footprint'
  | 'footprintAreaM2'
  | 'membership'
  | 'accuracyClass'
  | 'positionCorrected'
  | 'publishedAt'
>;

/** Latest version of every PUBLISHED (non-archived) head, in id order: the publication input. */
export function publishedStudioVersionsStmt(db: SqlDatabase): SqlStatement {
  return stmt(
    db,
    `SELECT v.building_id, v.version, v.record_json, v.footprint_json, v.footprint_area_m2, v.membership_json,
            v.accuracy_class, v.position_corrected, v.published_at, b.target_id AS head_target_id
     FROM studio_buildings b
     JOIN studio_building_versions v ON v.building_id = b.id AND v.version = b.published_version
     WHERE b.status = 'published' ORDER BY b.id LIMIT 5000`,
  );
}

export function rowToPublishedStudioVersion(r: Row): {
  targetId: string | null;
  version: PublishedStudioVersionRow;
} {
  return {
    targetId: optStr(r, 'head_target_id'),
    version: {
      buildingId: str(r, 'building_id'),
      version: num(r, 'version'),
      record: parseJsonColumn(r.record_json),
      footprint: parseJsonColumn(r.footprint_json),
      footprintAreaM2: num(r, 'footprint_area_m2'),
      membership: parseJsonColumn(r.membership_json),
      accuracyClass: str(r, 'accuracy_class'),
      positionCorrected: num(r, 'position_corrected') === 1,
      publishedAt: str(r, 'published_at'),
    },
  };
}

export async function listPublishedStudioVersions(
  db: SqlDatabase,
): Promise<{ targetId: string | null; version: PublishedStudioVersionRow }[]> {
  const { results } = await publishedStudioVersionsStmt(db).all();
  return results.map(rowToPublishedStudioVersion);
}

/** Every head (quality view; bounded). */
export async function listAllStudioBuildingRows(db: SqlDatabase): Promise<StudioBuildingRow[]> {
  const { results } = await stmt(db, 'SELECT * FROM studio_buildings ORDER BY id LIMIT 5000').all();
  return results.map(rowToStudioBuilding);
}

/** Generator versions referenced by drafts and by published versions (never remove one in use). */
export async function generatorVersionsInUse(
  db: SqlDatabase,
): Promise<{ generatorId: string; generatorVersion: number; count: number }[]> {
  const { results } = await stmt(
    db,
    `SELECT generator_id, generator_version, COUNT(*) AS n FROM (
       SELECT json_extract(draft_json, '$.model.generatorId') AS generator_id,
              json_extract(draft_json, '$.model.generatorVersion') AS generator_version
         FROM studio_buildings WHERE draft_json IS NOT NULL
       UNION ALL
       SELECT generator_id, generator_version FROM studio_building_versions
     ) WHERE generator_id IS NOT NULL AND generator_version IS NOT NULL
     GROUP BY generator_id, generator_version ORDER BY generator_id, generator_version`,
  ).all();
  return results.map((r) => ({
    generatorId: str(r, 'generator_id'),
    generatorVersion: num(r, 'generator_version'),
    count: num(r, 'n'),
  }));
}
