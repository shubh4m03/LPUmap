/**
 * Owner-managed locations (`own:` created here, `com:` created by approving a
 * suggestion). Every write is one db.batch: conditional change (id + revision
 * [+ status]) + publication bump (when publicly visible) + audit row guarded on
 * the change having happened. Hide/restore are reversible; permanent delete is
 * allowed only for hidden locations and requires the exact current name.
 */
import { placeFieldsSchema, type PlaceFields } from '../../src/community/index.ts';
import { auditStmt } from '../db/audit.ts';
import {
  deleteLocationStmt,
  getLocationRow,
  insertLocationStmt,
  listLocationRows,
  updateLocationStmt,
  type LocationFilter,
} from '../db/locations.ts';
import { bumpPublicationStmt } from '../db/meta.ts';
import type { LocationRecord, LocationStatus } from '../db/records.ts';
import { GUARD_AFTER_CHANGE, changes } from '../db/sql.ts';
import type { SqlDatabase, SqlStatement } from '../db/types.ts';
import { conflict, fail, notFound, parseOrThrow } from '../errors.ts';
import { audited } from './audited.ts';
import { idsOf, isoNow, type DomainContext } from './context.ts';
import {
  assertInArea,
  requireObject,
  requireRevision,
  revalidateKeptAccess,
  validateAccessPoint,
  type AccessResult,
} from './validate.ts';

const LOCATION_STATUSES = ['active', 'hidden'] as const;
const ORIGINS = ['owner', 'community'] as const;

export function listLocations(db: SqlDatabase, filter: Record<string, unknown> = {}) {
  const f: LocationFilter = {};
  if (typeof filter.status === 'string' && (LOCATION_STATUSES as readonly string[]).includes(filter.status))
    f.status = filter.status;
  if (typeof filter.origin === 'string' && (ORIGINS as readonly string[]).includes(filter.origin))
    f.origin = filter.origin;
  if (typeof filter.q === 'string') f.q = filter.q;
  return listLocationRows(db, f).then((items) => ({ items }));
}

export async function getLocation(db: SqlDatabase, id: string): Promise<LocationRecord> {
  return (await getLocationRow(db, id)) ?? notFound('Location', id);
}

/** Applies validated place fields onto a location record (null for absent optional values). */
export function withFields(rec: LocationRecord, f: PlaceFields): LocationRecord {
  return {
    ...rec,
    name: f.name,
    categoryId: f.categoryId,
    location: [f.location[0], f.location[1]],
    description: f.description ?? null,
    openingHours: f.openingHours ?? null,
    wheelchair: f.wheelchair,
    website: f.website ?? null,
    sourceUrl: f.sourceUrl ?? null,
    verificationStatus: f.verificationStatus,
    lastVerifiedAt: f.lastVerifiedAt ?? null,
  };
}

/** Current editable values in placeFieldsSchema input shape. */
export function fieldsOf(l: LocationRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: l.name,
    categoryId: l.categoryId,
    location: l.location,
    wheelchair: l.wheelchair,
    verificationStatus: l.verificationStatus,
  };
  const optional = {
    description: l.description,
    openingHours: l.openingHours,
    website: l.website,
    sourceUrl: l.sourceUrl,
    lastVerifiedAt: l.lastVerifiedAt,
  };
  for (const [k, v] of Object.entries(optional)) if (v !== null) out[k] = v;
  return out;
}

const parseFields = (raw: unknown): PlaceFields => {
  const f = parseOrThrow(placeFieldsSchema, raw, 'Location', { prefix: 'fields' });
  assertInArea(f.location, 'fields.location');
  return f;
};

const sameLocation = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

/** Publication bump statement for a change that is (or was) publicly visible. */
const bumpIf = (db: SqlDatabase, visible: boolean, now: string): SqlStatement[] =>
  visible ? [bumpPublicationStmt(db, now, { sql: GUARD_AFTER_CHANGE })] : [];

export async function createLocation(
  db: SqlDatabase,
  body: unknown,
  ctx: DomainContext,
): Promise<LocationRecord> {
  return audited(
    db,
    ctx,
    { action: 'location.create', entityType: 'location', entityId: null },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const fields = parseFields(b.fields);
      const access: AccessResult =
        b.accessPoint === undefined || b.accessPoint === null
          ? { accessNodeId: null, accessNote: null }
          : validateAccessPoint(ctx.base, b.accessPoint, fields.location);
      const now = isoNow(ctx);
      const rec = withFields(
        {
          id: idsOf(ctx).next('owner'),
          origin: 'owner',
          suggestionId: null,
          accessNodeId: access.accessNodeId,
          accessNote: access.accessNote,
          status: 'active',
          createdBy: actor,
          createdAt: now,
          updatedBy: actor,
          updatedAt: now,
          revision: 1,
        } as LocationRecord,
        fields,
      );
      // The INSERT either succeeds or throws (rolling the batch back), so the follow-ups need no guard.
      await db.batch([
        insertLocationStmt(db, rec),
        bumpPublicationStmt(db, now),
        auditStmt(db, {
          at: now,
          actor,
          action: 'location.create',
          entityType: 'location',
          entityId: rec.id,
          before: null,
          after: rec,
          outcome: 'success',
        }),
      ]);
      return rec;
    },
  );
}

/** Loads a location and enforces the optimistic revision. */
async function loadForUpdate(db: SqlDatabase, id: string, revision: number): Promise<LocationRecord> {
  const current = (await getLocationRow(db, id)) ?? notFound('Location', id);
  if (current.revision !== revision) conflict('This location', current);
  return current;
}

/** Writes `next` over `current` (optimistic), bumping publication if either side is public, with audit. */
export async function writeLocation(
  db: SqlDatabase,
  current: LocationRecord,
  next: LocationRecord,
  action: string,
  actor: string,
  now: string,
  detail?: string,
): Promise<LocationRecord> {
  const after: LocationRecord = { ...next, updatedBy: actor, updatedAt: now, revision: current.revision + 1 };
  // The audit row is written FIRST, guarded by exactly the UPDATE's own precondition, so both happen or
  // neither does. (Checking "revision = R+1" afterwards is not enough: a concurrent writer that won the
  // race also produces R+1, which would leave a false 'success' row for a change that never happened.)
  const [, upd] = await db.batch([
    auditStmt(
      db,
      {
        at: now,
        actor,
        action,
        entityType: 'location',
        entityId: current.id,
        before: current,
        after,
        outcome: 'success',
        detail: detail ?? null,
      },
      {
        sql: 'EXISTS (SELECT 1 FROM locations WHERE id = ? AND revision = ? AND status = ?)',
        values: [current.id, current.revision, current.status],
      },
    ),
    updateLocationStmt(db, after, current.revision, current.status),
    // Immediately after the UPDATE, so changes() refers to it.
    ...bumpIf(db, current.status === 'active' || after.status === 'active', now),
  ]);
  if (changes(upd) !== 1) {
    const latest = (await getLocationRow(db, current.id)) ?? notFound('Location', current.id);
    return conflict('This location', latest);
  }
  return after;
}

export async function updateLocation(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: DomainContext,
): Promise<LocationRecord> {
  return audited(
    db,
    ctx,
    { action: 'location.update', entityType: 'location', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const patch = requireObject(b.fields ?? {}, 'fields');
      const current = await loadForUpdate(db, id, revision);
      // Absent keys keep their current value; null clears an optional field.
      const merged: Record<string, unknown> = { ...fieldsOf(current) };
      for (const [k, val] of Object.entries(patch)) {
        if (val === null) delete merged[k];
        else merged[k] = val;
      }
      const fields = parseFields(merged);
      let access: AccessResult;
      if (b.accessPoint === null) access = { accessNodeId: null, accessNote: null };
      else if (b.accessPoint !== undefined)
        access = validateAccessPoint(ctx.base, b.accessPoint, fields.location);
      else {
        access = { accessNodeId: current.accessNodeId, accessNote: current.accessNote };
        if (current.accessNodeId !== null && !sameLocation(current.location, fields.location))
          revalidateKeptAccess(ctx.base, current.accessNodeId, fields.location);
      }
      const next = { ...withFields(current, fields), ...access };
      return writeLocation(db, current, next, 'location.update', actor, isoNow(ctx));
    },
  );
}

async function setStatus(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: DomainContext,
  to: LocationStatus,
  action: string,
): Promise<LocationRecord> {
  return audited(db, ctx, { action, entityType: 'location', entityId: id }, async (actor) => {
    const b = requireObject(body, 'Request');
    const revision = requireRevision(b.revision);
    const current = await loadForUpdate(db, id, revision);
    if (current.status === to) {
      fail('invalid-transition', `This location is already ${to}.`, { details: { current } });
    }
    return writeLocation(db, current, { ...current, status: to }, action, actor, isoNow(ctx));
  });
}

export const hideLocation = (db: SqlDatabase, id: string, body: unknown, ctx: DomainContext) =>
  setStatus(db, id, body, ctx, 'hidden', 'location.hide');

export const restoreLocation = (db: SqlDatabase, id: string, body: unknown, ctx: DomainContext) =>
  setStatus(db, id, body, ctx, 'active', 'location.restore');

export async function deleteLocation(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: DomainContext,
): Promise<{ deleted: string }> {
  return audited(
    db,
    ctx,
    { action: 'location.delete', entityType: 'location', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const current = await loadForUpdate(db, id, revision);
      if (current.status !== 'hidden') {
        fail('invalid-transition', 'Only hidden locations can be deleted permanently. Hide it first.', {
          details: { current },
        });
      }
      if (typeof b.confirmName !== 'string' || b.confirmName !== current.name) {
        fail('invalid', 'Type the exact current name of the location to confirm deletion.', {
          issues: [{ path: 'confirmName', message: 'Does not match the current name' }],
        });
      }
      const now = isoNow(ctx);
      // The audit row (with the full before snapshot) is written first, guarded by exactly the same
      // condition as the DELETE that follows, so both happen or neither does.
      const [audit, del] = await db.batch([
        auditStmt(
          db,
          {
            at: now,
            actor,
            action: 'location.delete',
            entityType: 'location',
            entityId: id,
            before: current,
            after: null,
            outcome: 'success',
            detail: 'Permanently deleted (the before snapshot can be restored with revert).',
          },
          {
            sql: "EXISTS (SELECT 1 FROM locations WHERE id = ? AND revision = ? AND status = 'hidden')",
            values: [id, revision],
          },
        ),
        deleteLocationStmt(db, id, revision),
      ]);
      if (changes(del) !== 1 || changes(audit) !== 1) {
        const latest = (await getLocationRow(db, id)) ?? notFound('Location', id);
        return conflict('This location', latest);
      }
      return { deleted: id };
    },
  );
}
