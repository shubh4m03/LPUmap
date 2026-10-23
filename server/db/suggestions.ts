/** Suggestions repository. Parameterized statements only; ORDER BY from a whitelist. */
import type { SuggestionStatus } from '../../src/community/schema.ts';
import type { SqlDatabase, SqlStatement } from './types.ts';
import { clampLimit, decodeCursor, encodeCursor, likeContains, stmt } from './sql.ts';
import { rowToSuggestion, type SuggestionRecord } from './records.ts';

const COLUMN_BY_FIELD = {
  status: 'status',
  name: 'name',
  categoryId: 'category_id',
  description: 'description',
  landmark: 'landmark',
  evidenceUrl: 'evidence_url',
  details: 'details',
  duplicateOf: 'duplicate_of',
  reviewNote: 'review_note',
  reviewedBy: 'reviewed_by',
  reviewedAt: 'reviewed_at',
  publishedLocationId: 'published_location_id',
  updatedAt: 'updated_at',
} as const;

export type SuggestionSet = Partial<{
  [K in keyof typeof COLUMN_BY_FIELD]: string | null;
}> & { location?: readonly [number, number] };

export async function getSuggestionRow(db: SqlDatabase, id: string): Promise<SuggestionRecord | null> {
  const row = await stmt(db, 'SELECT * FROM suggestions WHERE id = ?', id).first();
  return row ? rowToSuggestion(row) : null;
}

export function insertSuggestionStmt(db: SqlDatabase, s: SuggestionRecord): SqlStatement {
  return stmt(
    db,
    `INSERT INTO suggestions (id, name, category_id, lon, lat, description, landmark, evidence_url, details,
       status, created_at, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1)`,
    s.id,
    s.name,
    s.categoryId,
    s.location[0],
    s.location[1],
    s.description,
    s.landmark,
    s.evidenceUrl,
    s.details,
    s.createdAt,
    s.updatedAt,
  );
}

/**
 * Conditional update: applies only when the row still has `revision` and one
 * of `fromStatuses`; bumps revision. Column names come from COLUMN_BY_FIELD
 * (code), values are bound.
 */
export function updateSuggestionStmt(
  db: SqlDatabase,
  id: string,
  revision: number,
  fromStatuses: readonly SuggestionStatus[],
  set: SuggestionSet,
): SqlStatement {
  const cols: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [field, value] of Object.entries(set)) {
    if (field === 'location') {
      const loc = value as readonly [number, number];
      cols.push('lon = ?', 'lat = ?');
      vals.push(loc[0], loc[1]);
      continue;
    }
    const col = COLUMN_BY_FIELD[field as keyof typeof COLUMN_BY_FIELD];
    if (!col) throw new Error(`Unknown suggestion field ${field}`);
    cols.push(`${col} = ?`);
    vals.push((value as string | null | undefined) ?? null);
  }
  const statusPlaceholders = fromStatuses.map(() => '?').join(', ');
  return stmt(
    db,
    `UPDATE suggestions SET ${[...cols, 'revision = revision + 1'].join(', ')}
     WHERE id = ? AND revision = ? AND status IN (${statusPlaceholders})`,
    ...vals,
    id,
    revision,
    ...fromStatuses,
  );
}

export const SUGGESTION_SORTS = {
  created_desc: { order: 'created_at DESC, id DESC', cmp: '<' },
  created_asc: { order: 'created_at ASC, id ASC', cmp: '>' },
} as const;
export type SuggestionSort = keyof typeof SUGGESTION_SORTS;

export interface SuggestionFilter {
  status?: string;
  category?: string;
  q?: string;
  sort?: string;
  limit?: number;
  cursor?: string;
}

export async function listSuggestionRows(
  db: SqlDatabase,
  filter: SuggestionFilter,
): Promise<{ items: SuggestionRecord[]; nextCursor: string | null }> {
  const sortKey: SuggestionSort = filter.sort === 'created_asc' ? 'created_asc' : 'created_desc';
  const sort = SUGGESTION_SORTS[sortKey];
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (filter.status) {
    where.push('status = ?');
    binds.push(filter.status);
  }
  if (filter.category) {
    where.push('category_id = ?');
    binds.push(filter.category);
  }
  const q = filter.q?.trim();
  if (q) {
    const pattern = likeContains(q.slice(0, 120));
    where.push(
      "(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR landmark LIKE ? ESCAPE '\\' OR id = ?)",
    );
    binds.push(pattern, pattern, pattern, q);
  }
  const cursor = decodeCursor(filter.cursor);
  if (cursor) {
    where.push(`(created_at, id) ${sort.cmp} (?, ?)`);
    binds.push(String(cursor[0]), String(cursor[1]));
  }
  const limit = clampLimit(filter.limit, 50, 100);
  const sql = `SELECT * FROM suggestions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${sort.order} LIMIT ?`;
  const { results } = await stmt(db, sql, ...binds, limit + 1).all();
  const items = results.slice(0, limit).map(rowToSuggestion);
  const last = items[items.length - 1];
  return { items, nextCursor: results.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** Open (pending / needs_information) suggestions, for duplicate detection. */
export async function openSuggestions(db: SqlDatabase, limit = 5000): Promise<SuggestionRecord[]> {
  const { results } = await stmt(
    db,
    "SELECT * FROM suggestions WHERE status IN ('pending', 'needs_information') ORDER BY created_at, id LIMIT ?",
    limit,
  ).all();
  return results.map(rowToSuggestion);
}

export async function stalePendingSuggestions(
  db: SqlDatabase,
  beforeIso: string,
): Promise<SuggestionRecord[]> {
  const { results } = await stmt(
    db,
    "SELECT * FROM suggestions WHERE status = 'pending' AND created_at < ? ORDER BY created_at, id LIMIT 500",
    beforeIso,
  ).all();
  return results.map(rowToSuggestion);
}

export async function countSuggestionsByStatus(db: SqlDatabase): Promise<Record<SuggestionStatus, number>> {
  const counts: Record<SuggestionStatus, number> = {
    pending: 0,
    needs_information: 0,
    approved: 0,
    rejected: 0,
    duplicate: 0,
  };
  const { results } = await stmt(db, 'SELECT status, COUNT(*) AS n FROM suggestions GROUP BY status').all<{
    status: SuggestionStatus;
    n: number;
  }>();
  for (const r of results) if (r.status in counts) counts[r.status] = Number(r.n);
  return counts;
}
