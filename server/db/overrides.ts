/** Overrides repository: owner corrections of base places, keyed by stable base id. */
import type { SqlDatabase, SqlStatement } from './types.ts';
import { stmt } from './sql.ts';
import { rowToOverride, type OverrideRecord } from './records.ts';

function values(o: OverrideRecord) {
  return [
    JSON.stringify(o.fields),
    o.hidden ? 1 : 0,
    o.accessNodeId,
    o.accessNote,
    o.note,
    o.baseDatasetVersion,
    o.updatedBy,
    o.updatedAt,
  ];
}

/** INSERT only if no row exists yet (a concurrent create → 0 changes → conflict). */
export function insertOverrideStmt(db: SqlDatabase, o: OverrideRecord): SqlStatement {
  return stmt(
    db,
    `INSERT INTO overrides (fields_json, hidden, access_node_id, access_note, note, base_dataset_version,
       updated_by, updated_at, target_id, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (target_id) DO NOTHING`,
    ...values(o),
    o.targetId,
    o.revision,
  );
}

export function updateOverrideStmt(
  db: SqlDatabase,
  o: OverrideRecord,
  expectedRevision: number,
): SqlStatement {
  return stmt(
    db,
    `UPDATE overrides SET fields_json = ?, hidden = ?, access_node_id = ?, access_note = ?, note = ?,
       base_dataset_version = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE target_id = ? AND revision = ?`,
    ...values(o),
    o.targetId,
    expectedRevision,
  );
}

export function deleteOverrideStmt(
  db: SqlDatabase,
  targetId: string,
  expectedRevision: number,
): SqlStatement {
  return stmt(db, 'DELETE FROM overrides WHERE target_id = ? AND revision = ?', targetId, expectedRevision);
}

export async function getOverrideRow(db: SqlDatabase, targetId: string): Promise<OverrideRecord | null> {
  const row = await stmt(db, 'SELECT * FROM overrides WHERE target_id = ?', targetId).first();
  return row ? rowToOverride(row) : null;
}

/** Every override in target order (also used inside the publication's consistent db.batch read). */
export function listOverridesStmt(db: SqlDatabase): SqlStatement {
  return stmt(db, 'SELECT * FROM overrides ORDER BY target_id LIMIT 10000');
}

export async function listOverrideRows(db: SqlDatabase): Promise<OverrideRecord[]> {
  const { results } = await listOverridesStmt(db).all();
  return results.map(rowToOverride);
}
