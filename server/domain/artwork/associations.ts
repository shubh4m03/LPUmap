/**
 * Owner verification of artwork associations
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.2). Signatures were frozen by
 * the contract stage; the bodies implement them.
 *
 * Rules (binding):
 *  - Bodies are parsed with artworkAssociationWriteSchema /
 *    artworkAssociationResetSchema INSIDE `audited(...)` (entity type
 *    'artwork', actions ARTWORK_AUDIT_ACTIONS; the 'artwork.' prefix is what
 *    docs/db/0003_down.sql and a re-applied 0003 rely on), so a refused write
 *    is audited as 'rejected' too.
 *  - 400 for a malformed body; 422 for a well-formed body that breaks a rule
 *    (verified without evidence, approximate without a note, an official
 *    document without a URL, a future evidence date, evidence on an
 *    unresolved link, a building that is not a current campus building —
 *    never guessed); 404 for a subject the manifest does not contain; 409
 *    `conflict` with the current record when expectedRevision is stale
 *    (null = create; an existing row → 409).
 *  - ONE batch per write: the row statement from server/db/artwork-associations.ts,
 *    the success audit row with before/after (guarded by GUARD_AFTER_CHANGE)
 *    and bumpPublicationStmt (same guard), so a stale write leaves no trace.
 *  - DELETE resets to the curated baseline; the audit row keeps the deleted
 *    decision as `before`, so history survives.
 *  - The private note lives only in D1 and the admin views; the publication
 *    never selects it (server/domain/publication.ts).
 */
import { mergeArtworkAssociations } from '../../../src/isometric-art/index.ts';
import type { EffectiveArtworkAssociation } from '../../../src/isometric-art/index.ts';
import { PROHIBITED_SOURCE_MESSAGE } from '../../../src/building-studio/index.ts';
import {
  artworkAssociationResetSchema,
  artworkAssociationWriteSchema,
  type ArtworkAssociationWrite,
  type CuratedAssociation,
  type IsometricArtManifest,
} from '../../../src/isometric-art/index.ts';
import { auditStmt, entityHistory } from '../../db/audit.ts';
import {
  ARTWORK_EVIDENCE_JSON_MAX,
  deleteArtworkAssociationStmt,
  getArtworkAssociationRow,
  insertArtworkAssociationStmt,
  listArtworkAssociationRows,
  toPublishedArtworkAssociation,
  updateArtworkAssociationStmt,
  type ArtworkAssociationRecord,
  type ArtworkAssociationWriteValues,
} from '../../db/artwork-associations.ts';
import { bumpPublicationStmt } from '../../db/meta.ts';
import type { AuditEvent } from '../../db/records.ts';
import { GUARD_AFTER_CHANGE, changes } from '../../db/sql.ts';
import type { SqlDatabase, SqlStatement } from '../../db/types.ts';
import { conflict, fail, notFound, unprocessable, zodIssues } from '../../errors.ts';
import { audited } from '../audited.ts';
import { isoNow, type DomainContext } from '../context.ts';

export const ARTWORK_AUDIT_ACTIONS = { put: 'artwork.put', reset: 'artwork.reset' } as const;

/**
 * Admin routes (paths relative to /api/admin; registered in
 * server/handlers/admin/artwork-routes.ts with auditAs(…, 'artwork', …) and
 * the `subjectId` router parameter validated by ART_SUBJECT_ID_RE).
 *   GET    /artwork/associations              admin:read     → listArtworkAssociations
 *   GET    /artwork/associations/:subjectId   admin:read     → getArtworkAssociation
 *   PUT    /artwork/associations/:subjectId   artwork:verify → putArtworkAssociation   (audit artwork.put)
 *   DELETE /artwork/associations/:subjectId   artwork:verify → resetArtworkAssociation (audit artwork.reset)
 * (`artwork:verify` is granted to the owner role.)
 */
export const ARTWORK_ADMIN_ROUTE_SPECS = [
  { method: 'GET', pattern: '/artwork/associations', permission: 'admin:read' },
  { method: 'GET', pattern: '/artwork/associations/:subjectId', permission: 'admin:read' },
  {
    method: 'PUT',
    pattern: '/artwork/associations/:subjectId',
    permission: 'artwork:verify',
    audit: 'artwork.put',
  },
  {
    method: 'DELETE',
    pattern: '/artwork/associations/:subjectId',
    permission: 'artwork:verify',
    audit: 'artwork.reset',
  },
] as const;

export interface ArtworkDomainContext extends Pick<DomainContext, 'now' | 'actor'> {
  /** The published manifest of this deployment (public/isometric-art/manifest.json via ASSETS). */
  manifest: IsometricArtManifest;
  /** True for a current campus building id (base dataset or published studio building). */
  buildingExists: (buildingId: string) => boolean;
}

export interface ArtworkAssociationAdminView {
  subjectId: string;
  /** Curated registry baseline (null when the registry has none). */
  baseline: CuratedAssociation | null;
  /** The owner's decision, including the PRIVATE note (admin only). */
  decision: ArtworkAssociationRecord | null;
  effective: EffectiveArtworkAssociation;
}

export interface ArtworkAssociationList {
  items: ArtworkAssociationAdminView[];
  /** Orphan decisions and links to missing buildings (mergeArtworkAssociations issues). */
  issues: { subjectId: string; code: string; message: string }[];
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** What an orphan decision (subject no longer in the manifest) shows as: nothing is applied. */
const ORPHAN_EFFECTIVE = (subjectId: string): EffectiveArtworkAssociation => ({
  subjectId,
  status: 'unresolved',
  buildingId: null,
  unconfirmedMatchId: null,
  evidence: [],
  candidateFootprints: [],
  reason:
    'This artwork subject is not in the current illustration registry, so the stored decision is not applied.',
  source: 'default',
  revision: null,
  updatedAt: null,
});

const subjectIdsOf = (m: IsometricArtManifest): string[] => m.subjects.map((s) => s.subjectId);
const knownSubject = (m: IsometricArtManifest, id: string): boolean =>
  m.subjects.some((s) => s.subjectId === id);

function merge(ctx: ArtworkDomainContext, rows: readonly ArtworkAssociationRecord[]) {
  return mergeArtworkAssociations({
    subjectIds: subjectIdsOf(ctx.manifest),
    baseline: ctx.manifest.associations,
    decisions: rows.map(toPublishedArtworkAssociation),
    buildingExists: ctx.buildingExists,
  });
}

function viewOf(
  ctx: ArtworkDomainContext,
  subjectId: string,
  decision: ArtworkAssociationRecord | null,
): ArtworkAssociationAdminView {
  const baseline = ctx.manifest.associations.find((a) => a.subjectId === subjectId) ?? null;
  const effective =
    merge(ctx, decision ? [decision] : []).bySubject.get(subjectId) ?? ORPHAN_EFFECTIVE(subjectId);
  return { subjectId, baseline, decision, effective };
}

export async function listArtworkAssociations(
  db: SqlDatabase,
  ctx: ArtworkDomainContext,
): Promise<ArtworkAssociationList> {
  const rows = await listArtworkAssociationRows(db);
  const merged = merge(ctx, rows);
  const bySubject = new Map(rows.map((r) => [r.subjectId, r]));
  const baseline = new Map(ctx.manifest.associations.map((a) => [a.subjectId, a]));
  const items = subjectIdsOf(ctx.manifest).map((subjectId) => ({
    subjectId,
    baseline: baseline.get(subjectId) ?? null,
    decision: bySubject.get(subjectId) ?? null,
    effective: merged.bySubject.get(subjectId)!,
  }));
  return { items, issues: merged.issues.map((i) => ({ ...i })) };
}

export async function getArtworkAssociation(
  db: SqlDatabase,
  subjectId: string,
  ctx: ArtworkDomainContext,
): Promise<ArtworkAssociationAdminView & { history: AuditEvent[] }> {
  const decision = await getArtworkAssociationRow(db, subjectId);
  // An orphan decision stays viewable (and resettable); an unknown subject without one is 404.
  if (!knownSubject(ctx.manifest, subjectId) && !decision) return notFound('Artwork subject', subjectId);
  const history = await entityHistory(db, 'artwork', subjectId);
  return { ...viewOf(ctx, subjectId, decision), history };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Messages of the shared cross-field association rules (schema.ts
 * `associationRules`). tests/server/artwork/http.test.ts pins that each rule
 * answers 422, so a reworded rule cannot silently turn into a 400.
 */
const ASSOCIATION_RULE_MESSAGES: ReadonlySet<string> = new Set([
  'An unresolved association has no building; a verified or approximate one has exactly one',
  'A verified association needs evidence',
  // A well-formed evidence URL or description that cites Google Maps / Earth / Street View.
  PROHIBITED_SOURCE_MESSAGE,
]);

/**
 * Parses a write body. Shape errors are 400; when the shape is right but a
 * cross-field RULE fails (e.g. verified without evidence) the request is
 * well-formed but unacceptable → 422.
 */
function parseWrite(body: unknown): ArtworkAssociationWrite {
  const r = artworkAssociationWriteSchema.safeParse(body);
  if (r.success) return r.data;
  const issues = zodIssues(r.error);
  // The cross-field association rules (src/isometric-art/schema.ts associationRules) run only on an
  // otherwise valid body, so a failure made only of them is a well-formed body breaking a rule.
  const ruleOnly = r.error.issues.every(
    (i) => i.code === 'custom' && ASSOCIATION_RULE_MESSAGES.has(i.message),
  );
  return fail('invalid', `Artwork association is invalid: ${issues[0]?.path}: ${issues[0]?.message}`, {
    issues,
    ...(ruleOnly ? { status: 422 } : {}),
  });
}

/** Server calendar date (UTC). */
const todayOf = (ctx: Pick<DomainContext, 'now'>): string => ctx.now.toISOString().slice(0, 10);

/**
 * Domain rules on top of the schema (422, one field issue each):
 *  - verified needs evidence (also a schema rule; re-checked here);
 *  - an official document needs its URL;
 *  - evidence dates are real calendar dates, never in the future;
 *  - an unresolved link carries no evidence (there is nothing it proves);
 *  - the stored evidence fits the 0003 CHECK (ARTWORK_EVIDENCE_JSON_MAX);
 *  - approximate needs a (private) note saying why it is only approximate;
 *  - a linked building must be a CURRENT campus building (never guessed).
 */
export function checkArtworkWriteRules(w: ArtworkAssociationWrite, ctx: ArtworkDomainContext): void {
  if (w.status === 'verified' && w.evidence.length === 0)
    unprocessable('evidence', 'A verified association needs at least one piece of evidence.');
  if (w.status === 'unresolved' && w.evidence.length > 0)
    unprocessable('evidence', 'An unresolved association has no building, so it carries no evidence.');
  // The stored array is bounded by the 0003 CHECK (length(evidence_json) <= 8192); ten schema-valid
  // items can exceed it, which must be a 422 here rather than a failed batch (500).
  if (JSON.stringify(w.evidence).length > ARTWORK_EVIDENCE_JSON_MAX)
    unprocessable(
      'evidence',
      `The evidence is too long in total (at most ${ARTWORK_EVIDENCE_JSON_MAX} characters stored); shorten the descriptions or URLs.`,
    );
  const today = todayOf(ctx);
  w.evidence.forEach((e, i) => {
    if (e.kind === 'official-document' && !e.url)
      unprocessable(`evidence.${i}.url`, 'Official-document evidence needs the document URL.');
    const d = new Date(`${e.date}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.date)
      unprocessable(`evidence.${i}.date`, 'Evidence date is not a real calendar date.');
    if (e.date > today) unprocessable(`evidence.${i}.date`, 'Evidence date cannot be in the future.');
  });
  if (w.status === 'approximate' && !w.note)
    unprocessable('note', 'An approximate association needs a note explaining why it is not verified.');
  if (w.buildingId !== null && !ctx.buildingExists(w.buildingId))
    unprocessable(
      'buildingId',
      `${w.buildingId} is not a current campus building (base dataset or published studio building).`,
    );
}

/** Builds the after-image, runs write + audit + publication bump in ONE batch, and checks it applied. */
async function commit(
  db: SqlDatabase,
  subjectId: string,
  current: ArtworkAssociationRecord | null,
  write: SqlStatement,
  after: ArtworkAssociationRecord | null,
  action: string,
  actor: string,
  now: string,
): Promise<void> {
  const [w] = await db.batch([
    write,
    auditStmt(
      db,
      {
        at: now,
        actor,
        action,
        entityType: 'artwork',
        entityId: subjectId,
        before: current,
        after,
        outcome: 'success',
        detail: null,
      },
      { sql: GUARD_AFTER_CHANGE },
    ),
    bumpPublicationStmt(db, now, { sql: GUARD_AFTER_CHANGE }),
  ]);
  if (changes(w) !== 1) conflict('This artwork association', await getArtworkAssociationRow(db, subjectId));
}

/** Body: artworkAssociationWriteSchema (raw; parsed inside the audit wrapper). */
export async function putArtworkAssociation(
  db: SqlDatabase,
  subjectId: string,
  body: unknown,
  ctx: ArtworkDomainContext,
): Promise<ArtworkAssociationAdminView> {
  return audited(
    db,
    ctx,
    { action: ARTWORK_AUDIT_ACTIONS.put, entityType: 'artwork', entityId: subjectId },
    async (actor) => {
      const w = parseWrite(body);
      if (!knownSubject(ctx.manifest, subjectId)) return notFound('Artwork subject', subjectId);
      checkArtworkWriteRules(w, ctx);
      const current = await getArtworkAssociationRow(db, subjectId);
      if (w.expectedRevision === null ? current !== null : current?.revision !== w.expectedRevision)
        return conflict('This artwork association', current);

      const now = isoNow(ctx);
      const values: ArtworkAssociationWriteValues = {
        status: w.status,
        buildingId: w.buildingId,
        evidence: w.evidence,
        note: w.note ?? null,
      };
      const after: ArtworkAssociationRecord = current
        ? { ...current, ...values, updatedBy: actor, updatedAt: now, revision: current.revision + 1 }
        : {
            subjectId,
            ...values,
            createdBy: actor,
            createdAt: now,
            updatedBy: actor,
            updatedAt: now,
            revision: 1,
          };
      const write = current
        ? updateArtworkAssociationStmt(db, subjectId, current.revision, values, actor, now)
        : insertArtworkAssociationStmt(db, subjectId, values, actor, now);
      await commit(db, subjectId, current, write, after, ARTWORK_AUDIT_ACTIONS.put, actor, now);
      return viewOf(ctx, subjectId, after);
    },
  );
}

/** Body: artworkAssociationResetSchema. Deletes the decision; the curated baseline applies again. */
export async function resetArtworkAssociation(
  db: SqlDatabase,
  subjectId: string,
  body: unknown,
  ctx: ArtworkDomainContext,
): Promise<ArtworkAssociationAdminView> {
  return audited(
    db,
    ctx,
    { action: ARTWORK_AUDIT_ACTIONS.reset, entityType: 'artwork', entityId: subjectId },
    async (actor) => {
      const r = artworkAssociationResetSchema.safeParse(body);
      if (!r.success) {
        const issues = zodIssues(r.error);
        fail('invalid', `Reset request is invalid: ${issues[0]?.path}: ${issues[0]?.message}`, { issues });
      }
      const expectedRevision = r.data.expectedRevision;
      const current = await getArtworkAssociationRow(db, subjectId);
      if (!current) {
        if (!knownSubject(ctx.manifest, subjectId)) return notFound('Artwork subject', subjectId);
        return fail(
          'not-found',
          'There is no owner decision for this artwork subject; it already uses the curated baseline.',
        );
      }
      if (current.revision !== expectedRevision) return conflict('This artwork association', current);
      const now = isoNow(ctx);
      await commit(
        db,
        subjectId,
        current,
        deleteArtworkAssociationStmt(db, subjectId, current.revision),
        null,
        ARTWORK_AUDIT_ACTIONS.reset,
        actor,
        now,
      );
      return viewOf(ctx, subjectId, null);
    },
  );
}
