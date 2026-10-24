/**
 * Building Studio records (docs/BUILDING_STUDIO_DESIGN.md §7–§9). Every write:
 *  - runs inside `audited` (rejected/failed attempts are audited too);
 *  - checks the optimistic `revision` (409 with `details.current` = the head);
 *  - is ONE db.batch whose audit row is written FIRST, guarded by exactly the
 *    precondition of the change that follows (so both happen or neither does),
 *    with the publication bump guarded on the change (`changes() > 0`).
 *
 * Audit policy for drafts: a draft save records the revision numbers and the
 * NAMES of the changed fields, never the coordinates or the draft itself.
 * Drafts are autosaved work in progress; the audit log is append-only and
 * never pruned, so storing every intermediate anchor would build a permanent,
 * fine-grained movement history of unpublished work with no accountability
 * value. The draft itself lives in studio_buildings. Every PUBLIC change
 * (publish, restore, archive, delete) is audited with its before/after
 * placement, identity changes, acknowledgements and change summary, and every
 * published version is kept immutably in studio_building_versions.
 */
import {
  applyTemplateRequestSchema,
  archiveRequestSchema,
  createStudioBuildingRequestSchema,
  defaultDuplicateOffsetM,
  deleteStudioBuildingRequestSchema,
  duplicateRequestSchema,
  missingAcknowledgements,
  modelSupport,
  OWNER_TEMPLATE_ID_RE,
  publishRequestSchema,
  restoreRequestSchema,
  revisionRequestSchema,
  saveDraftRequestSchema,
  studioDraftSchema,
  studioListQuerySchema,
  validateRequestSchema,
  type AccuracyClass,
  type Acknowledgement,
  type ApplyTemplateRequest,
  type ApplyTemplateResponse,
  type DeleteStudioBuildingResponse,
  type PublishedStudioBuilding,
  type PublishResponse,
  type StudioBuildingDetail,
  type StudioBuildingList,
  type StudioBuildingSummary,
  type StudioDraft,
  type ValidationResult,
} from '../../../src/building-studio/schema.ts';
import { createEnuFrame } from '../../../src/building-studio/footprint.ts';
import { applyTemplateVersion } from '../../../src/building-studio/template-compat.ts';
import { auditStmt, type AuditInput } from '../../db/audit.ts';
import { bumpPublicationStmt, getPublicationState, PUBLICATION_VERSION_KEY } from '../../db/meta.ts';
import { GUARD_AFTER_CHANGE, changes, decodeCursor, encodeCursor } from '../../db/sql.ts';
import {
  archiveStmt,
  deleteStudioBuildingStmt,
  deleteStudioVersionsStmt,
  discardDraftStmt,
  getStudioBuildingByTarget,
  getStudioBuildingRow,
  getStudioVersionRow,
  headGuard,
  insertStudioBuildingStmt,
  insertStudioVersionIfStmt,
  listStudioBuildingRows,
  listStudioVersionRows,
  markPublishedStmt,
  restoreStmt,
  saveDraftStmt,
  type StudioBuildingRow,
} from '../../db/studio-buildings.ts';
import { getTemplateVersionRow } from '../../db/studio-templates.ts';
import type { SqlDatabase, SqlStatement } from '../../db/types.ts';
import { conflict, fail, notFound, parseOrThrow } from '../../errors.ts';
import { audited } from '../audited.ts';
import { isoNow } from '../context.ts';
import { studioIds, type StudioContext } from './context.ts';
import {
  membershipFor,
  normalizeDraft,
  parseDraftForWrite,
  publishedStudioBuildings,
  runValidation,
  serializeDraft,
} from './engine.ts';
import { readDraft, toHead, toPublishedStudioBuilding, toPublishedVersion } from './records.ts';
import { resolveTemplateDefinition } from './templates.ts';

/** Honest label for a building without a name (never an invented name). */
export const UNNAMED_STUDIO_TITLE = 'Unnamed building (owner-placed model)';

/** Max serialized size of the before-snapshot a permanent delete keeps in the audit log. */
const DELETE_SNAPSHOT_MAX_BYTES = 1_500_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const target = (action: string, id: string | null) => ({
  action,
  entityType: 'building' as const,
  entityId: id,
});

const buildingAudit = (
  at: string,
  actor: string,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
  detail?: string,
): AuditInput => ({
  at,
  actor,
  action,
  entityType: 'building',
  entityId: id,
  before,
  after,
  outcome: 'success',
  detail: detail ?? null,
});

async function buildingConflict(db: SqlDatabase, id: string): Promise<never> {
  const latest = (await getStudioBuildingRow(db, id)) ?? notFound('Studio building', id);
  return conflict('This building', toHead(latest));
}

/** Loads a head and enforces the optimistic revision (409 with the current head). */
async function loadForWrite(db: SqlDatabase, id: string, revision: number): Promise<StudioBuildingRow> {
  const row = (await getStudioBuildingRow(db, id)) ?? notFound('Studio building', id);
  if (row.revision !== revision) conflict('This building', toHead(row));
  return row;
}

/** 409: at most one studio record per base building (UNIQUE target_id). */
const targetTaken = (targetId: string, existing: StudioBuildingRow): never =>
  fail('conflict', `${targetId} already has a studio record (${existing.id}); edit that record instead.`, {
    details: { current: toHead(existing) },
  });

const archivedTransition = (): never =>
  fail('invalid-transition', 'This building is archived. Restore it first.');

/** The published record of a head (latest version), or null. */
async function publishedRecordOf(db: SqlDatabase, row: StudioBuildingRow): Promise<StudioDraft | null> {
  if (row.publishedVersion === null) return null;
  const v = await getStudioVersionRow(db, row.id, row.publishedVersion);
  return v ? readDraft(v.record) : null;
}

/**
 * The record an action starts from: the draft, else the published record.
 * A stored model this build cannot read is 422 'unsupported-model' — the
 * write would otherwise reinterpret it silently.
 */
async function workingRecord(db: SqlDatabase, row: StudioBuildingRow): Promise<StudioDraft> {
  if (row.draft !== null) return readDraft(row.draft) ?? unsupportedStored(row.draft);
  const v =
    row.publishedVersion === null ? null : await getStudioVersionRow(db, row.id, row.publishedVersion);
  if (!v) return fail('invalid-transition', 'This building has no draft and no published version.');
  return readDraft(v.record) ?? unsupportedStored(v.record);
}

function unsupportedStored(stored: unknown): never {
  const model = typeof stored === 'object' && stored !== null ? (stored as Json).model : undefined;
  const support = modelSupport(model);
  return fail(
    'unsupported-model',
    support.ok
      ? 'The stored record does not match the current record format; it is kept unchanged.'
      : `${support.message} The stored record is kept unchanged.`,
  );
}

/** Dot paths whose values differ between two JSON values (names only, at most 100). */
export function changedPaths(a: unknown, b: unknown, prefix = ''): string[] {
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, p: string) => {
    if (out.length >= 100) return;
    const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
    if (isObj(x) && isObj(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort())
        walk(x[k], y[k], p ? `${p}.${k}` : k);
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(p || '(root)');
  };
  walk(a, b, prefix);
  return out;
}

const placement = (d: StudioDraft | null) =>
  d ? { anchor: d.model.anchor, rotationDeg: d.model.rotationDeg } : null;

/** Accuracy class of the template a model came from; a custom model is an illustrative 'generic-prefab'. */
async function accuracyClassFor(db: SqlDatabase, ctx: StudioContext, d: StudioDraft): Promise<AccuracyClass> {
  if (!d.templateRef) return 'generic-prefab';
  const t = await resolveTemplateDefinition(db, ctx, d.templateRef);
  return t?.accuracyClass ?? 'generic-prefab';
}

async function detailOf(
  db: SqlDatabase,
  ctx: StudioContext,
  row: StudioBuildingRow,
  published?: readonly PublishedStudioBuilding[],
): Promise<StudioBuildingDetail> {
  const draft = readDraft(row.draft);
  const versionRow =
    row.publishedVersion === null ? null : await getStudioVersionRow(db, row.id, row.publishedVersion);
  const pub = versionRow ? toPublishedVersion(versionRow) : null;
  // The draft when there is one (even an unreadable one: then there is nothing to validate), else the published record.
  const subject = row.draft !== null ? draft : (pub?.record ?? null);
  const rawModel =
    row.draft !== null ? (row.draft as Json | null)?.model : (versionRow?.record as Json | null)?.model;
  const support = modelSupport(rawModel);
  const validation = subject
    ? (await runValidation(db, ctx, subject, { recordId: row.id, targetId: row.targetId }, published)).result
    : null;
  return {
    head: toHead(row),
    draft,
    published: pub,
    validation,
    modelAvailable: support.ok,
    unavailableReason: support.ok ? null : support.reason,
  };
}

async function reload(db: SqlDatabase, ctx: StudioContext, id: string): Promise<StudioBuildingDetail> {
  const row = (await getStudioBuildingRow(db, id)) ?? notFound('Studio building', id);
  return detailOf(db, ctx, row);
}

const validationFailed = (validation: ValidationResult, missing?: string[]): never =>
  fail(
    'validation-failed',
    validation.errorCount > 0
      ? `Cannot publish: ${validation.errorCount} validation error${validation.errorCount === 1 ? '' : 's'} must be fixed first.`
      : `Cannot publish: acknowledge each warning with a reason (${(missing ?? []).join(', ')}).`,
    { details: { validation, ...(missing ? { missingAcknowledgements: missing } : {}) } },
  );

/**
 * `guard` AND publication_version still equals `version`. Publish and restore
 * validate overlaps/duplicates against the published set read at `version`;
 * a concurrent publish/archive/restore bumps it, so this write then changes
 * nothing (409) and a retry re-validates against the new set.
 */
const unchangedPublication = (
  guard: { sql: string; values: (string | number)[] },
  version: number,
): { sql: string; values: (string | number)[] } => ({
  sql: `${guard.sql} AND EXISTS (SELECT 1 FROM meta WHERE key = '${PUBLICATION_VERSION_KEY}' AND CAST(value AS INTEGER) = ?)`,
  values: [...guard.values, version],
});

/** Acknowledgements for codes actually present (others are ignored and never recorded). */
const recordedAcks = (acks: readonly Acknowledgement[], v: ValidationResult) =>
  acks.filter((a) => v.requiredAcknowledgements.includes(a.code));

/** Errors block; every warning code needs an acknowledgement with a reason (§6.3). */
function assertPublishable(v: ValidationResult, acks: readonly Acknowledgement[]): void {
  if (v.errorCount > 0) validationFailed(v);
  const missing = missingAcknowledgements(v.requiredAcknowledgements, acks);
  if (missing.length > 0) validationFailed(v, missing);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getStudioBuilding(
  db: SqlDatabase,
  id: string,
  ctx: StudioContext,
): Promise<StudioBuildingDetail> {
  return reload(db, ctx, id);
}

function titleOf(ctx: StudioContext, row: StudioBuildingRow, rec: StudioDraft | null): string {
  if (row.targetId !== null) {
    const p = ctx.studio.buildingsById.get(row.targetId)?.properties;
    return p?.name ?? p?.displayName ?? row.targetId;
  }
  return rec?.identity?.name ?? UNNAMED_STUDIO_TITLE;
}

export async function listStudioBuildings(
  db: SqlDatabase,
  query: unknown,
  ctx: StudioContext,
): Promise<StudioBuildingList> {
  const q = parseOrThrow(studioListQuerySchema, query, 'Query');
  let after: { updatedAt: string; id: string } | undefined;
  if (q.cursor !== undefined) {
    const c = decodeCursor(q.cursor);
    if (!c || typeof c[0] !== 'string' || typeof c[1] !== 'string')
      fail('invalid', 'Invalid cursor', { issues: [{ path: 'cursor', message: 'Invalid cursor' }] });
    after = { updatedAt: c[0], id: c[1] };
  }
  const { rows, more } = await listStudioBuildingRows(db, {
    status: q.status,
    targetId: q.targetId,
    q: q.q,
    limit: q.limit,
    after,
  });
  const published = await publishedStudioBuildings(db);
  const items: StudioBuildingSummary[] = [];
  for (const { head, published: pubRecord } of rows) {
    const rec = head.draft !== null ? readDraft(head.draft) : readDraft(pubRecord);
    const raw = head.draft !== null ? head.draft : pubRecord;
    const support = modelSupport(typeof raw === 'object' && raw !== null ? (raw as Json).model : undefined);
    const v = rec
      ? (await runValidation(db, ctx, rec, { recordId: head.id, targetId: head.targetId }, published)).result
      : null;
    items.push({
      id: head.id,
      targetId: head.targetId,
      status: head.status,
      title: titleOf(ctx, head, rec),
      categoryId: rec?.identity?.categoryId ?? null,
      revision: head.revision,
      hasDraft: head.draft !== null,
      publishedVersion: head.publishedVersion,
      updatedAt: head.updatedAt,
      errorCount: v?.errorCount ?? 0,
      warningCount: v?.warningCount ?? 0,
      modelAvailable: support.ok,
    });
  }
  const last = rows.at(-1)?.head;
  return { items, nextCursor: more && last ? encodeCursor(last.updatedAt, last.id) : null };
}

/** POST /studio/validate — dry run against the current base data; nothing is written. */
export async function validateStudioRequest(
  db: SqlDatabase,
  body: unknown,
  ctx: StudioContext,
): Promise<ValidationResult> {
  const raw = typeof body === 'object' && body !== null ? (body as Json).draft : undefined;
  parseDraftForWrite(raw);
  const b = parseOrThrow(validateRequestSchema, body, 'Request');
  const draft = normalizeDraft(b.draft, b.targetId, ctx.studio);
  return (await runValidation(db, ctx, draft, { recordId: b.recordId, targetId: b.targetId })).result;
}

// ---------------------------------------------------------------------------
// Create, save, discard
// ---------------------------------------------------------------------------

/** POST /studio/buildings — a new `stu:` draft (new building, or a model of an existing base building). */
export async function createStudioBuilding(
  db: SqlDatabase,
  body: unknown,
  ctx: StudioContext,
): Promise<StudioBuildingDetail> {
  return audited(db, ctx, target('building.create', null), async (actor) => {
    const raw = typeof body === 'object' && body !== null ? (body as Json).draft : undefined;
    parseDraftForWrite(raw);
    const b = parseOrThrow(createStudioBuildingRequestSchema, body, 'Request');
    if (b.targetId !== null) {
      if (!ctx.studio.buildingsById.has(b.targetId))
        fail('not-found', `${b.targetId} is not a building in the current base dataset.`);
      const existing = await getStudioBuildingByTarget(db, b.targetId);
      if (existing) targetTaken(b.targetId, existing);
    }
    const draft = normalizeDraft(b.draft, b.targetId, ctx.studio);
    const id = studioIds(ctx).next('studio');
    const now = isoNow(ctx);
    const [ins] = await db.batch([
      insertStudioBuildingStmt(db, {
        id,
        targetId: b.targetId,
        draftJson: serializeDraft(draft),
        actor,
        now,
      }),
      auditStmt(
        db,
        buildingAudit(now, actor, 'building.create', id, null, {
          targetId: b.targetId,
          revision: 1,
          draftRevision: 1,
          generatorId: draft.model.generatorId,
          templateRef: draft.templateRef,
        }),
        { sql: GUARD_AFTER_CHANGE },
      ),
    ]);
    if (changes(ins) !== 1) {
      // Lost a race for the same target (UNIQUE target_id): nothing was written.
      const existing = b.targetId === null ? null : await getStudioBuildingByTarget(db, b.targetId);
      return existing && b.targetId !== null
        ? targetTaken(b.targetId, existing)
        : fail('conflict', 'The building could not be created; try again.');
    }
    return reload(db, ctx, id);
  });
}

/** Writes a new draft for `row` (save or apply-template) in one guarded batch. */
async function writeDraft(
  db: SqlDatabase,
  ctx: StudioContext,
  row: StudioBuildingRow,
  draft: StudioDraft,
  action: 'building.save-draft' | 'building.apply-template',
  actor: string,
  extra: Json = {},
): Promise<StudioBuildingDetail> {
  const now = isoNow(ctx);
  const previous = row.draft ?? (await publishedRecordOf(db, row));
  const [audit, upd] = await db.batch([
    auditStmt(
      db,
      buildingAudit(
        now,
        actor,
        action,
        row.id,
        { revision: row.revision, draftRevision: row.draftRevision, hasDraft: row.draft !== null },
        {
          revision: row.revision + 1,
          draftRevision: row.draftRevision + 1,
          changedFields: changedPaths(previous, draft),
          ...extra,
        },
      ),
      {
        sql: "EXISTS (SELECT 1 FROM studio_buildings WHERE id = ? AND revision = ? AND status <> 'archived')",
        values: [row.id, row.revision],
      },
    ),
    saveDraftStmt(db, row.id, row.revision, serializeDraft(draft), actor, now),
  ]);
  if (changes(upd) !== 1 || changes(audit) !== 1) return buildingConflict(db, row.id);
  return reload(db, ctx, row.id);
}

/** PUT /studio/buildings/:id/draft — saved even with validation errors (work is never lost). */
export async function saveStudioDraft(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<StudioBuildingDetail> {
  return audited(db, ctx, target('building.save-draft', id), async (actor) => {
    const raw = typeof body === 'object' && body !== null ? (body as Json).draft : undefined;
    parseDraftForWrite(raw);
    const b = parseOrThrow(saveDraftRequestSchema, body, 'Request');
    const row = await loadForWrite(db, id, b.revision);
    if (row.status === 'archived') archivedTransition();
    return writeDraft(
      db,
      ctx,
      row,
      normalizeDraft(b.draft, row.targetId, ctx.studio),
      'building.save-draft',
      actor,
    );
  });
}

/** DELETE /studio/buildings/:id/draft — back to the published record (never-published drafts: archive instead). */
export async function discardStudioDraft(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<StudioBuildingDetail> {
  return audited(db, ctx, target('building.discard-draft', id), async (actor) => {
    const b = parseOrThrow(revisionRequestSchema, body, 'Request');
    const row = await loadForWrite(db, id, b.revision);
    if (row.status === 'archived') archivedTransition();
    if (row.draft === null) fail('invalid-transition', 'There is no draft to discard.');
    if (row.status !== 'published')
      fail('invalid-transition', 'This building was never published; archive or delete it instead.');
    const now = isoNow(ctx);
    const [audit, upd] = await db.batch([
      auditStmt(
        db,
        buildingAudit(
          now,
          actor,
          'building.discard-draft',
          id,
          { revision: row.revision, draftRevision: row.draftRevision, hasDraft: true },
          { revision: row.revision + 1, hasDraft: false, publishedVersion: row.publishedVersion },
        ),
        {
          sql: "EXISTS (SELECT 1 FROM studio_buildings WHERE id = ? AND revision = ? AND status = 'published' AND draft_json IS NOT NULL)",
          values: [id, row.revision],
        },
      ),
      discardDraftStmt(db, id, row.revision, actor, now),
    ]);
    if (changes(upd) !== 1 || changes(audit) !== 1) return buildingConflict(db, id);
    return reload(db, ctx, id);
  });
}

// ---------------------------------------------------------------------------
// Publish, archive, restore, delete
// ---------------------------------------------------------------------------

/**
 * POST /studio/buildings/:id/publish — one atomic batch: audit + immutable
 * version (server-derived footprint, membership, validation,
 * acknowledgements) + head update + publication bump.
 */
export async function publishStudioBuilding(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<PublishResponse> {
  return audited(db, ctx, target('building.publish', id), async (actor) => {
    const b = parseOrThrow(publishRequestSchema, body, 'Request');
    const row = await loadForWrite(db, id, b.revision);
    if (row.status === 'archived') archivedTransition();
    if (row.draft === null) fail('invalid-transition', 'Nothing to publish: there is no draft.');
    const draft = normalizeDraft(
      readDraft(row.draft) ?? unsupportedStored(row.draft),
      row.targetId,
      ctx.studio,
    );
    const recordJson = serializeDraft(draft);
    // Validated against the published set as of this publication version; the batch requires it unchanged.
    const validatedAt = (await getPublicationState(db)).version;
    const run = await runValidation(db, ctx, draft, { recordId: id, targetId: row.targetId });
    assertPublishable(run.result, b.acknowledgements);
    const version = (row.publishedVersion ?? 0) + 1;
    const membership = run.membership ? membershipFor(run.membership, id, version) : null;
    // The validator (and the safety net) already make these impossible; never publish around them.
    if (!run.footprint.ok || !membership) return validationFailed(run.result);
    const acks = recordedAcks(b.acknowledgements, run.result);
    const now = isoNow(ctx);
    const versionRow = {
      buildingId: id,
      version,
      recordJson,
      footprintJson: JSON.stringify(run.footprint.footprint),
      footprintAreaM2: run.footprint.areaM2,
      membershipJson: JSON.stringify(membership),
      validationJson: JSON.stringify(run.result),
      acknowledgementsJson: JSON.stringify(acks),
      changeSummary: b.changeSummary,
      modelConfigVersion: draft.model.modelConfigVersion,
      generatorId: draft.model.generatorId,
      generatorVersion: draft.model.generatorVersion,
      accuracyClass: await accuracyClassFor(db, ctx, draft),
      positionCorrected: run.footprint.positionCorrected,
      publishedBy: actor,
      publishedAt: now,
    };
    const publicRecord = toPublishedStudioBuilding(
      {
        ...versionRow,
        record: draft,
        footprint: run.footprint.footprint,
        membership,
        validation: run.result,
        acknowledgements: acks,
      },
      row.targetId,
    );
    if (!publicRecord)
      return fail('internal', 'The public record could not be built; nothing was published.');
    const previous = await publishedRecordOf(db, row);
    const moved = JSON.stringify(placement(previous)) !== JSON.stringify(placement(draft));
    const identityChanges = changedPaths(previous?.identity ?? null, draft.identity, 'identity');
    const guard = unchangedPublication(headGuard(id, row.revision), validatedAt);
    const statements: SqlStatement[] = [
      auditStmt(
        db,
        buildingAudit(
          now,
          actor,
          'building.publish',
          id,
          { head: toHead(row), publishedVersion: row.publishedVersion },
          {
            version,
            changeSummary: b.changeSummary,
            acknowledgements: acks,
            move: moved ? { before: placement(previous), after: placement(draft) } : null,
            metadata:
              identityChanges.length > 0
                ? {
                    changedFields: identityChanges,
                    before: previous?.identity ?? null,
                    after: draft.identity,
                  }
                : null,
            verification: { before: previous?.verification.status ?? null, after: draft.verification.status },
            positionCorrection: draft.positionCorrection,
            generator: { id: draft.model.generatorId, version: draft.model.generatorVersion },
            templateRef: draft.templateRef,
            footprintAreaM2: run.footprint.areaM2,
            membership,
          },
          acks.length > 0 ? `Published with ${acks.length} acknowledged warning(s).` : undefined,
        ),
        guard,
      ),
      insertStudioVersionIfStmt(db, versionRow, guard),
      // Only if the version row was just inserted (same guard), so a failed guard changes nothing.
      markPublishedStmt(db, id, row.revision, version, actor, now, { sql: GUARD_AFTER_CHANGE }),
      // Immediately after the head UPDATE, so changes() refers to it.
      bumpPublicationStmt(db, now, { sql: GUARD_AFTER_CHANGE }),
    ];
    const [audit, ins, upd] = await db.batch(statements);
    if (changes(upd) !== 1 || changes(ins) !== 1 || changes(audit) !== 1) return buildingConflict(db, id);
    const [building, state] = await Promise.all([reload(db, ctx, id), getPublicationState(db)]);
    return { building, publicationVersion: state.version };
  });
}

/** POST /studio/buildings/:id/archive — removed from the publication, recoverable. */
export async function archiveStudioBuilding(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<PublishResponse> {
  return audited(db, ctx, target('building.archive', id), async (actor) => {
    const b = parseOrThrow(archiveRequestSchema, body, 'Request');
    const row = await loadForWrite(db, id, b.revision);
    if (row.status === 'archived') fail('invalid-transition', 'This building is already archived.');
    const wasPublic = row.status === 'published';
    const now = isoNow(ctx);
    const [audit, upd] = await db.batch([
      auditStmt(
        db,
        buildingAudit(
          now,
          actor,
          'building.archive',
          id,
          { head: toHead(row) },
          { status: 'archived', reason: b.reason, removedFromPublication: wasPublic },
        ),
        headGuard(id, row.revision, row.status),
      ),
      archiveStmt(db, id, row.revision, b.reason, actor, now),
      ...(wasPublic ? [bumpPublicationStmt(db, now, { sql: GUARD_AFTER_CHANGE })] : []),
    ]);
    if (changes(upd) !== 1 || changes(audit) !== 1) return buildingConflict(db, id);
    const [building, state] = await Promise.all([reload(db, ctx, id), getPublicationState(db)]);
    return { building, publicationVersion: state.version };
  });
}

/**
 * POST /studio/buildings/:id/restore — re-publishes the LAST version (no new
 * version), re-validated against the current base data with the same
 * acknowledgement rules as publish; a never-published record returns to draft.
 */
export async function restoreStudioBuilding(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<PublishResponse> {
  return audited(db, ctx, target('building.restore', id), async (actor) => {
    const b = parseOrThrow(restoreRequestSchema, body, 'Request');
    const row = await loadForWrite(db, id, b.revision);
    if (row.status !== 'archived') fail('invalid-transition', 'Only an archived building can be restored.');
    const now = isoNow(ctx);
    const to = row.publishedVersion === null ? ('draft' as const) : ('published' as const);
    let acks: Acknowledgement[] = [];
    let guard = headGuard(id, row.revision, 'archived');
    if (to === 'published') {
      guard = unchangedPublication(guard, (await getPublicationState(db)).version);
      const v =
        (await getStudioVersionRow(db, id, row.publishedVersion!)) ?? notFound('Published version', id);
      const record = readDraft(v.record) ?? unsupportedStored(v.record);
      const run = await runValidation(db, ctx, record, { recordId: id, targetId: row.targetId });
      assertPublishable(run.result, b.acknowledgements);
      acks = recordedAcks(b.acknowledgements, run.result);
    }
    const [audit, upd] = await db.batch([
      auditStmt(
        db,
        buildingAudit(
          now,
          actor,
          'building.restore',
          id,
          { head: toHead(row) },
          {
            status: to,
            republishedVersion: to === 'published' ? row.publishedVersion : null,
            acknowledgements: acks,
          },
        ),
        guard,
      ),
      // Only if the guarded audit row was written, so a failed guard changes nothing.
      restoreStmt(db, id, row.revision, to, actor, now, { sql: GUARD_AFTER_CHANGE }),
      ...(to === 'published' ? [bumpPublicationStmt(db, now, { sql: GUARD_AFTER_CHANGE })] : []),
    ]);
    if (changes(upd) !== 1 || changes(audit) !== 1) return buildingConflict(db, id);
    const [building, state] = await Promise.all([reload(db, ctx, id), getPublicationState(db)]);
    return { building, publicationVersion: state.version };
  });
}

/** DELETE /studio/buildings/:id — archived only, typed confirmation; the audit keeps the full before-snapshot. */
export async function deleteStudioBuilding(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<DeleteStudioBuildingResponse> {
  return audited(db, ctx, target('building.delete', id), async (actor) => {
    const b = parseOrThrow(deleteStudioBuildingRequestSchema, body, 'Request');
    const row = await loadForWrite(db, id, b.revision);
    if (row.status !== 'archived')
      fail('invalid-transition', 'Only an archived building can be deleted permanently. Archive it first.', {
        details: { current: toHead(row) },
      });
    if (b.confirmId !== id)
      fail('invalid', 'Type the exact id of the building to confirm the permanent deletion.', {
        issues: [{ path: 'confirmId', message: 'Does not match the building id' }],
      });
    const versions = await listStudioVersionRows(db, id);
    const before = { head: toHead(row), draft: row.draft, versions };
    if (JSON.stringify(before).length > DELETE_SNAPSHOT_MAX_BYTES)
      fail(
        'invalid',
        'This building has too much history to keep in one audit snapshot; it was not deleted.',
        {
          status: 422,
        },
      );
    const now = isoNow(ctx);
    const [audit, , del] = await db.batch([
      auditStmt(
        db,
        buildingAudit(
          now,
          actor,
          'building.delete',
          id,
          before,
          null,
          `Permanently deleted with ${versions.length} published version(s); this snapshot is the only copy.`,
        ),
        headGuard(id, row.revision, 'archived'),
      ),
      deleteStudioVersionsStmt(db, id, row.revision),
      deleteStudioBuildingStmt(db, id, row.revision),
    ]);
    if (changes(del) !== 1 || changes(audit) !== 1) return buildingConflict(db, id);
    const auditEventId = Number(audit?.meta.last_row_id ?? 0);
    return { deletedId: id, auditEventId };
  });
}

// ---------------------------------------------------------------------------
// Duplicate, apply template
// ---------------------------------------------------------------------------

/**
 * POST /studio/buildings/:id/duplicate — a new unpublished `stu:` draft (S4):
 * name null, aliases [], verification unverified, no access node, no position
 * correction, visibly offset. The geometry guide is not copied: the copy was
 * not traced from that detection.
 */
export async function duplicateStudioBuilding(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<StudioBuildingDetail> {
  return audited(db, ctx, target('building.duplicate', id), async (actor) => {
    const b = parseOrThrow(duplicateRequestSchema, body, 'Request');
    const row = (await getStudioBuildingRow(db, id)) ?? notFound('Studio building', id);
    const source = await workingRecord(db, row);
    const offset = b.offsetM ?? defaultDuplicateOffsetM(source.model);
    const anchor = createEnuFrame(source.model.anchor).toLngLat([offset.east, offset.north]);
    const { geometryGuide: _notCopied, ...model } = source.model;
    const copy = parseOrThrow(
      studioDraftSchema,
      {
        identity: source.identity ? { ...source.identity, name: null, aliases: [] } : null,
        model: { ...model, anchor: [anchor[0], anchor[1]] },
        verification: { status: 'unverified' },
        accessNodeId: null,
        templateRef: source.templateRef,
        positionCorrection: null,
      },
      'Duplicate',
    );
    const copyId = studioIds(ctx).next('studio');
    const now = isoNow(ctx);
    await db.batch([
      insertStudioBuildingStmt(db, {
        id: copyId,
        targetId: null,
        draftJson: serializeDraft(copy),
        actor,
        now,
      }),
      auditStmt(
        db,
        buildingAudit(now, actor, 'building.duplicate', copyId, null, {
          sourceId: id,
          offsetM: offset,
          revision: 1,
          draftRevision: 1,
        }),
        { sql: GUARD_AFTER_CHANGE },
      ),
      auditStmt(db, buildingAudit(now, actor, 'building.duplicate', id, null, { copyId, offsetM: offset }), {
        sql: 'EXISTS (SELECT 1 FROM studio_buildings WHERE id = ?)',
        values: [copyId],
      }),
    ]);
    return reload(db, ctx, copyId);
  });
}

/**
 * POST /studio/buildings/:id/apply-template — explicit, per instance (S2).
 * `dryRun` previews (draft, changed fields, validation) without writing.
 */
export async function applyStudioTemplate(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<ApplyTemplateResponse> {
  const run = async (b: ApplyTemplateRequest, actor: string | null): Promise<ApplyTemplateResponse> => {
    const row = await loadForWrite(db, id, b.revision);
    if (row.status === 'archived') archivedTransition();
    const template = await resolveTemplateDefinition(db, ctx, b);
    if (!template) {
      if (
        OWNER_TEMPLATE_ID_RE.test(b.templateId) &&
        (await getTemplateVersionRow(db, b.templateId, b.templateVersion))
      )
        fail(
          'unsupported-model',
          `Template ${b.templateId} v${b.templateVersion} cannot be read by this version of the app.`,
        );
      fail('not-found', `Template ${b.templateId} v${b.templateVersion} does not exist.`);
    }
    const before = await workingRecord(db, row);
    const applied = applyTemplateVersion(before, template, b.variantId);
    if (!applied.ok)
      return applied.reason === 'variant-not-found'
        ? fail('not-found', applied.message)
        : fail('unsupported-model', applied.message);
    const draft = normalizeDraft(
      parseOrThrow(studioDraftSchema, applied.draft, 'Draft'),
      row.targetId,
      ctx.studio,
    );
    const { changedFields } = applied;
    const validation = (await runValidation(db, ctx, draft, { recordId: id, targetId: row.targetId })).result;
    if (actor === null) return { draft, changedFields, validation, saved: false, building: null };
    const building = await writeDraft(db, ctx, row, draft, 'building.apply-template', actor, {
      templateRef: { before: before.templateRef, after: draft.templateRef },
      modelChangedFields: changedFields,
    });
    return { draft, changedFields, validation, saved: true, building };
  };
  const parse = () => parseOrThrow(applyTemplateRequestSchema, body, 'Request');
  // A preview writes nothing, so it is not audited; the save (and any rejected save) is.
  if (typeof body === 'object' && body !== null && (body as Json).dryRun === true) return run(parse(), null);
  return audited(db, ctx, target('building.apply-template', id), (actor) => run(parse(), actor));
}
