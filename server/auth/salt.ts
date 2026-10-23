/**
 * Daily-rotated rate-limit salt (used only when no RATE_LIMIT_KEY secret is
 * configured). Stored in D1 `meta` as `rate_salt` + `rate_salt_day`. Rotation
 * runs as one batch (one transaction): the salt is replaced only while the
 * stored day is older than today, so concurrent isolates converge on a
 * single salt per day. Yesterday's salt is overwritten, so bucket ids cannot
 * be linked across days.
 */
import type { SqlDatabase } from '../db/types.ts';
import { randomToken } from './encoding.ts';
import type { SaltRepo } from './ports.ts';

const SALT_KEY = 'rate_salt';
const DAY_KEY = 'rate_salt_day';

let memo: { day: string; salt: string } | null = null;

/** Test hook. */
export function resetSaltMemo(): void {
  memo = null;
}

export async function dailySalt(db: SqlDatabase, now: Date): Promise<string> {
  const today = now.toISOString().slice(0, 10);
  if (memo && memo.day === today) return memo.salt;

  const read = async () => {
    const { results } = await db
      .prepare('SELECT key, value FROM meta WHERE key IN (?, ?)')
      .bind(SALT_KEY, DAY_KEY)
      .all<{ key: string; value: string }>();
    const m = new Map(results.map((r) => [String(r.key), String(r.value)]));
    return { salt: m.get(SALT_KEY), day: m.get(DAY_KEY) };
  };

  let current = await read();
  if (!(current.salt && current.day === today)) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO meta (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value
           WHERE COALESCE((SELECT value FROM meta WHERE key = ?), '') < ?`,
        )
        .bind(SALT_KEY, randomToken(32), DAY_KEY, today),
      db
        .prepare(
          `INSERT INTO meta (key, value) VALUES (?, ?)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE value < excluded.value`,
        )
        .bind(DAY_KEY, today),
    ]);
    current = await read();
  }
  if (!current.salt || current.day !== today) throw new Error('Rate-limit salt could not be established');
  memo = { day: today, salt: current.salt };
  return current.salt;
}

export const d1SaltRepo: SaltRepo = { dailySalt };
