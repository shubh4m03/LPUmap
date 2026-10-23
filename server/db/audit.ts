/**
 * Append-only audit log repository. Rows are only ever INSERTed (the schema's
 * triggers abort UPDATE/DELETE). Snapshots must never contain secrets,
 * tokens, cookies or IP addresses — callers pass domain records only.
 */
import type { SqlDatabase, SqlStatement } from './types.ts';
import { clampLimit, stmt } from './sql.ts';
import { rowToAudit, type AuditEntityType, type AuditEvent, type AuditOutcome } from './records.ts';

export interface AuditInput {
  at: string;
  actor: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  outcome: AuditOutcome;
  detail?: string | null;
}

const clip = (s: string | null | undefined, max: number) =>
  s === null || s === undefined ? null : s.slice(0, max);
const json = (x: unknown) => (x === undefined || x === null ? null : JSON.stringify(x));

const COLUMNS = 'at, actor, action, entity_type, entity_id, before_json, after_json, outcome, detail';

function values(e: AuditInput) {
  return [
    e.at,
    clip(e.actor, 320) ?? 'unknown',
    clip(e.action, 64) ?? 'unknown',
    e.entityType,
    clip(e.entityId, 200),
    json(e.before),
    json(e.after),
    e.outcome,
    clip(e.detail, 1000),
  ];
}

/**
 * Audit INSERT. With `guard`, the row is written only if the SQL condition
 * holds at that point of the batch (fixed, code-defined condition plus its
 * bound values — never user text).
 */
export function auditStmt(
  db: SqlDatabase,
  e: AuditInput,
  guard?: { sql: string; values?: (string | number | null)[] },
): SqlStatement {
  if (!guard)
    return stmt(db, `INSERT INTO audit_events (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values(e));
  return stmt(
    db,
    `INSERT INTO audit_events (${COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
    ...values(e),
    ...(guard.values ?? []),
  );
}

export async function insertAudit(db: SqlDatabase, e: AuditInput): Promise<void> {
  await auditStmt(db, e).run();
}

export async function getAuditEvent(db: SqlDatabase, id: number): Promise<AuditEvent | null> {
  const row = await stmt(db, 'SELECT * FROM audit_events WHERE id = ?', id).first();
  return row ? rowToAudit(row) : null;
}

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  action?: string;
  limit?: number;
  /** Return events with id < cursor (newest first). */
  cursor?: number;
}

export async function listAuditRows(
  db: SqlDatabase,
  filter: AuditFilter,
): Promise<{ items: AuditEvent[]; nextCursor: number | null }> {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (filter.entityType) {
    where.push('entity_type = ?');
    binds.push(filter.entityType);
  }
  if (filter.entityId) {
    where.push('entity_id = ?');
    binds.push(filter.entityId);
  }
  if (filter.action) {
    where.push('action = ?');
    binds.push(filter.action);
  }
  if (filter.cursor !== undefined) {
    where.push('id < ?');
    binds.push(filter.cursor);
  }
  const limit = clampLimit(filter.limit, 50, 200);
  const sql = `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
  const { results } = await stmt(db, sql, ...binds, limit + 1).all();
  const items = results.slice(0, limit).map(rowToAudit);
  return { items, nextCursor: results.length > limit ? (items[items.length - 1]?.id ?? null) : null };
}

/** Full history of one entity, oldest first. */
export async function entityHistory(db: SqlDatabase, entityType: AuditEntityType, entityId: string) {
  const { results } = await stmt(
    db,
    'SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY id ASC LIMIT 500',
    entityType,
    entityId,
  ).all();
  return results.map(rowToAudit);
}

export async function countAuditSince(db: SqlDatabase, sinceIso: string): Promise<number> {
  const row = await stmt(db, 'SELECT COUNT(*) AS n FROM audit_events WHERE at >= ?', sinceIso).first<{
    n: number;
  }>();
  return Number(row?.n ?? 0);
}
