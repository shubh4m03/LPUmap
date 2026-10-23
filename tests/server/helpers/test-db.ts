/**
 * Shared local-D1 harness for server tests: a throwaway (non-persistent) D1
 * database from wrangler's getPlatformProxy with migrations/NNNN_*.sql applied
 * in order — the same files `wrangler d1 migrations apply` uses.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { SqlDatabase } from '../../../server/db/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');

/** Migration files in apply order. */
export function migrationFiles(): string[] {
  const dir = join(REPO_ROOT, 'migrations');
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

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
  for (const file of migrationFiles()) {
    for (const s of splitSql(readFileSync(file, 'utf8'))) await db.prepare(s).run();
  }
}

export interface TestDb {
  db: SqlDatabase;
  dispose(): Promise<void>;
  /** Row count of a table (name checked against a fixed pattern). */
  count(table: string): Promise<number>;
  /** All rows of a table, ordered by its first column. */
  rows<T = Record<string, unknown>>(table: string): Promise<T[]>;
  /** Deletes all rows from mutable tables and resets meta (audit_events is append-only and kept). */
  reset(): Promise<void>;
}

const checkTable = (t: string) => {
  if (!/^[a-z_]+$/.test(t)) throw new Error(`bad table name ${t}`);
  return t;
};

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
    async count(table) {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${checkTable(table)}`).first<{ n: number }>();
      return Number(row?.n ?? 0);
    },
    async rows<T>(table: string) {
      const r = await db.prepare(`SELECT * FROM ${checkTable(table)} ORDER BY 1`).all<T>();
      return r.results;
    },
    async reset() {
      for (const t of ['sessions', 'rate_limits', 'locations', 'overrides', 'suggestions'])
        await db.prepare(`DELETE FROM ${t}`).run();
      await db
        .prepare("DELETE FROM meta WHERE key NOT IN ('publication_version', 'publication_updated_at')")
        .run();
      await db.prepare("UPDATE meta SET value = '0' WHERE key = 'publication_version'").run();
    },
  };
}
