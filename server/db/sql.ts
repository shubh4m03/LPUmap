/**
 * SQL helpers. Every value reaches SQLite through `bind()` — user input is
 * never concatenated into SQL text. Only fixed, code-defined fragments (column
 * lists, whitelisted ORDER BY clauses, guard conditions) are composed.
 */
import type { SqlDatabase, SqlStatement, SqlValue } from './types.ts';

/** D1 rejects `undefined`; optional values are stored as NULL. */
export const v = (value: string | number | boolean | null | undefined): SqlValue =>
  value === undefined || value === null ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value;

export const stmt = (
  db: SqlDatabase,
  sql: string,
  ...values: (string | number | boolean | null | undefined)[]
) => db.prepare(sql).bind(...values.map(v));

/** Escapes LIKE wildcards; use with `LIKE ? ESCAPE '\'`. */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Guards for follow-up statements inside one batch:
 * - `afterChange`: only if the immediately preceding INSERT/UPDATE/DELETE
 *   changed at least one row (SQLite `changes()`), so a stale optimistic write
 *   leaves no audit row and no publication bump behind.
 */
export const GUARD_AFTER_CHANGE = 'changes() > 0';

export const changes = (r: { meta: { changes?: number } } | undefined): number => r?.meta.changes ?? 0;

/** Runs a batch; an empty list is a no-op (D1 rejects empty batches). */
export async function runBatch(db: SqlDatabase, statements: SqlStatement[]) {
  if (statements.length === 0) return [];
  return db.batch(statements);
}

export const clampLimit = (limit: unknown, fallback = 50, max = 200): number => {
  const n = typeof limit === 'number' ? limit : typeof limit === 'string' ? Number(limit) : NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
};

/** Opaque keyset cursor: base64url(JSON [sortKey, id]). Invalid input → null. */
export function encodeCursor(sortKey: string | number, id: string | number): string {
  const json = JSON.stringify([sortKey, id]);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: unknown): [string | number, string | number] | null {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 400) return null;
  try {
    const b64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const parsed: unknown = JSON.parse(json);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      (typeof parsed[0] === 'string' || typeof parsed[0] === 'number') &&
      (typeof parsed[1] === 'string' || typeof parsed[1] === 'number')
    )
      return [parsed[0], parsed[1]];
  } catch {
    // fall through
  }
  return null;
}
