import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './harness.ts';
import type { TestDb } from './harness.ts';

describe('local D1 harness', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.dispose();
  });

  it('applies migrations including the append-only audit triggers', async () => {
    expect(await t.count('suggestions')).toBe(0);
    await t.db
      .prepare(
        "INSERT INTO audit_events (at, actor, action, entity_type, outcome) VALUES ('2026-01-01T00:00:00.000Z', 'owner', 'x', 'system', 'success')",
      )
      .run();
    await expect(t.db.prepare('DELETE FROM audit_events').run()).rejects.toThrow(/append-only/);
  });
});
