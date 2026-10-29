/**
 * Server-side Building Studio rules shared by every operation: draft parsing
 * (422 'unsupported-model' before the 400 schema check), footprint-prism
 * normalization, the stored footprint (always derived here with the shared
 * studioFootprintFor — a client footprint is never accepted), campus
 * membership at publish, and the validation run: the shared validator plus a
 * small server safety net.
 */
import { createEnuFrame, lngLatToLocalPolygon } from '../../../src/building-studio/index.ts';
import {
  modelSupport,
  studioDraftSchema,
  studioFootprintSchema,
  STUDIO_LIMITS,
  VALIDATION_CODES,
  verificationSchema,
  type PublishedStudioBuilding,
  type StudioDraft,
  type StudioFootprint,
  type StudioMembership,
  type ValidationCode,
  type ValidationIssue,
  type ValidationResult,
} from '../../../src/building-studio/index.ts';
import {
  membershipForPublish,
  polygonCoordsOf,
  studioFootprintFor,
  validationResult,
} from '../../../src/building-studio/editor.ts';
import type { LngLat } from '../../../src/data/index.ts';
import { classifyFootprint, pointOnSurface, type MembershipResult } from '../../../src/geo/index.ts';
import type { StudioBaseData } from '../../base-data.ts';
import { listPublishedStudioVersions } from '../../db/studio-buildings.ts';
import type { SqlDatabase } from '../../db/types.ts';
import { fail, parseOrThrow } from '../../errors.ts';
import { todayOf, type StudioContext, type StudioValidator } from './context.ts';
import { toPublishedStudioBuilding } from './records.ts';
import { sharedValidator } from './shared.ts';
import { resolveTemplateDefinition } from './templates.ts';

// ---------------------------------------------------------------------------
// Parsing and storage
// ---------------------------------------------------------------------------

/**
 * Parses a draft for a WRITE. A model this build cannot generate (unknown
 * modelConfigVersion, generator or generator version) is 422
 * 'unsupported-model' — never silently reinterpreted; anything else that
 * fails the strict schema is 400 'invalid' (nothing stored).
 */
export function parseDraftForWrite(raw: unknown, path = 'draft'): StudioDraft {
  const model =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).model
      : undefined;
  if (model !== undefined) {
    const support = modelSupport(model);
    if (!support.ok && support.reason !== 'invalid-config')
      fail('unsupported-model', support.message, {
        issues: [{ path: `${path}.model`, message: support.message }],
      });
  }
  return parseOrThrow(studioDraftSchema, raw, 'Draft', { prefix: path });
}

const encoder = new TextEncoder();

/** Serialized draft/record for D1 (≤ STUDIO_LIMITS.draftJsonBytes, the 0002 CHECK) or 413. */
export function serializeDraft(draft: StudioDraft): string {
  const json = JSON.stringify(draft);
  if (encoder.encode(json).byteLength > STUDIO_LIMITS.draftJsonBytes)
    fail('too-large', `The draft is larger than ${STUDIO_LIMITS.draftJsonBytes / 1024} KB once stored.`);
  return json;
}

// ---------------------------------------------------------------------------
// Geometry and membership
// ---------------------------------------------------------------------------

/** The base footprint of a target (Polygon only; multi-part base buildings are not modelled). */
export function baseFootprintOf(studio: StudioBaseData, targetId: string | null): LngLat[][] | null {
  if (targetId === null) return null;
  const f = studio.buildingsById.get(targetId);
  return f ? polygonCoordsOf(f.geometry) : null;
}

const cm = (v: number) => Math.max(0.01, Math.round(v * 100) / 100);

/**
 * 'footprint-prism' on a base target: the server overwrites the anchor (base
 * point-on-surface), rotation (0) and width/length (local bounding box) — the
 * footprint itself is the base footprint, so these are informational (§3.2).
 * Any other model is returned unchanged: nothing is ever clamped or moved.
 */
export function normalizeDraft(
  draft: StudioDraft,
  targetId: string | null,
  studio: StudioBaseData,
): StudioDraft {
  if (draft.model.generatorId !== 'footprint-prism') return draft;
  const coords = baseFootprintOf(studio, targetId);
  if (!coords) return draft;
  const anchor = pointOnSurface({ type: 'Polygon', coordinates: coords });
  if (!anchor) return draft;
  const outer = lngLatToLocalPolygon(coords, createEnuFrame(anchor))[0] ?? [];
  if (outer.length < 3) return draft;
  const xs = outer.map((p) => p[0]);
  const ys = outer.map((p) => p[1]);
  return {
    ...draft,
    model: {
      ...draft.model,
      anchor: [anchor[0], anchor[1]],
      rotationDeg: 0,
      widthM: cm(Math.max(...xs) - Math.min(...xs)),
      lengthM: cm(Math.max(...ys) - Math.min(...ys)),
    },
  };
}

export type StoredFootprint =
  | { ok: true; footprint: StudioFootprint; areaM2: number; positionCorrected: boolean }
  | { ok: false; code: 'geometry-invalid' | 'unsupported-model'; message: string };

/**
 * The footprint a published version stores (S5): derived by the shared
 * studioFootprintFor from the model (for 'footprint-prism', the base
 * footprint unchanged), checked against the public footprint schema.
 */
export function storedFootprintOf(
  draft: StudioDraft,
  targetId: string | null,
  studio: StudioBaseData,
): StoredFootprint {
  const fp = studioFootprintFor(draft, targetId, studio.buildings);
  if (!fp.ok)
    return fp.reason === 'generator-not-implemented'
      ? { ok: false, code: 'unsupported-model', message: fp.message }
      : { ok: false, code: 'geometry-invalid', message: fp.message };
  const shape = studioFootprintSchema.safeParse(fp.footprint);
  if (!shape.success || !(fp.areaM2 > 0))
    return {
      ok: false,
      code: 'geometry-invalid',
      message: `The footprint must be a closed polygon with at most ${STUDIO_LIMITS.maxFootprintVertices} vertices and a positive area.`,
    };
  return {
    ok: true,
    footprint: shape.data,
    areaM2: Math.round(fp.areaM2 * 100) / 100,
    positionCorrected: targetId !== null && draft.positionCorrection !== null,
  };
}

/** classifyFootprint on a stored footprint, keyed by the public id (curated decisions match it). */
export function classifyStored(
  footprint: StudioFootprint,
  publicId: string,
  studio: StudioBaseData,
): MembershipResult {
  return classifyFootprint(
    { id: publicId, geometry: footprint },
    studio.boundary,
    studio.reviewSections,
    studio.curatedDecisions,
  );
}

/** Membership stored with version `version` (§6.4; shared rule), or null when it cannot publish. */
export const membershipFor = (
  m: MembershipResult,
  recordId: string,
  version: number,
): StudioMembership | null => membershipForPublish(m, { id: recordId, version });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const pct = (f: number | null) => `${Math.round((f ?? 0) * 1000) / 10}`;

function issue(
  code: ValidationCode,
  message: string,
  path: string | null,
  data: ValidationIssue['data'] = {},
): ValidationIssue {
  return { code, severity: VALIDATION_CODES[code], message: message.slice(0, 500), path, data };
}

/**
 * Server safety net: rules the server never publishes around, even if the
 * shared validator had a gap. Only codes the validator did not already report
 * are added, so a complete validator's result is returned unchanged.
 */
export function safetyNetIssues(
  draft: StudioDraft,
  targetId: string | null,
  fp: StoredFootprint,
  membership: MembershipResult | null,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const support = modelSupport(draft.model);
  if (!support.ok) out.push(issue('unsupported-model', support.message, 'model', { reason: support.reason }));
  if (!fp.ok)
    out.push(
      fp.code === 'unsupported-model'
        ? issue('unsupported-model', fp.message, 'model.generatorId')
        : issue('geometry-invalid', `The derived footprint is not a valid polygon: ${fp.message}`, 'model'),
    );
  if (targetId === null && draft.identity === null)
    out.push(
      issue('identity-required', 'A new building needs a category (the name may stay empty).', 'identity'),
    );
  if (!verificationSchema.safeParse(draft.verification).success)
    out.push(
      issue(
        'verification-evidence',
        draft.verification.status === 'surveyed'
          ? 'Surveyed needs a survey date and a note.'
          : 'Source-backed needs a citation URL, title, access date and a note.',
        'verification',
      ),
    );
  if (membership) {
    const data = { insideFraction: membership.insideFraction ?? 0 };
    if (membership.status === 'outside')
      out.push(
        issue(
          'outside-campus',
          `The footprint is outside the campus boundary (${pct(membership.insideFraction)} % inside). Off-campus buildings are not shown (owner decision 2).`,
          'model.anchor',
          data,
        ),
      );
    else if (membership.status === 'crossing')
      out.push(
        issue(
          'boundary-crossing',
          `The footprint crosses the campus boundary (${pct(membership.insideFraction)} % inside).`,
          'model.anchor',
          data,
        ),
      );
    else if (membership.status === 'uncertain')
      out.push(
        issue('boundary-uncertain', `Campus membership is uncertain: ${membership.reason}`, 'model.anchor', {
          ...data,
          membershipReason: membership.reasonCode,
        }),
      );
  }
  return out;
}

/** Published, non-archived studio buildings in public shape (validator overlap/duplicate input). */
export async function publishedStudioBuildings(db: SqlDatabase): Promise<PublishedStudioBuilding[]> {
  const rows = await listPublishedStudioVersions(db);
  const out: PublishedStudioBuilding[] = [];
  for (const r of rows) {
    const pub = toPublishedStudioBuilding(r.version, r.targetId);
    if (pub) out.push(pub);
  }
  return out;
}

export interface ValidationRun {
  result: ValidationResult;
  footprint: StoredFootprint;
  membership: MembershipResult | null;
}

/** Runs the shared validator + the safety net on `draft` against the CURRENT base data. */
export async function runValidation(
  db: SqlDatabase,
  ctx: StudioContext,
  draft: StudioDraft,
  ids: { recordId: string | null; targetId: string | null },
  published?: readonly PublishedStudioBuilding[],
): Promise<ValidationRun> {
  const validate: StudioValidator = ctx.validate ?? sharedValidator;
  const footprint = storedFootprintOf(draft, ids.targetId, ctx.studio);
  const membership = footprint.ok
    ? classifyStored(footprint.footprint, ids.targetId ?? ids.recordId ?? 'stu:draft', ctx.studio)
    : null;
  const template = draft.templateRef ? await resolveTemplateDefinition(db, ctx, draft.templateRef) : null;
  const validated = validate(draft, {
    base: ctx.studio,
    published: published ?? (await publishedStudioBuildings(db)),
    template,
    recordId: ids.recordId,
    targetId: ids.targetId,
    today: todayOf(ctx),
  });
  const reported = new Set(validated.issues.map((i) => i.code));
  const extra = safetyNetIssues(draft, ids.targetId, footprint, membership).filter(
    (i) => !reported.has(i.code),
  );
  const result = extra.length === 0 ? validated : validationResult([...validated.issues, ...extra]);
  return { result, footprint, membership };
}
