/** `meta` key/value repository: publication version and server-managed settings. */
import type { SqlDatabase, SqlStatement } from './types.ts';
import { stmt } from './sql.ts';

export const PUBLICATION_VERSION_KEY = 'publication_version';
export const PUBLICATION_UPDATED_AT_KEY = 'publication_updated_at';

/**
 * Bumps publication_version and stamps publication_updated_at in one
 * statement. With `guard` (a code-defined SQL condition) the bump happens only
 * if it holds, so a write that changed nothing never changes the ETag.
 */
export function bumpPublicationStmt(
  db: SqlDatabase,
  nowIso: string,
  guard?: { sql: string; values?: (string | number | null)[] },
): SqlStatement {
  return stmt(
    db,
    `UPDATE meta SET value = CASE key WHEN ? THEN CAST(CAST(value AS INTEGER) + 1 AS TEXT) ELSE ? END
     WHERE key IN (?, ?)${guard ? ` AND (${guard.sql})` : ''}`,
    PUBLICATION_VERSION_KEY,
    nowIso,
    PUBLICATION_VERSION_KEY,
    PUBLICATION_UPDATED_AT_KEY,
    ...(guard?.values ?? []),
  );
}

export async function getMeta(db: SqlDatabase, key: string): Promise<string | null> {
  const row = await stmt(db, 'SELECT value FROM meta WHERE key = ?', key).first<{ value: string }>();
  return row ? String(row.value) : null;
}

export async function setMeta(db: SqlDatabase, key: string, value: string): Promise<void> {
  await stmt(
    db,
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    value,
  ).run();
}

export type PublicationState = { version: number; updatedAt: string };

/** SELECT of the publication version and timestamp (for a consistent db.batch read). */
export function publicationStateStmt(db: SqlDatabase): SqlStatement {
  return stmt(
    db,
    'SELECT key, value FROM meta WHERE key IN (?, ?)',
    PUBLICATION_VERSION_KEY,
    PUBLICATION_UPDATED_AT_KEY,
  );
}

export function toPublicationState(rows: readonly Record<string, unknown>[]): PublicationState {
  const m = new Map(rows.map((r) => [String(r.key), String(r.value)]));
  const version = Number(m.get(PUBLICATION_VERSION_KEY) ?? 0);
  return {
    version: Number.isInteger(version) && version >= 0 ? version : 0,
    updatedAt: m.get(PUBLICATION_UPDATED_AT_KEY) ?? '1970-01-01T00:00:00.000Z',
  };
}

export async function getPublicationState(db: SqlDatabase): Promise<PublicationState> {
  const { results } = await publicationStateStmt(db).all();
  return toPublicationState(results);
}
