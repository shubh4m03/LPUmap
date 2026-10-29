/**
 * Public submissions and their pre-approval editing. A submission can never
 * publish itself: it is always stored as `pending` with server-assigned id,
 * timestamps and revision; client-supplied status/actor fields are stripped
 * by the schema and ignored. Honeypot handling is the HTTP layer's job.
 */
import { findPossibleDuplicates } from '../../src/community/index.ts';
import {
  contributionInputSchema,
  type ContributionInput,
  type DuplicateCandidate,
  type SuggestionStatus,
} from '../../src/community/index.ts';
import { auditStmt, entityHistory } from '../db/audit.ts';
import { listLocationRows } from '../db/locations.ts';
import type { AuditEvent, SuggestionRecord } from '../db/records.ts';
import { GUARD_AFTER_CHANGE, changes } from '../db/sql.ts';
import {
  getSuggestionRow,
  insertSuggestionStmt,
  listSuggestionRows,
  openSuggestions,
  updateSuggestionStmt,
  type SuggestionFilter,
} from '../db/suggestions.ts';
import type { SqlDatabase } from '../db/types.ts';
import { conflict, invalidTransition, notFound, parseOrThrow } from '../errors.ts';
import { audited } from './audited.ts';
import { idsOf, isoNow, PUBLIC_ACTOR, type DomainContext } from './context.ts';
import { baseSources, locationSources, suggestionSources } from './duplicate-sources.ts';
import { assertInArea, requireObject, requireRevision } from './validate.ts';

/** Statuses in which the owner may still edit a suggestion. */
export const EDITABLE_STATUSES: readonly SuggestionStatus[] = ['pending', 'needs_information'];

const orNull = (s: string | undefined) => (s === undefined ? null : s);

/** Public-safe duplicates: base places and active published locations only (never other pending submissions). */
async function publicDuplicates(db: SqlDatabase, ctx: DomainContext, input: ContributionInput) {
  const active = await listLocationRows(db, { status: 'active' });
  return findPossibleDuplicates(
    { name: input.name, categoryId: input.categoryId, location: input.location },
    [...baseSources(ctx.base), ...locationSources(active)],
  );
}

/**
 * Honeypot decoy (docs/COMMUNITY_MODULE_CONTRACTS.md): the same validation,
 * area check, duplicate lookup and id generation as createSuggestion, so the
 * answer is indistinguishable from a real one — but nothing is written (no
 * suggestion, no audit event). The reference is a fresh random id that no
 * record will ever have.
 */
export async function decoySuggestion(
  db: SqlDatabase,
  raw: unknown,
  ctx: DomainContext,
): Promise<{ reference: string; possibleDuplicates: DuplicateCandidate[] }> {
  const input = parseOrThrow(contributionInputSchema, raw, 'Suggestion');
  assertInArea(input.location);
  const reference = idsOf(ctx).next('suggestion');
  const possibleDuplicates = await publicDuplicates(db, ctx, input);
  return { reference, possibleDuplicates };
}

export async function createSuggestion(
  db: SqlDatabase,
  raw: unknown,
  ctx: DomainContext,
): Promise<{ reference: string; possibleDuplicates: DuplicateCandidate[] }> {
  const input = parseOrThrow(contributionInputSchema, raw, 'Suggestion');
  assertInArea(input.location);
  const now = isoNow(ctx);
  const rec: SuggestionRecord = {
    id: idsOf(ctx).next('suggestion'),
    status: 'pending',
    name: input.name,
    categoryId: input.categoryId,
    location: [input.location[0], input.location[1]],
    description: orNull(input.description),
    landmark: orNull(input.landmark),
    evidenceUrl: orNull(input.evidenceUrl),
    details: orNull(input.details),
    duplicateOf: null,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    publishedLocationId: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  const possibleDuplicates = await publicDuplicates(db, ctx, input);
  await db.batch([
    insertSuggestionStmt(db, rec),
    auditStmt(
      db,
      {
        at: now,
        actor: PUBLIC_ACTOR,
        action: 'suggestion.create',
        entityType: 'suggestion',
        entityId: rec.id,
        after: rec,
        outcome: 'success',
      },
      { sql: GUARD_AFTER_CHANGE },
    ),
  ]);
  return { reference: rec.id, possibleDuplicates };
}

export function listSuggestions(db: SqlDatabase, filter: SuggestionFilter = {}) {
  return listSuggestionRows(db, filter);
}

/** Owner view: possible duplicates include other open suggestions and published locations. */
export async function duplicatesForSuggestion(
  db: SqlDatabase,
  s: SuggestionRecord,
  ctx: DomainContext,
): Promise<DuplicateCandidate[]> {
  const [locations, open] = await Promise.all([listLocationRows(db), openSuggestions(db)]);
  return findPossibleDuplicates(
    s,
    [...baseSources(ctx.base), ...locationSources(locations), ...suggestionSources(open)],
    { excludeIds: new Set([s.id, ...(s.publishedLocationId ? [s.publishedLocationId] : [])]) },
  );
}

export async function getSuggestion(
  db: SqlDatabase,
  id: string,
  ctx: DomainContext,
): Promise<{
  suggestion: SuggestionRecord;
  possibleDuplicates: DuplicateCandidate[];
  history: AuditEvent[];
}> {
  const suggestion = (await getSuggestionRow(db, id)) ?? notFound('Suggestion', id);
  const [possibleDuplicates, history] = await Promise.all([
    duplicatesForSuggestion(db, suggestion, ctx),
    entityHistory(db, 'suggestion', id),
  ]);
  return { suggestion, possibleDuplicates, history };
}

/** Loads a suggestion and enforces the optimistic revision. */
export async function loadForUpdate(
  db: SqlDatabase,
  id: string,
  revision: number,
): Promise<SuggestionRecord> {
  const current = (await getSuggestionRow(db, id)) ?? notFound('Suggestion', id);
  if (current.revision !== revision) conflict('This suggestion', current);
  return current;
}

/** After a conditional write changed nothing: explain why with the current state. */
export async function explainNoChange(
  db: SqlDatabase,
  id: string,
  revision: number,
  allowedFrom: readonly SuggestionStatus[],
  to: string,
): Promise<never> {
  const now = (await getSuggestionRow(db, id)) ?? notFound('Suggestion', id);
  if (now.revision !== revision) return conflict('This suggestion', now);
  if (!allowedFrom.includes(now.status)) return invalidTransition(now.status, to);
  return conflict('This suggestion', now);
}

const EDITABLE_KEYS = [
  'name',
  'categoryId',
  'location',
  'description',
  'landmark',
  'evidenceUrl',
  'details',
] as const;

export async function editSuggestion(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: DomainContext,
): Promise<SuggestionRecord> {
  return audited(
    db,
    ctx,
    { action: 'suggestion.edit', entityType: 'suggestion', entityId: id },
    async (actor) => {
      const b = requireObject(body, 'Request');
      const revision = requireRevision(b.revision);
      const fields = requireObject(b.fields ?? {}, 'fields');
      const current = await loadForUpdate(db, id, revision);
      if (!EDITABLE_STATUSES.includes(current.status)) invalidTransition(current.status, 'edited');

      const merged: Record<string, unknown> = {
        name: current.name,
        categoryId: current.categoryId,
        location: current.location,
        description: current.description ?? undefined,
        landmark: current.landmark ?? undefined,
        evidenceUrl: current.evidenceUrl ?? undefined,
        details: current.details ?? undefined,
      };
      for (const k of EDITABLE_KEYS) if (k in fields) merged[k] = fields[k] === null ? undefined : fields[k];
      const next = parseOrThrow(contributionInputSchema, merged, 'Suggestion', { prefix: 'fields' });
      assertInArea(next.location, 'fields.location');

      const now = isoNow(ctx);
      const after: SuggestionRecord = {
        ...current,
        name: next.name,
        categoryId: next.categoryId,
        location: [next.location[0], next.location[1]],
        description: orNull(next.description),
        landmark: orNull(next.landmark),
        evidenceUrl: orNull(next.evidenceUrl),
        details: orNull(next.details),
        updatedAt: now,
        revision: current.revision + 1,
      };
      const [upd] = await db.batch([
        updateSuggestionStmt(db, id, revision, EDITABLE_STATUSES, {
          name: after.name,
          categoryId: after.categoryId,
          location: after.location,
          description: after.description,
          landmark: after.landmark,
          evidenceUrl: after.evidenceUrl,
          details: after.details,
          updatedAt: now,
        }),
        auditStmt(
          db,
          {
            at: now,
            actor,
            action: 'suggestion.edit',
            entityType: 'suggestion',
            entityId: id,
            before: current,
            after,
            outcome: 'success',
          },
          { sql: GUARD_AFTER_CHANGE },
        ),
      ]);
      if (changes(upd) !== 1) return explainNoChange(db, id, revision, EDITABLE_STATUSES, 'edited');
      return after;
    },
  );
}
