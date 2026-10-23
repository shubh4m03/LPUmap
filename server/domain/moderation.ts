/**
 * Owner moderation of suggestions. Every transition is checked with
 * canTransition() and applied with a conditional UPDATE (id + revision +
 * allowed source status) in one batch with its audit row.
 *
 * approveSuggestion publishes atomically: in ONE db.batch the suggestion is
 * marked approved, the `com:` location is inserted only if that update took
 * effect, the publication version is bumped and audit rows are written. A
 * failing statement rolls the whole batch back; UNIQUE(suggestion_id) and
 * UNIQUE(published_location_id) make a second publication impossible.
 */
import {
  canTransition,
  overrideFieldsSchema,
  placeFieldsSchema,
  SUGGESTION_TRANSITIONS,
  type SuggestionStatus,
} from '../../src/community/schema.ts';
import { auditStmt } from '../db/audit.ts';
import { getLocationRow, insertLocationIfStmt } from '../db/locations.ts';
import { bumpPublicationStmt } from '../db/meta.ts';
import type { LocationRecord, SuggestionRecord } from '../db/records.ts';
import { GUARD_AFTER_CHANGE, changes } from '../db/sql.ts';
import { getSuggestionRow, updateSuggestionStmt, type SuggestionSet } from '../db/suggestions.ts';
import type { SqlDatabase } from '../db/types.ts';
import { fail, invalidTransition, parseOrThrow } from '../errors.ts';
import { audited } from './audited.ts';
import { idsOf, isoNow, type DomainContext } from './context.ts';
import { explainNoChange, loadForUpdate } from './suggestions.ts';
import {
  assertInArea,
  optionalNote,
  requireObject,
  requireRevision,
  validateAccessPoint,
} from './validate.ts';

const STATUSES = Object.keys(SUGGESTION_TRANSITIONS) as SuggestionStatus[];
export const allowedFrom = (to: SuggestionStatus): SuggestionStatus[] =>
  STATUSES.filter((s) => canTransition(s, to));

async function transition(
  db: SqlDatabase,
  id: string,
  revision: number,
  to: SuggestionStatus,
  action: string,
  ctx: DomainContext,
  actor: string,
  extra: (current: SuggestionRecord) => SuggestionSet,
): Promise<SuggestionRecord> {
  const current = await loadForUpdate(db, id, revision);
  if (!canTransition(current.status, to)) invalidTransition(current.status, to);
  const now = isoNow(ctx);
  const set: SuggestionSet = {
    status: to,
    reviewedBy: actor,
    reviewedAt: now,
    updatedAt: now,
    ...extra(current),
  };
  const after: SuggestionRecord = {
    ...current,
    ...(set as Partial<SuggestionRecord>),
    revision: revision + 1,
  };
  const from = allowedFrom(to);
  const [upd] = await db.batch([
    updateSuggestionStmt(db, id, revision, from, set),
    auditStmt(
      db,
      {
        at: now,
        actor,
        action,
        entityType: 'suggestion',
        entityId: id,
        before: current,
        after,
        outcome: 'success',
      },
      { sql: GUARD_AFTER_CHANGE },
    ),
  ]);
  if (changes(upd) !== 1) return explainNoChange(db, id, revision, from, to);
  return after;
}

export async function rejectSuggestion(db: SqlDatabase, id: string, body: unknown, ctx: DomainContext) {
  return audited(
    db,
    ctx,
    { action: 'suggestion.reject', entityType: 'suggestion', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const reason = optionalNote(b.reason, 'reason');
      return transition(db, id, revision, 'rejected', 'suggestion.reject', ctx, actor, (c) => ({
        reviewNote: reason === undefined ? c.reviewNote : reason,
      }));
    },
  );
}

export async function requestInformation(db: SqlDatabase, id: string, body: unknown, ctx: DomainContext) {
  return audited(
    db,
    ctx,
    { action: 'suggestion.request-info', entityType: 'suggestion', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const note = optionalNote(b.note, 'note');
      return transition(
        db,
        id,
        revision,
        'needs_information',
        'suggestion.request-info',
        ctx,
        actor,
        (c) => ({
          reviewNote: note === undefined ? c.reviewNote : note,
        }),
      );
    },
  );
}

export async function reopenSuggestion(db: SqlDatabase, id: string, body: unknown, ctx: DomainContext) {
  return audited(
    db,
    ctx,
    { action: 'suggestion.reopen', entityType: 'suggestion', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      return transition(db, id, revision, 'pending', 'suggestion.reopen', ctx, actor, () => ({
        duplicateOf: null,
      }));
    },
  );
}

export async function markDuplicate(db: SqlDatabase, id: string, body: unknown, ctx: DomainContext) {
  return audited(
    db,
    ctx,
    { action: 'suggestion.duplicate', entityType: 'suggestion', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const target = typeof b.duplicateOf === 'string' ? b.duplicateOf.trim() : '';
      if (!target || target.length > 200) {
        fail('invalid', 'duplicateOf must be the id of an existing place, location or suggestion.', {
          issues: [{ path: 'duplicateOf', message: 'Required' }],
        });
      }
      if (target === id) {
        fail('invalid', 'A suggestion cannot be a duplicate of itself.', {
          issues: [{ path: 'duplicateOf', message: 'Must differ from the suggestion id' }],
        });
      }
      const exists =
        ctx.base.places.has(target) ||
        ctx.base.contextPlaces.has(target) ||
        (await getLocationRow(db, target)) ||
        (await getSuggestionRow(db, target));
      if (!exists) {
        fail(
          'invalid',
          `duplicateOf ${JSON.stringify(target.slice(0, 80))} does not match any place, location or suggestion.`,
          {
            status: 422,
            issues: [{ path: 'duplicateOf', message: 'Unknown id' }],
          },
        );
      }
      return transition(db, id, revision, 'duplicate', 'suggestion.duplicate', ctx, actor, () => ({
        duplicateOf: target,
      }));
    },
  );
}

export interface ApproveResult {
  suggestion: SuggestionRecord;
  location: LocationRecord;
}

export async function approveSuggestion(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: DomainContext,
): Promise<ApproveResult> {
  return audited(
    db,
    ctx,
    { action: 'suggestion.approve', entityType: 'suggestion', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const ownerFields =
        b.fields === undefined || b.fields === null
          ? {}
          : parseOrThrow(overrideFieldsSchema, b.fields, 'fields', { prefix: 'fields' });
      const current = await loadForUpdate(db, id, revision);
      if (!canTransition(current.status, 'approved')) invalidTransition(current.status, 'approved');

      // Validate the FINAL record: the (possibly edited) submission merged with the owner's corrections.
      const final = parseOrThrow(
        placeFieldsSchema,
        {
          name: current.name,
          categoryId: current.categoryId,
          location: current.location,
          description: current.description ?? undefined,
          ...ownerFields,
        },
        'Approved location',
        { prefix: 'fields' },
      );
      assertInArea(final.location, 'fields.location');
      const access =
        b.accessPoint === undefined || b.accessPoint === null
          ? { accessNodeId: null, accessNote: null }
          : validateAccessPoint(ctx.base, b.accessPoint, final.location);

      const now = isoNow(ctx);
      const locationId = idsOf(ctx).next('community');
      const location: LocationRecord = {
        id: locationId,
        origin: 'community',
        suggestionId: id,
        name: final.name,
        categoryId: final.categoryId,
        location: [final.location[0], final.location[1]],
        description: final.description ?? null,
        openingHours: final.openingHours ?? null,
        wheelchair: final.wheelchair,
        website: final.website ?? null,
        sourceUrl: final.sourceUrl ?? null,
        verificationStatus: final.verificationStatus,
        lastVerifiedAt: final.lastVerifiedAt ?? null,
        accessNodeId: access.accessNodeId,
        accessNote: access.accessNote,
        status: 'active',
        createdBy: actor,
        createdAt: now,
        updatedBy: actor,
        updatedAt: now,
        revision: 1,
      };
      const suggestion: SuggestionRecord = {
        ...current,
        status: 'approved',
        publishedLocationId: locationId,
        reviewedBy: actor,
        reviewedAt: now,
        updatedAt: now,
        revision: revision + 1,
      };
      const from = allowedFrom('approved');
      const published = {
        sql: "EXISTS (SELECT 1 FROM suggestions WHERE id = ? AND status = 'approved' AND published_location_id = ?)",
        values: [id, locationId],
      };
      const locationExists = { sql: 'EXISTS (SELECT 1 FROM locations WHERE id = ?)', values: [locationId] };
      const results = await db.batch([
        updateSuggestionStmt(db, id, revision, from, {
          status: 'approved',
          publishedLocationId: locationId,
          reviewedBy: actor,
          reviewedAt: now,
          updatedAt: now,
        }),
        insertLocationIfStmt(db, location, published),
        bumpPublicationStmt(db, now, locationExists),
        auditStmt(
          db,
          {
            at: now,
            actor,
            action: 'suggestion.approve',
            entityType: 'suggestion',
            entityId: id,
            before: current,
            after: suggestion,
            outcome: 'success',
            detail: `Published as ${locationId}`,
          },
          locationExists,
        ),
        auditStmt(
          db,
          {
            at: now,
            actor,
            action: 'location.create',
            entityType: 'location',
            entityId: locationId,
            before: null,
            after: location,
            outcome: 'success',
            detail: `Approved from suggestion ${id}`,
          },
          locationExists,
        ),
      ]);
      if (changes(results[0]) !== 1) return explainNoChange(db, id, revision, from, 'approved');
      if (changes(results[1]) !== 1) {
        // Unreachable while the guard holds; never report success without exactly one new location.
        return fail('internal', 'Approval did not create exactly one location; nothing was published.');
      }
      return { suggestion, location };
    },
  );
}
