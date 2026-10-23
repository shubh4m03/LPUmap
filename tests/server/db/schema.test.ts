import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb, migrationFiles, type TestDb } from '../helpers/test-db.ts';
import { stmt } from '../../../server/db/sql.ts';
import { insertAudit } from '../../../server/db/audit.ts';
import { getPublicationState, bumpPublicationStmt } from '../../../server/db/meta.ts';

const NOW = '2026-10-01T10:00:00.000Z';

describe('migrations', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('use wrangler-compatible NNNN_name.sql file names', () => {
    const files = migrationFiles().map((f) => f.replace(/^.*[\\/]/, ''));
    expect(files[0]).toBe('0001_initial.sql');
    for (const f of files) expect(f).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('create every contract table and seed publication_version 0', async () => {
    const { results } = await t.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      )
      .all<{ name: string }>();
    const names = results.map((r) => r.name).sort();
    for (const table of [
      'audit_events',
      'locations',
      'meta',
      'overrides',
      'rate_limits',
      'sessions',
      'suggestions',
    ])
      expect(names).toContain(table);
    expect(await getPublicationState(t.db)).toEqual({ version: 0, updatedAt: '1970-01-01T00:00:00.000Z' });
  });

  it('create the queue and audit indexes', async () => {
    const { results } = await t.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
      .all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['suggestions_status_created', 'suggestions_category_created', 'audit_entity']),
    );
  });

  it('contain no secrets or literal credentials', () => {
    for (const f of migrationFiles())
      expect(readFileSync(f, 'utf8')).not.toMatch(/pbkdf2-sha256\$|-----BEGIN|[A-Za-z0-9+/=]{40,}/);
  });
});

describe('constraints', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });
  beforeEach(async () => {
    await t.reset();
  });

  const insertSuggestion = (over: Record<string, string | number | null> = {}) => {
    const row = {
      id: 'sug_aaaaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Pharmacy',
      category_id: 'health',
      lon: 75.7,
      lat: 31.25,
      status: 'pending',
      published_location_id: null,
      duplicate_of: null,
      ...over,
    };
    return stmt(
      t.db,
      `INSERT INTO suggestions (id, name, category_id, lon, lat, status, published_location_id, duplicate_of, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.category_id,
      row.lon,
      row.lat,
      row.status,
      row.published_location_id,
      row.duplicate_of,
      NOW,
      NOW,
    ).run();
  };

  const insertLocation = (over: Record<string, string | number | null> = {}) => {
    const row = {
      id: 'own:aaaaaaaaaaaaaaaaaaaaaaaaaa',
      origin: 'owner',
      suggestion_id: null,
      lon: 75.7,
      lat: 31.25,
      status: 'active',
      ...over,
    };
    return stmt(
      t.db,
      `INSERT INTO locations (id, origin, suggestion_id, name, category_id, lon, lat, status, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, 'ATM', 'finance', ?, ?, ?, 'owner', ?, 'owner', ?)`,
      row.id,
      row.origin,
      row.suggestion_id,
      row.lon,
      row.lat,
      row.status,
      NOW,
      NOW,
    ).run();
  };

  it('accepts a valid pending suggestion with server defaults', async () => {
    await insertSuggestion();
    const [row] = await t.rows<{ status: string; revision: number }>('suggestions');
    expect(row).toMatchObject({ status: 'pending', revision: 1 });
  });

  it.each([
    ['unknown status', { status: 'published' }],
    ['longitude out of range', { lon: 181 }],
    ['latitude out of range', { lat: -91 }],
    ['non-numeric latitude', { lat: 'north' }],
    ['one-character name', { name: 'X' }],
    ['id without sug_ prefix', { id: 'loc_aaaaaaaaaaaaaaaaaaaaa' }],
    ['approved without published location', { status: 'approved' }],
    ['published location while pending', { published_location_id: 'com:x' }],
    ['duplicate without duplicate_of', { status: 'duplicate' }],
    ['duplicate of itself', { status: 'duplicate', duplicate_of: 'sug_aaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  ])('rejects a suggestion with %s', async (_label, over) => {
    await expect(insertSuggestion(over)).rejects.toThrow(/constraint/i);
    expect(await t.count('suggestions')).toBe(0);
  });

  it('enforces UNIQUE(suggestions.published_location_id)', async () => {
    await insertSuggestion({ id: 'sug_a1aaaaaa', status: 'approved', published_location_id: 'com:same' });
    await expect(
      insertSuggestion({ id: 'sug_b2xxxxxx', status: 'approved', published_location_id: 'com:same' }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  it('enforces UNIQUE(locations.suggestion_id) and the community ⇔ suggestion link', async () => {
    await insertSuggestion();
    await insertLocation({
      id: 'com:one11111',
      origin: 'community',
      suggestion_id: 'sug_aaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    await expect(
      insertLocation({
        id: 'com:two22222',
        origin: 'community',
        suggestion_id: 'sug_aaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    ).rejects.toThrow(/UNIQUE/i);
    await expect(
      insertLocation({ id: 'com:three333', origin: 'community', suggestion_id: null }),
    ).rejects.toThrow(/constraint/i);
  });

  it.each([
    ['owner origin with com: id', { id: 'com:aaaaaaaaaaa' }],
    ['bad status', { status: 'deleted' }],
    ['bad origin', { origin: 'osm', id: 'osm:aaaaaaaaaaa' }],
    ['latitude out of range', { lat: 95 }],
  ])('rejects a location with %s', async (_label, over) => {
    await expect(insertLocation(over)).rejects.toThrow(/constraint/i);
  });

  it('rejects override fields that are not a JSON object', async () => {
    const put = (json: string) =>
      stmt(
        t.db,
        `INSERT INTO overrides (target_id, fields_json, base_dataset_version, updated_by, updated_at) VALUES ('osm:way/1', ?, 'v', 'owner', ?)`,
        json,
        NOW,
      ).run();
    await expect(put('[1,2]')).rejects.toThrow(/constraint/i);
    await expect(put('not json')).rejects.toThrow(/constraint|malformed/i);
    await put('{"name":"X Y"}');
    expect(await t.count('overrides')).toBe(1);
  });

  it('makes the audit log append-only (UPDATE and DELETE abort)', async () => {
    await insertAudit(t.db, {
      at: NOW,
      actor: 'owner',
      action: 'test',
      entityType: 'system',
      entityId: null,
      outcome: 'success',
    });
    await expect(t.db.prepare("UPDATE audit_events SET actor = 'mallory'").run()).rejects.toThrow(
      /append-only/,
    );
    await expect(t.db.prepare('DELETE FROM audit_events').run()).rejects.toThrow(/append-only/);
    const rows = await t.rows<{ actor: string }>('audit_events');
    expect(rows.at(-1)?.actor).toBe('owner');
  });

  it('rejects an audit outcome outside success/rejected/failed', async () => {
    await expect(
      insertAudit(t.db, {
        at: NOW,
        actor: 'owner',
        action: 'x',
        entityType: 'system',
        entityId: null,
        outcome: 'ok' as never,
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it('runs a batch atomically: a failing statement rolls back the earlier ones', async () => {
    await expect(
      t.db.batch([
        bumpPublicationStmt(t.db, NOW),
        stmt(t.db, "INSERT INTO suggestions (id) VALUES ('sug_broken')"),
      ]),
    ).rejects.toThrow();
    expect((await getPublicationState(t.db)).version).toBe(0);
  });
});
