/**
 * Minimal database interface the server codes against: the subset of
 * Cloudflare's `D1Database` we use, so a real D1 binding satisfies it
 * structurally and no `@cloudflare/workers-types` dependency is needed.
 *
 * D1 runs `batch()` as one transaction (all statements commit or none do),
 * which every multi-statement change relies on.
 */

/** Values D1 can bind. `undefined` is NOT accepted by D1 — use `null`. */
export type SqlValue = string | number | null;

export interface SqlResultMeta {
  /** Rows changed by an INSERT/UPDATE/DELETE. */
  changes?: number;
  last_row_id?: number;
  [key: string]: unknown;
}

export interface SqlResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: SqlResultMeta;
}

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
  exec(sql: string): Promise<unknown>;
}
