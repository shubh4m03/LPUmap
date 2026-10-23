/**
 * Adversarial data-integrity helpers:
 * - racingDb: deterministically interleaves a competing writer between an
 *   operation's reads and its write batch (the classic lost-update window);
 * - failingDb: splices a statement that violates NOT NULL into a chosen
 *   position of a batch, forcing D1 to roll the whole transaction back;
 * - snapshot: every row of every mutable table + meta + audit, so a test can
 *   prove "no partial state" by exact equality.
 */
import { expect } from 'vitest';
import type { SqlDatabase, SqlStatement } from '../../../server/db/types.ts';
import { DomainError } from '../../../server/errors.ts';

/** Runs `competitor` (against the real database) right before the Nth batch (default: first). */
export function racingDb(
  db: SqlDatabase,
  competitor: () => Promise<unknown>,
  onBatch = 1,
): SqlDatabase & { competitorRan: boolean } {
  let n = 0;
  const wrapper = {
    competitorRan: false,
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    batch: async <T>(stmts: SqlStatement[]) => {
      n += 1;
      if (n === onBatch) {
        await competitor();
        wrapper.competitorRan = true;
      }
      return db.batch<T>(stmts);
    },
  };
  return wrapper;
}

/**
 * The first batch gets a failing statement inserted at index `at` (clamped to
 * the batch length). `lengths` records the size of every batch seen.
 */
export function failingDb(
  db: SqlDatabase,
  at: number,
): SqlDatabase & { armed: boolean; lengths: number[]; failedAt: number | null } {
  const wrapper = {
    armed: true,
    lengths: [] as number[],
    failedAt: null as number | null,
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    batch: <T>(stmts: SqlStatement[]) => {
      wrapper.lengths.push(stmts.length);
      if (!wrapper.armed) return db.batch<T>(stmts);
      wrapper.armed = false;
      const pos = Math.min(at, stmts.length);
      wrapper.failedAt = pos;
      const bad = db.prepare("INSERT INTO meta (key, value) VALUES ('integrity-boom', NULL)");
      return db.batch<T>([...stmts.slice(0, pos), bad, ...stmts.slice(pos)]);
    },
  };
  return wrapper;
}

export interface DbSnapshot {
  suggestions: unknown[];
  locations: unknown[];
  overrides: unknown[];
  meta: unknown[];
  audit: { id: number; action: string; outcome: string; entity_id: string | null }[];
}

export async function snapshot(db: SqlDatabase): Promise<DbSnapshot> {
  const all = async (sql: string) => (await db.prepare(sql).all()).results;
  return {
    suggestions: await all('SELECT * FROM suggestions ORDER BY id'),
    locations: await all('SELECT * FROM locations ORDER BY id'),
    overrides: await all('SELECT * FROM overrides ORDER BY target_id'),
    meta: await all('SELECT * FROM meta ORDER BY key'),
    audit: (await all(
      'SELECT id, action, outcome, entity_id FROM audit_events ORDER BY id',
    )) as DbSnapshot['audit'],
  };
}

/** Audit rows appended after `before` was taken. */
export const newAudit = (before: DbSnapshot, after: DbSnapshot) => after.audit.slice(before.audit.length);

export async function domainError(p: Promise<unknown>): Promise<DomainError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
}
