/**
 * Minimal local-D1 harness: a throwaway in-memory D1 via wrangler's
 * getPlatformProxy, with migrations/*.sql applied in order.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { SqlDatabase } from '../../../server/db/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

/** Splits a migration into statements, keeping CREATE TRIGGER … END; bodies intact. */
export function splitSql(sql: string): string[] {
  const lines = sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ''))
    .filter((l) => l.trim() !== '');
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    buf.push(line);
    const text = buf.join('\n').trim();
    const isTrigger = /^CREATE\s+TRIGGER/i.test(text);
    if ((isTrigger && /END\s*;$/i.test(text)) || (!isTrigger && text.endsWith(';'))) {
      out.push(text);
      buf = [];
    }
  }
  if (buf.join('').trim() !== '') out.push(buf.join('\n').trim());
  return out;
}

export async function applyMigrations(db: SqlDatabase): Promise<void> {
  const dir = join(root, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    for (const s of splitSql(readFileSync(join(dir, f), 'utf8'))) await db.prepare(s).run();
  }
}

export interface TestDb {
  db: SqlDatabase;
  dispose(): Promise<void>;
  count(table: string): Promise<number>;
}

export async function createTestDb(): Promise<TestDb> {
  const proxy = await getPlatformProxy<{ DB: SqlDatabase }>({
    configPath: join(here, 'wrangler.test.toml'),
    persist: false,
  });
  const db = proxy.env.DB;
  await applyMigrations(db);
  return {
    db,
    dispose: () => proxy.dispose(),
    async count(table: string) {
      if (!/^[a-z_]+$/.test(table)) throw new Error('bad table');
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
      return Number(row?.n ?? 0);
    },
  };
}

/** Deletes all rows from mutable tables (audit_events is append-only and left alone). */
export async function resetTables(db: SqlDatabase): Promise<void> {
  for (const t of ['sessions', 'rate_limits', 'locations', 'overrides', 'suggestions']) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await db.prepare("DELETE FROM meta WHERE key IN ('rate_salt', 'rate_salt_day')").run();
}
