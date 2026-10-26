/**
 * artwork_associations repository (migration 0003; contract in
 * docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4). One owner decision per
 * artwork subject; the curated registry is the baseline and a row here
 * replaces it whole (src/isometric-art/associations.ts merge rule).
 *
 * Writes follow the house pattern: optimistic concurrency on `revision`, and
 * the audit row plus the publication bump in the SAME batch, guarded by
 * `changes() > 0` so a stale write leaves no trace.
 */
import {
  associationEvidenceSchema,
  type AssociationEvidence,
  type AssociationStatus,
  type PublishedArtworkAssociation,
} from '../../src/isometric-art/schema.ts';
import { stmt } from './sql.ts';
import type { SqlDatabase, SqlStatement } from './types.ts';

export interface ArtworkAssociationRecord {
  subjectId: string;
  status: AssociationStatus;
  buildingId: string | null;
  evidence: AssociationEvidence[];
  /** Private owner note: admin only, never published. */
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

/** Mirrors the 0003 CHECK `length(evidence_json) <= 8192` (characters of the stored JSON array). */
export const ARTWORK_EVIDENCE_JSON_MAX = 8192;

type Row = Record<string, unknown>;
const optStr = (r: Row, k: string): string | null =>
  r[k] === null || r[k] === undefined ? null : String(r[k]);

/** Stored evidence is re-validated on read; a corrupt array yields [] rather than unvalidated data. */
export function parseEvidence(json: unknown): AssociationEvidence[] {
  try {
    const r = associationEvidenceSchema.array().safeParse(JSON.parse(String(json)));
    return r.success ? r.data : [];
  } catch {
    return [];
  }
}

export function rowToArtworkAssociation(r: Row): ArtworkAssociationRecord {
  return {
    subjectId: String(r.subject_id),
    status: String(r.status) as AssociationStatus,
    buildingId: optStr(r, 'building_id'),
    evidence: parseEvidence(r.evidence_json),
    note: optStr(r, 'note'),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedBy: String(r.updated_by),
    updatedAt: String(r.updated_at),
    revision: Number(r.revision),
  };
}

/** Public projection (publication v3): no note, no actors, no createdAt. */
export function toPublishedArtworkAssociation(a: ArtworkAssociationRecord): PublishedArtworkAssociation {
  return {
    subjectId: a.subjectId,
    status: a.status,
    buildingId: a.buildingId,
    evidence: a.evidence,
    revision: a.revision,
    updatedAt: a.updatedAt,
  };
}

const COLUMNS =
  'subject_id, status, building_id, evidence_json, note, created_by, created_at, updated_by, updated_at, revision';

/**
 * Public columns only, in subject order (bounded): the publication never
 * selects the private note or actors.
 */
export function publishedArtworkAssociationsStmt(db: SqlDatabase): SqlStatement {
  return stmt(
    db,
    'SELECT subject_id, status, building_id, evidence_json, revision, updated_at FROM artwork_associations ORDER BY subject_id LIMIT 2000',
  );
}

export function rowToPublishedArtworkAssociation(r: Row): PublishedArtworkAssociation {
  return {
    subjectId: String(r.subject_id),
    status: String(r.status) as AssociationStatus,
    buildingId: optStr(r, 'building_id'),
    evidence: parseEvidence(r.evidence_json),
    revision: Number(r.revision),
    updatedAt: String(r.updated_at),
  };
}

/** Every decision with all columns (admin list; includes the private note). */
export function listArtworkAssociationsStmt(db: SqlDatabase): SqlStatement {
  return stmt(db, `SELECT ${COLUMNS} FROM artwork_associations ORDER BY subject_id LIMIT 2000`);
}

export async function listArtworkAssociationRows(db: SqlDatabase): Promise<ArtworkAssociationRecord[]> {
  const { results } = await listArtworkAssociationsStmt(db).all();
  return results.map(rowToArtworkAssociation);
}

export async function getArtworkAssociationRow(
  db: SqlDatabase,
  subjectId: string,
): Promise<ArtworkAssociationRecord | null> {
  const row = await stmt(
    db,
    `SELECT ${COLUMNS} FROM artwork_associations WHERE subject_id = ?`,
    subjectId,
  ).first();
  return row ? rowToArtworkAssociation(row) : null;
}

export interface ArtworkAssociationWriteValues {
  status: AssociationStatus;
  buildingId: string | null;
  evidence: AssociationEvidence[];
  note: string | null;
}

/** INSERT of a first decision; changes() = 0 when one already exists (a concurrent create). */
export function insertArtworkAssociationStmt(
  db: SqlDatabase,
  subjectId: string,
  v: ArtworkAssociationWriteValues,
  actor: string,
  nowIso: string,
): SqlStatement {
  return stmt(
    db,
    `INSERT INTO artwork_associations (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (subject_id) DO NOTHING`,
    subjectId,
    v.status,
    v.buildingId,
    JSON.stringify(v.evidence),
    v.note,
    actor,
    nowIso,
    actor,
    nowIso,
  );
}

/** UPDATE guarded by the expected revision; changes() = 0 when stale or absent. */
export function updateArtworkAssociationStmt(
  db: SqlDatabase,
  subjectId: string,
  expectedRevision: number,
  v: ArtworkAssociationWriteValues,
  actor: string,
  nowIso: string,
): SqlStatement {
  return stmt(
    db,
    `UPDATE artwork_associations
     SET status = ?, building_id = ?, evidence_json = ?, note = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE subject_id = ? AND revision = ?`,
    v.status,
    v.buildingId,
    JSON.stringify(v.evidence),
    v.note,
    actor,
    nowIso,
    subjectId,
    expectedRevision,
  );
}

/** DELETE (reset to the curated baseline) guarded by the expected revision. */
export function deleteArtworkAssociationStmt(
  db: SqlDatabase,
  subjectId: string,
  expectedRevision: number,
): SqlStatement {
  return stmt(
    db,
    'DELETE FROM artwork_associations WHERE subject_id = ? AND revision = ?',
    subjectId,
    expectedRevision,
  );
}
