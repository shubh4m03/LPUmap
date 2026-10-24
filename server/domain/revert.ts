/**
 * Audit history and revert. Reverting restores the `before` snapshot of a
 * successful location/override change as a NEW revision (history is never
 * rewritten — the audit log is append-only). It is refused with 409 `conflict`
 * when the record changed since that event (its current revision/updatedAt no
 * longer match the event's `after` snapshot). Restored access nodes are
 * re-validated against the current base dataset; nothing is ever snapped.
 */
import { auditStmt, getAuditEvent, listAuditRows, type AuditFilter } from '../db/audit.ts';
import { getLocationRow, insertLocationIfAbsentStmt } from '../db/locations.ts';
import { getOverrideRow } from '../db/overrides.ts';
import {
  parseOverrideFields,
  type AuditEntityType,
  type AuditEvent,
  type LocationRecord,
  type OverrideRecord,
} from '../db/records.ts';
import { GUARD_AFTER_CHANGE, changes } from '../db/sql.ts';
import type { SqlDatabase } from '../db/types.ts';
import { conflict, fail, notFound } from '../errors.ts';
import { audited } from './audited.ts';
import { isoNow, type DomainContext } from './context.ts';
import { writeLocation } from './locations.ts';
import { isEmptyOverride, writeOverride } from './overrides.ts';
import { revalidateKeptAccess } from './validate.ts';

/** Every entity type the audit filter accepts (an unknown one is ignored); includes the studio types. */
const ENTITY_TYPES: readonly AuditEntityType[] = [
  'suggestion',
  'location',
  'override',
  'session',
  'system',
  'building',
  'template',
];

export function listAudit(db: SqlDatabase, filter: Record<string, unknown> = {}) {
  const f: AuditFilter = {};
  const entity = filter.entity ?? filter.entityType;
  if (typeof entity === 'string' && (ENTITY_TYPES as readonly string[]).includes(entity))
    f.entityType = entity;
  if (typeof filter.entityId === 'string' && filter.entityId) f.entityId = filter.entityId.slice(0, 200);
  if (typeof filter.action === 'string' && filter.action) f.action = filter.action.slice(0, 64);
  const limit = Number(filter.limit);
  if (Number.isInteger(limit)) f.limit = limit;
  const cursor = Number(filter.cursor);
  if (filter.cursor !== undefined && Number.isInteger(cursor) && cursor > 0) f.cursor = cursor;
  return listAuditRows(db, f);
}

/** Actions whose `before` snapshot can be restored. */
export const REVERTABLE_ACTIONS: ReadonlySet<string> = new Set([
  'location.update',
  'location.hide',
  'location.restore',
  'location.delete',
  'location.revert',
  'override.put',
  'override.hide',
  'override.unhide',
  'override.delete',
  'override.revert',
]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Same record version as the event's `after` snapshot (revision AND timestamp: survives delete+recreate). */
const unchangedSince = (cur: { revision: number; updatedAt: string } | null, after: unknown): boolean =>
  cur === null
    ? after === null
    : isObj(after) && after.revision === cur.revision && after.updatedAt === cur.updatedAt;

function asLocation(snapshot: unknown, id: string): LocationRecord {
  if (!isObj(snapshot) || snapshot.id !== id || !Array.isArray(snapshot.location)) {
    return fail('invalid', 'This audit event has no restorable location snapshot.', { status: 422 });
  }
  return snapshot as unknown as LocationRecord;
}

function asOverride(snapshot: unknown, id: string): OverrideRecord | null {
  if (snapshot === null) return null;
  if (!isObj(snapshot) || snapshot.targetId !== id) {
    return fail('invalid', 'This audit event has no restorable override snapshot.', { status: 422 });
  }
  return {
    ...(snapshot as unknown as OverrideRecord),
    // Re-validate stored fields exactly as on read.
    fields: parseOverrideFields(JSON.stringify(snapshot.fields ?? {})),
    hidden: snapshot.hidden === true,
  };
}

async function revertLocation(db: SqlDatabase, ev: AuditEvent, ctx: DomainContext, actor: string) {
  const id = ev.entityId!;
  const before = asLocation(ev.before, id);
  const current = await getLocationRow(db, id);
  if (!unchangedSince(current, ev.after)) return conflict('This location', current);
  const now = isoNow(ctx);
  if (before.accessNodeId !== null) revalidateKeptAccess(ctx.base, before.accessNodeId, before.location);
  const detail = `Reverted audit event #${ev.id} (${ev.action})`;
  if (current) {
    const next: LocationRecord = {
      ...before,
      id: current.id,
      origin: current.origin,
      suggestionId: current.suggestionId,
      createdBy: current.createdBy,
      createdAt: current.createdAt,
    };
    return writeLocation(db, current, next, 'location.revert', actor, now, detail);
  }
  // Restore a permanently deleted location (it was hidden when deleted, so it comes back hidden).
  const restored: LocationRecord = {
    ...before,
    status: 'hidden',
    updatedBy: actor,
    updatedAt: now,
    revision: before.revision + 1,
  };
  // A concurrent restore of the same deletion makes this INSERT a no-op (0 changes → 409, no audit row).
  const [ins] = await db.batch([
    insertLocationIfAbsentStmt(db, restored),
    auditStmt(
      db,
      {
        at: now,
        actor,
        action: 'location.revert',
        entityType: 'location',
        entityId: id,
        before: null,
        after: restored,
        outcome: 'success',
        detail,
      },
      { sql: GUARD_AFTER_CHANGE },
    ),
  ]);
  if (changes(ins) !== 1) return conflict('This location', await getLocationRow(db, id));
  return restored;
}

async function revertOverride(db: SqlDatabase, ev: AuditEvent, ctx: DomainContext, actor: string) {
  const id = ev.entityId!;
  const before = asOverride(ev.before, id);
  const current = await getOverrideRow(db, id);
  if (!unchangedSince(current, ev.after)) return conflict('This override', current);
  const now = isoNow(ctx);
  const detail = `Reverted audit event #${ev.id} (${ev.action})`;
  if (before === null || isEmptyOverride(before)) {
    return writeOverride(db, id, current, { kind: 'delete' }, 'override.revert', actor, now, detail);
  }
  const place = ctx.base.places.get(id);
  if (!place) {
    return fail(
      'invalid',
      'The base place of this override is no longer in the dataset; it cannot be restored.',
      {
        status: 422,
      },
    );
  }
  if (before.accessNodeId !== null) {
    const loc = before.fields.location ?? place.location;
    if (!loc) return fail('invalid', 'The restored access point needs a map position.', { status: 422 });
    revalidateKeptAccess(ctx.base, before.accessNodeId, loc);
  }
  const next: OverrideRecord = {
    ...before,
    baseDatasetVersion: ctx.base.datasetVersion,
    updatedBy: actor,
    updatedAt: now,
    revision: current ? current.revision + 1 : before.revision + 1,
  };
  return writeOverride(
    db,
    id,
    current,
    { kind: current ? 'update' : 'insert', next },
    'override.revert',
    actor,
    now,
    detail,
  );
}

export async function revertAuditEvent(db: SqlDatabase, auditEventId: unknown, ctx: DomainContext) {
  const eventId = Number(auditEventId);
  return audited(
    db,
    ctx,
    { action: 'audit.revert', entityType: 'system', entityId: String(auditEventId) },
    async (actor) => {
      if (!Number.isInteger(eventId) || eventId <= 0) {
        fail('invalid', 'auditEventId must be a positive integer.', {
          issues: [{ path: 'auditEventId', message: 'Expected a positive integer' }],
        });
      }
      const ev = (await getAuditEvent(db, eventId)) ?? notFound('Audit event', String(eventId));
      if (ev.outcome !== 'success' || !REVERTABLE_ACTIONS.has(ev.action) || !ev.entityId) {
        return fail('invalid', `Audit event #${ev.id} (${ev.action}, ${ev.outcome}) cannot be reverted.`, {
          status: 422,
        });
      }
      const result =
        ev.entityType === 'location'
          ? await revertLocation(db, ev, ctx, actor)
          : await revertOverride(db, ev, ctx, actor);
      return { revertedEventId: ev.id, entityType: ev.entityType, entityId: ev.entityId, record: result };
    },
  );
}
