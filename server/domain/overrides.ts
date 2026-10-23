/**
 * Owner overrides of base (OSM/curated) places, keyed by the stable base id so
 * they survive dataset rebuilds. The base files are never modified.
 *
 * - The target must exist in the CURRENT base dataset to be created/edited
 *   (an orphan — target vanished in a rebuild — can still be viewed/deleted).
 * - Fields equal to the base value are dropped (an override stores only real
 *   differences); `base_dataset_version` records the dataset it was made on.
 * - An override with no fields, not hidden and no access node is deleted.
 * - Access nodes are validated (exists, walkable, ≤ maxPlaceConnectorM), never snapped.
 * - Every change bumps publication_version and writes an audit row in the same batch.
 */
import { overrideFieldsSchema, type OverrideFields } from '../../src/community/schema.ts';
import type { LngLat, Place } from '../../src/data/schema.ts';
import { auditStmt } from '../db/audit.ts';
import { bumpPublicationStmt } from '../db/meta.ts';
import {
  deleteOverrideStmt,
  getOverrideRow,
  insertOverrideStmt,
  listOverrideRows,
  updateOverrideStmt,
} from '../db/overrides.ts';
import type { OverrideRecord } from '../db/records.ts';
import { GUARD_AFTER_CHANGE, changes } from '../db/sql.ts';
import type { SqlDatabase, SqlStatement } from '../db/types.ts';
import { conflict, fail, notFound, parseOrThrow, unprocessable } from '../errors.ts';
import type { BaseData } from '../base-data.ts';
import { audited } from './audited.ts';
import { isoNow, type DomainContext } from './context.ts';
import {
  assertInArea,
  optionalNote,
  requireObject,
  requireRevision,
  revalidateKeptAccess,
  validateAccessPoint,
  type AccessResult,
} from './validate.ts';

type FieldKey = keyof OverrideFields;

/** The base value of each overridable field (undefined = base has none). */
export function baseFieldValue(p: Place, key: FieldKey): unknown {
  switch (key) {
    case 'name':
      return p.name ?? undefined;
    case 'categoryId':
      return p.categoryId;
    case 'location':
      return p.location ?? undefined;
    case 'description':
      return p.description;
    case 'openingHours':
      return p.openingHours;
    case 'wheelchair':
      return p.wheelchair;
    case 'website':
      return p.contact?.website;
    case 'sourceUrl':
      return undefined;
    case 'verificationStatus':
      return p.provenance.verificationStatus;
    case 'lastVerifiedAt':
      return p.provenance.lastVerifiedAt;
  }
}

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((x, i) => x === b[i])
    : a === b && a !== undefined;

const FIELD_KEYS = Object.keys(overrideFieldsSchema.shape) as FieldKey[];

/**
 * Validates override fields and drops those equal to the base value. Values
 * equal to the base are removed BEFORE validation too, so e.g. a base place in
 * the non-assignable 'building' category can still be edited.
 */
export function normalizeOverrideFields(p: Place, raw: unknown): OverrideFields {
  const input = { ...requireObject(raw ?? {}, 'fields') };
  for (const k of Object.keys(input)) {
    const val = input[k];
    if (val === null || val === undefined || sameValue(val, baseFieldValue(p, k as FieldKey)))
      delete input[k];
  }
  const parsed = parseOrThrow(overrideFieldsSchema, input, 'Override', { prefix: 'fields' });
  const out: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) {
    const val = parsed[k];
    if (val !== undefined && !sameValue(val, baseFieldValue(p, k))) out[k] = val;
  }
  if (out.location) assertInArea(out.location as LngLat, 'fields.location');
  return out as OverrideFields;
}

export const isEmptyOverride = (o: Pick<OverrideRecord, 'fields' | 'hidden' | 'accessNodeId'>): boolean =>
  Object.keys(o.fields).length === 0 && !o.hidden && o.accessNodeId === null;

const effectiveLocation = (p: Place, fields: OverrideFields): LngLat | null => fields.location ?? p.location;

function requireBasePlace(base: BaseData, targetId: string): Place {
  const p = base.places.get(targetId);
  if (!p) {
    return fail(
      'not-found',
      `Base place ${JSON.stringify(targetId.slice(0, 120))} is not in the current dataset.`,
    );
  }
  return p;
}

export interface OverrideView extends OverrideRecord {
  /** Target no longer exists in the current base dataset (not applied publicly). */
  orphan: boolean;
  baseName: string | null;
}

const view = (o: OverrideRecord, base: BaseData): OverrideView => {
  const p = base.places.get(o.targetId);
  return { ...o, orphan: !p, baseName: p ? p.displayName : null };
};

export async function listOverrides(db: SqlDatabase, ctx: Pick<DomainContext, 'base'>) {
  const rows = await listOverrideRows(db);
  return { items: rows.map((o) => view(o, ctx.base)) };
}

export async function getOverride(db: SqlDatabase, targetId: string, ctx: Pick<DomainContext, 'base'>) {
  const override = await getOverrideRow(db, targetId);
  const place = ctx.base.places.get(targetId) ?? null;
  if (!override && !place) return notFound('Place', targetId);
  return { targetId, place, override: override ? view(override, ctx.base) : null, orphan: !place };
}

type Op = { kind: 'insert' | 'update'; next: OverrideRecord } | { kind: 'delete' } | { kind: 'none' };

/**
 * Persists one override change atomically: write → audit (only if the write
 * changed a row) → publication bump (only if the audit row was written).
 */
export async function writeOverride(
  db: SqlDatabase,
  targetId: string,
  current: OverrideRecord | null,
  op: Op,
  action: string,
  actor: string,
  now: string,
  detail?: string,
): Promise<OverrideRecord | null> {
  if (op.kind === 'none') return current;
  let write: SqlStatement;
  let after: OverrideRecord | null;
  if (op.kind === 'delete') {
    if (!current) return null;
    write = deleteOverrideStmt(db, targetId, current.revision);
    after = null;
  } else if (op.kind === 'insert') {
    after = { ...op.next, revision: op.next.revision };
    write = insertOverrideStmt(db, after);
  } else {
    if (!current) return fail('internal', 'Cannot update a missing override.');
    after = { ...op.next, revision: current.revision + 1 };
    write = updateOverrideStmt(db, after, current.revision);
  }
  const [w] = await db.batch([
    write,
    auditStmt(
      db,
      {
        at: now,
        actor,
        action,
        entityType: 'override',
        entityId: targetId,
        before: current,
        after,
        outcome: 'success',
        detail: detail ?? null,
      },
      { sql: GUARD_AFTER_CHANGE },
    ),
    bumpPublicationStmt(db, now, { sql: GUARD_AFTER_CHANGE }),
  ]);
  if (changes(w) !== 1) return conflict('This override', await getOverrideRow(db, targetId));
  return after;
}

/** Loads the override row and enforces `revision` (null = "I expect no override yet"). */
async function loadForUpdate(db: SqlDatabase, targetId: string, revision: number | null) {
  const current = await getOverrideRow(db, targetId);
  if (revision === null ? current !== null : current?.revision !== revision) {
    if (!current && revision !== null) return notFound('Override', targetId);
    return conflict('This override', current);
  }
  return current;
}

const requireNullableRevision = (v: unknown): number | null => (v === null ? null : requireRevision(v));

function record(
  targetId: string,
  base: BaseData,
  actor: string,
  now: string,
  parts: Pick<OverrideRecord, 'fields' | 'hidden' | 'accessNodeId' | 'accessNote' | 'note'>,
): OverrideRecord {
  return {
    targetId,
    ...parts,
    baseDatasetVersion: base.datasetVersion,
    updatedBy: actor,
    updatedAt: now,
    revision: 1,
  };
}

const opFor = (current: OverrideRecord | null, next: OverrideRecord): Op =>
  isEmptyOverride(next)
    ? current
      ? { kind: 'delete' }
      : { kind: 'none' }
    : { kind: current ? 'update' : 'insert', next };

export async function putOverride(
  db: SqlDatabase,
  targetId: string,
  body: unknown,
  ctx: DomainContext,
): Promise<{ override: OverrideRecord | null }> {
  return audited(
    db,
    ctx,
    { action: 'override.put', entityType: 'override', entityId: targetId },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireNullableRevision(b.revision);
      const place = requireBasePlace(ctx.base, targetId);
      if (typeof b.hidden !== 'boolean') {
        fail('invalid', 'hidden must be true or false.', {
          issues: [{ path: 'hidden', message: 'Expected boolean' }],
        });
      }
      const fields = normalizeOverrideFields(place, b.fields);
      const current = await loadForUpdate(db, targetId, revision);
      const location = effectiveLocation(place, fields);

      let access: AccessResult;
      if (b.accessPoint === null) access = { accessNodeId: null, accessNote: null };
      else if (b.accessPoint !== undefined) access = validateAccessPoint(ctx.base, b.accessPoint, location);
      else {
        access = { accessNodeId: current?.accessNodeId ?? null, accessNote: current?.accessNote ?? null };
        if (access.accessNodeId !== null) {
          if (!location) unprocessable('accessPoint', 'An access point needs a map position for the place.');
          else revalidateKeptAccess(ctx.base, access.accessNodeId, location);
        }
      }
      const noteIn = optionalNote(b.note, 'note');
      const note = noteIn === undefined ? (current?.note ?? null) : noteIn;
      const next = record(targetId, ctx.base, actor, isoNow(ctx), {
        fields,
        hidden: b.hidden as boolean,
        ...access,
        note,
      });
      const saved = await writeOverride(
        db,
        targetId,
        current,
        opFor(current, next),
        'override.put',
        actor,
        isoNow(ctx),
      );
      return { override: saved };
    },
  );
}

export async function hideOverride(
  db: SqlDatabase,
  targetId: string,
  body: unknown,
  ctx: DomainContext,
): Promise<{ override: OverrideRecord | null }> {
  return audited(
    db,
    ctx,
    { action: 'override.hide', entityType: 'override', entityId: targetId },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireNullableRevision(b.revision ?? null);
      requireBasePlace(ctx.base, targetId);
      const current = await loadForUpdate(db, targetId, revision);
      if (current?.hidden)
        fail('invalid-transition', 'This place is already hidden.', { details: { current } });
      const now = isoNow(ctx);
      const next: OverrideRecord = current
        ? {
            ...current,
            hidden: true,
            baseDatasetVersion: ctx.base.datasetVersion,
            updatedBy: actor,
            updatedAt: now,
          }
        : record(targetId, ctx.base, actor, now, {
            fields: {},
            hidden: true,
            accessNodeId: null,
            accessNote: null,
            note: null,
          });
      return {
        override: await writeOverride(
          db,
          targetId,
          current,
          opFor(current, next),
          'override.hide',
          actor,
          now,
        ),
      };
    },
  );
}

export async function unhideOverride(
  db: SqlDatabase,
  targetId: string,
  body: unknown,
  ctx: DomainContext,
): Promise<{ override: OverrideRecord | null }> {
  return audited(
    db,
    ctx,
    { action: 'override.unhide', entityType: 'override', entityId: targetId },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const current = await loadForUpdate(db, targetId, revision);
      if (!current?.hidden) fail('invalid-transition', 'This place is not hidden.', { details: { current } });
      const now = isoNow(ctx);
      const next: OverrideRecord = { ...current!, hidden: false, updatedBy: actor, updatedAt: now };
      return {
        override: await writeOverride(
          db,
          targetId,
          current,
          opFor(current, next),
          'override.unhide',
          actor,
          now,
        ),
      };
    },
  );
}

/** Removes the override entirely (the place reverts to its base values). Allowed for orphans too. */
export async function deleteOverride(
  db: SqlDatabase,
  targetId: string,
  body: unknown,
  ctx: DomainContext,
): Promise<{ override: null }> {
  return audited(
    db,
    ctx,
    { action: 'override.delete', entityType: 'override', entityId: targetId },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const current = await loadForUpdate(db, targetId, revision);
      await writeOverride(db, targetId, current, { kind: 'delete' }, 'override.delete', actor, isoNow(ctx));
      return { override: null };
    },
  );
}
