/**
 * Building Studio wire contracts (frozen; docs/BUILDING_STUDIO_DESIGN.md).
 *
 * Shared by the browser app, the admin app and the server (Pages
 * Functions): erasable syntax only, explicit `.ts` imports, no DOM/Node. The
 * server is the only authority: it re-validates every payload with these
 * schemas, derives the footprint itself (any client-sent footprint is
 * ignored) and assigns ids, statuses, versions, actors and timestamps.
 *
 * Two tiers of checks:
 *  - SCHEMA (this file): structure, types, storable envelopes, registries,
 *    cross-field consistency and prohibited sources. Fails → HTTP 400 and
 *    nothing is stored. Write schemas reject unknown keys.
 *  - VALIDATION (src/building-studio/validate.ts, studio-core): publish rules
 *    with codes and severities (VALIDATION_CODES). A draft may be saved with
 *    validation errors so work is not lost; publishing needs zero errors and
 *    an acknowledgement + reason for every warning code.
 *
 * Read schemas for public data (PublishedStudioBuilding) strip unknown keys
 * so an older client keeps working when a newer server adds fields, and keep
 * an unknown model config as an opaque envelope (rendered as a plain prism,
 * never dropped).
 */
import { z } from 'zod';
import { CATEGORIES } from '../config/index.ts';
import {
  DETECTION_ID_RE,
  lngLatSchema,
  membershipDecisionSchema,
  membershipReasonCodeSchema,
} from '../data/index.ts';
import {
  isHttpUrl,
  isProhibitedSourceUrl,
  line,
  nameLine,
  PROHIBITED_SOURCE_MESSAGE,
  provenanceLine,
  provenanceText,
} from './text.ts';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** New studio building: `stu:` + 20–32 lower-case RFC 4648 base32 characters (server-generated). */
export const STUDIO_ID_RE = /^stu:[a-z2-7]{20,32}$/;
/** Owner template (D1, versioned): `stv:` + 20–32 base32 characters (server-generated). */
export const OWNER_TEMPLATE_ID_RE = /^stv:[a-z2-7]{20,32}$/;
/** Code template in src/building-studio/asset-library.ts, and variant ids: kebab-case. */
export const CODE_TEMPLATE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Base (snapshot) building ids a studio record may target: OSM ways/relations and curated ids. */
export const BASE_BUILDING_ID_RE = /^(?:osm:(?:way|relation)\/[1-9]\d{0,15}|cur:[a-z0-9][a-z0-9._-]{0,80})$/;

export const studioIdSchema = z.string().regex(STUDIO_ID_RE, 'Invalid studio building id');
export const ownerTemplateIdSchema = z.string().regex(OWNER_TEMPLATE_ID_RE, 'Invalid owner template id');
export const codeTemplateIdSchema = z.string().max(48).regex(CODE_TEMPLATE_ID_RE, 'Invalid template id');
export const templateIdSchema = z.union([codeTemplateIdSchema, ownerTemplateIdSchema]);
export const variantIdSchema = z.string().max(48).regex(CODE_TEMPLATE_ID_RE, 'Invalid variant id');
export const baseBuildingIdSchema = z.string().regex(BASE_BUILDING_ID_RE, 'Invalid base building id');

/** The id a building has everywhere in the app (URL, favourites, search, directory, every view mode). */
export const studioPublicId = (b: { id: string; targetId: string | null }): string => b.targetId ?? b.id;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const STUDIO_LIMITS = {
  name: { min: 2, max: 120 },
  alias: { min: 1, max: 80 },
  maxAliases: 10,
  subtype: 60,
  description: 500,
  /** Private owner notes (never published). */
  notes: 2000,
  verificationNote: { min: 10, max: 1000 },
  citationTitle: { min: 2, max: 200 },
  url: 500,
  ackReason: { min: 5, max: 300 },
  changeSummary: { min: 3, max: 500 },
  archiveReason: 500,
  correctionReason: { min: 10, max: 300 },
  templateName: { min: 2, max: 80 },
  intendedUse: 300,
  maxAcknowledgements: 16,
  maxVariants: 8,
  /** Request body cap for every studio admin endpoint (same as LIMITS.adminBodyBytes). */
  bodyBytes: 32 * 1024,
  /** Serialized size caps enforced by the server and by migration 0002 CHECKs. */
  draftJsonBytes: 16 * 1024,
  templateJsonBytes: 16 * 1024,
  versionJsonBytes: 64 * 1024,
  maxFootprintVertices: 256,
  maxFootprintRings: 8,
  /**
   * PUBLISH ranges (validation code 'dimension-out-of-range'; a draft may hold
   * other values inside the storable envelope below). Metres unless noted.
   */
  dims: {
    widthM: { min: 2, max: 300 },
    lengthM: { min: 2, max: 300 },
    heightM: { min: 2.4, max: 150 },
    floors: { min: 1, max: 40 },
    floorHeightM: { min: 2.4, max: 8 },
    baseOffsetM: { min: 0, max: 30 },
    pitchDeg: { min: 5, max: 45 },
  },
  /** Storable envelope (schema level): anything outside is rejected with 400, even in a draft. */
  storable: { maxMetres: 5000, maxFloors: 400 },
  duplicateOffsetM: { max: 200 },
} as const;

/** Publish-time thresholds used by the validator (studio-core) and the server. */
export const STUDIO_VALIDATION = {
  /** An overlap is reported when the shared area is ≥ overlapMinM2 AND ≥ overlapMinFraction of the smaller footprint. */
  overlapMinM2: 1,
  overlapMinFraction: 0.05,
  /** Intersection over union at or above this → 'possible-duplicate'. */
  duplicateIoU: 0.5,
  /** Base-building target with a generated footprint: IoU with the base footprint below this → 'base-fit-mismatch'. */
  baseFitMinIoU: 0.85,
  /** Paths and entrances within this distance are listed (info), never connected. */
  nearbyM: 30,
  /** 'height-floors-conflict' when |floors × floorHeightM − heightM| > max(absM, floorFraction × floorHeightM). */
  heightTolerance: { absM: 1, floorFraction: 0.5 },
} as const;

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const COLOUR_RE = /^#[0-9a-f]{6}$/;
/** Appearance colour: `#rrggbb`, lower-case hex. Appearance only — never a claim about the real building. */
export const colourSchema = z.string().regex(COLOUR_RE, 'Colour must be #rrggbb (lower-case hex)');

const isCalendarDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine(isCalendarDate, 'Not a calendar date');
export const isoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, 'Timestamp must be ISO-8601 UTC');

const revision = z.number().int().positive();
const metres = z.number().positive().max(STUDIO_LIMITS.storable.maxMetres);
const fraction = (min: number, max: number) => z.number().min(min).max(max);

/** Empty or whitespace-only strings become null (form fields), then the schema applies. */
const blankToNull = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable());

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Categories a studio building may take: the registry minus the 'other'
 * placeholder. 'building' stays allowed and is shown as "Use not recorded".
 */
export const STUDIO_CATEGORY_IDS: readonly string[] = CATEGORIES.filter((c) => c.id !== 'other').map(
  (c) => c.id,
);
export const studioCategoryIdSchema = z
  .string()
  .refine((id) => STUDIO_CATEGORY_IDS.includes(id), { message: 'Unknown category' });

// ---------------------------------------------------------------------------
// Generators (versioned code; a version is never removed while any record uses it)
// ---------------------------------------------------------------------------

export const GENERATOR_IDS = [
  'box',
  'l-shape',
  'u-shape',
  'hall',
  'tower-podium',
  'kiosk-canopy',
  'stepped',
  /** Extrudes the authoritative base footprint of the targeted base building (base targets only). */
  'footprint-prism',
] as const;
export type GeneratorId = (typeof GENERATOR_IDS)[number];
export const generatorIdSchema = z.enum(GENERATOR_IDS);

export const ROOF_SHAPES = ['flat', 'shed', 'gable', 'hip', 'stepped'] as const;
export type RoofShape = (typeof ROOF_SHAPES)[number];
export const roofShapeSchema = z.enum(ROOF_SHAPES);
/** Roof shapes that need `pitchDeg`. */
export const PITCHED_ROOFS: readonly RoofShape[] = ['shed', 'gable', 'hip'];

export interface GeneratorInfo {
  label: string;
  /** Released versions, ascending. Never remove one that a stored record references. */
  versions: readonly number[];
  /** Roof shapes this generator can build (S14: only the valid ones are offered). */
  roofs: readonly RoofShape[];
}

export const GENERATORS: Readonly<Record<GeneratorId, GeneratorInfo>> = {
  box: { label: 'Box', versions: [1], roofs: ['flat', 'shed', 'gable', 'hip'] },
  'l-shape': { label: 'L-shape', versions: [1], roofs: ['flat'] },
  'u-shape': { label: 'U-shape / courtyard', versions: [1], roofs: ['flat'] },
  hall: { label: 'Hall', versions: [1], roofs: ['flat', 'shed', 'gable'] },
  'tower-podium': { label: 'Tower on podium', versions: [1], roofs: ['flat'] },
  'kiosk-canopy': { label: 'Kiosk with canopy', versions: [1], roofs: ['flat', 'shed'] },
  stepped: { label: 'Stepped', versions: [1], roofs: ['stepped'] },
  'footprint-prism': { label: 'Existing footprint', versions: [1], roofs: ['flat'] },
};

export const MODEL_CONFIG_VERSIONS = [1] as const;

/** Model-local sides: front = outward normal +y (north at rotationDeg 0), right = +x (east at 0). */
export const SIDES = ['front', 'back', 'left', 'right'] as const;
export const sideSchema = z.enum(SIDES);

// ---------------------------------------------------------------------------
// ModelConfigV1 (an instance stores the FULL resolved config; templates never change it)
// ---------------------------------------------------------------------------

export const shapeParamsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('box') }),
  z.strictObject({
    kind: z.literal('l-shape'),
    /** Size of the rectangular notch cut from one corner, as fractions of width / length. */
    notchWidthFrac: fraction(0.2, 0.8),
    notchLengthFrac: fraction(0.2, 0.8),
    notchCorner: z.enum(['front-left', 'front-right', 'back-left', 'back-right']),
  }),
  z.strictObject({
    kind: z.literal('u-shape'),
    courtyardWidthFrac: fraction(0.2, 0.8),
    courtyardDepthFrac: fraction(0.2, 0.8),
    /** 'none' = closed courtyard (footprint with one hole). */
    openSide: z.enum(['front', 'back', 'left', 'right', 'none']),
  }),
  z.strictObject({ kind: z.literal('hall') }),
  z.strictObject({
    kind: z.literal('tower-podium'),
    podiumFloors: z.number().int().min(1).max(6),
    towerWidthFrac: fraction(0.25, 0.9),
    towerLengthFrac: fraction(0.25, 0.9),
  }),
  z.strictObject({
    kind: z.literal('kiosk-canopy'),
    /** Share of the length covered by the open canopy (the footprint is the whole roofed extent). */
    canopyDepthFrac: fraction(0.1, 0.6),
    canopySide: sideSchema,
  }),
  z.strictObject({
    kind: z.literal('stepped'),
    tiers: z.number().int().min(2).max(5),
    /** Horizontal setback per tier on every side, metres. */
    setbackM: z.number().min(0.5).max(20),
  }),
  z.strictObject({ kind: z.literal('footprint-prism') }),
]);

export const ROOF_MATERIALS = ['concrete', 'metal', 'tile', 'membrane', 'gravel', 'green'] as const;
export const roofSchema = z
  .strictObject({
    shape: roofShapeSchema,
    /** Required for shed/gable/hip; absent for flat/stepped. Publish range STUDIO_LIMITS.dims.pitchDeg. */
    pitchDeg: z.number().gt(0).lt(90).optional(),
    colour: colourSchema,
    material: z.enum(ROOF_MATERIALS),
  })
  .superRefine((r, ctx) => {
    const pitched = PITCHED_ROOFS.includes(r.shape);
    if (pitched && r.pitchDeg === undefined)
      ctx.addIssue({ code: 'custom', path: ['pitchDeg'], message: `A ${r.shape} roof needs pitchDeg` });
    if (!pitched && r.pitchDeg !== undefined)
      ctx.addIssue({ code: 'custom', path: ['pitchDeg'], message: `A ${r.shape} roof has no pitch` });
  });

export const FACADE_MATERIALS = ['plaster', 'brick', 'concrete', 'stone', 'glass', 'metal'] as const;
export const WINDOW_PATTERNS = ['none', 'ribbon', 'punched', 'grid', 'curtain'] as const;
export const windowPatternSchema = z.enum(WINDOW_PATTERNS);
export type WindowPattern = (typeof WINDOW_PATTERNS)[number];
export const facadeSchema = z
  .strictObject({
    material: z.enum(FACADE_MATERIALS),
    wallColour: colourSchema,
    windowPattern: windowPatternSchema,
    /** 0–1 share of the wall the window pattern fills; exactly 0 iff the pattern is 'none'. */
    windowDensity: z.number().min(0).max(1),
    balconies: z.boolean(),
    /** Visual entrance marker only. Never a routing connection (S7). */
    entranceSide: z.enum(['front', 'back', 'left', 'right', 'none']),
  })
  .superRefine((f, ctx) => {
    if ((f.windowPattern === 'none') !== (f.windowDensity === 0))
      ctx.addIssue({
        code: 'custom',
        path: ['windowDensity'],
        message: "windowDensity is 0 exactly when windowPattern is 'none'",
      });
  });

export const DETAIL_LEVELS = ['massing', 'roof', 'facade', 'details'] as const;
export const detailLevelSchema = z.enum(DETAIL_LEVELS);

export const geometryGuideSchema = z.strictObject({
  /** Machine-detected footprint used as an optional trace guide (stays 'unverified' until confirmed). */
  detectionId: z.string().regex(DETECTION_ID_RE, 'Invalid detection id'),
});

/** Fields of a model that a template defines (everything except placement). */
const modelBodyShape = {
  generatorId: generatorIdSchema,
  generatorVersion: z.number().int().positive(),
  widthM: metres,
  lengthM: metres,
  /** Body (wall) height from the body base to the eaves/flat roof, metres. A pitched roof rises above it. */
  heightM: metres,
  floors: z.number().int().min(1).max(STUDIO_LIMITS.storable.maxFloors),
  floorHeightM: metres,
  /** Height of the body base above ground (0 on the ground; > 0 for raised structures). */
  baseOffsetM: z.number().min(0).max(STUDIO_LIMITS.storable.maxMetres),
  shape: shapeParamsSchema,
  roof: roofSchema,
  facade: facadeSchema,
  detailLevel: detailLevelSchema,
};

type ModelBody = {
  generatorId: GeneratorId;
  generatorVersion: number;
  shape: { kind: string };
  roof: { shape: RoofShape };
};

function refineModelBody(m: ModelBody, ctx: z.RefinementCtx): void {
  const g = GENERATORS[m.generatorId];
  if (!g.versions.includes(m.generatorVersion))
    ctx.addIssue({
      code: 'custom',
      path: ['generatorVersion'],
      message: `Unknown ${m.generatorId} generator version ${m.generatorVersion}`,
    });
  if (m.shape.kind !== m.generatorId)
    ctx.addIssue({
      code: 'custom',
      path: ['shape', 'kind'],
      message: `shape.kind must equal generatorId '${m.generatorId}'`,
    });
  if (!g.roofs.includes(m.roof.shape))
    ctx.addIssue({
      code: 'custom',
      path: ['roof', 'shape'],
      message: `The ${g.label} generator cannot build a ${m.roof.shape} roof (allowed: ${g.roofs.join(', ')})`,
    });
}

/**
 * The full resolved model of one building (S2). Placement: `anchor` is the
 * footprint centre [lon, lat]; `rotationDeg` is clockwise from north;
 * width runs along model-local x (east at 0°), length along local y (north
 * at 0°). For 'footprint-prism' the server overwrites anchor/rotation/width/
 * length with values derived from the base footprint (informational).
 */
export const modelConfigV1Schema = z
  .strictObject({
    modelConfigVersion: z.literal(1),
    anchor: lngLatSchema,
    rotationDeg: z.number().min(0).lt(360),
    ...modelBodyShape,
    geometryGuide: geometryGuideSchema.optional(),
  })
  .superRefine(refineModelBody);

/** Template defaults: a model without placement (anchor, rotation, geometry guide). */
export const modelDefaultsSchema = z.strictObject(modelBodyShape).superRefine(refineModelBody);

/**
 * Opaque envelope for READING a published model: never drops a record whose
 * modelConfigVersion / generator / version this client does not know. The
 * renderer then draws the published footprint × body height as a plain prism
 * (see modelSupport) and the admin quality view flags "model unavailable".
 */
export const modelEnvelopeSchema = z.looseObject({
  modelConfigVersion: z.number().int().positive(),
  generatorId: z.string().min(1).max(64),
  generatorVersion: z.number().int().positive(),
  heightM: z.number().positive(),
  baseOffsetM: z.number().nonnegative(),
});

export type ModelSupport =
  | { ok: true; config: ModelConfigV1 }
  | {
      ok: false;
      reason:
        'unknown-model-config-version' | 'unknown-generator' | 'unknown-generator-version' | 'invalid-config';
      message: string;
    };

/** Whether this build can generate the model. Writes with ok=false are rejected (422 'unsupported-model'). */
export function modelSupport(model: unknown): ModelSupport {
  const env = modelEnvelopeSchema.safeParse(model);
  if (!env.success) return { ok: false, reason: 'invalid-config', message: 'Model config is malformed.' };
  const { modelConfigVersion: v, generatorId, generatorVersion } = env.data;
  if (!(MODEL_CONFIG_VERSIONS as readonly number[]).includes(v))
    return {
      ok: false,
      reason: 'unknown-model-config-version',
      message: `Model config version ${v} is not supported by this version of the app.`,
    };
  if (!(GENERATOR_IDS as readonly string[]).includes(generatorId))
    return { ok: false, reason: 'unknown-generator', message: `Unknown generator '${generatorId}'.` };
  if (!GENERATORS[generatorId as GeneratorId].versions.includes(generatorVersion))
    return {
      ok: false,
      reason: 'unknown-generator-version',
      message: `Generator '${generatorId}' version ${generatorVersion} is not available.`,
    };
  const parsed = modelConfigV1Schema.safeParse(model);
  if (!parsed.success)
    return { ok: false, reason: 'invalid-config', message: 'Model config does not match ModelConfigV1.' };
  return { ok: true, config: parsed.data };
}

// ---------------------------------------------------------------------------
// Identity (new `stu:` buildings only; base buildings keep their identity in place overrides)
// ---------------------------------------------------------------------------

const aliasesSchema = z
  .array(nameLine(STUDIO_LIMITS.alias.max).pipe(z.string().min(STUDIO_LIMITS.alias.min)))
  .max(STUDIO_LIMITS.maxAliases)
  .refine((a) => new Set(a.map((s) => s.toLocaleLowerCase('en'))).size === a.length, {
    message: 'Aliases must be unique',
  });

export const studioIdentitySchema = z.strictObject({
  /** null = no name. Never invent one; the UI shows an honest label instead. */
  name: blankToNull(nameLine(STUDIO_LIMITS.name.max).pipe(z.string().min(STUDIO_LIMITS.name.min))),
  aliases: aliasesSchema,
  categoryId: studioCategoryIdSchema,
  subtype: blankToNull(line(STUDIO_LIMITS.subtype)),
  /** Public free text that can cite a source: the prohibited-source rule applies (S6). */
  description: blankToNull(provenanceText(STUDIO_LIMITS.description)),
  /** PRIVATE owner notes: never published, never in the public payload. Can cite sources, so S6 applies. */
  notes: blankToNull(provenanceText(STUDIO_LIMITS.notes)),
  /** false → drawn and selectable on the map, but not listed in the directory or search. */
  directoryVisible: z.boolean(),
});

/** Public identity (read): no private notes. */
export const publicStudioIdentitySchema = z.object({
  name: z.string().min(1).nullable(),
  aliases: z.array(z.string().min(1)),
  categoryId: z.string().min(1),
  subtype: z.string().min(1).nullable(),
  description: z.string().nullable(),
  directoryVisible: z.boolean(),
});

// ---------------------------------------------------------------------------
// Verification (S3). Google Maps / Earth / Street View are never a source (S6).
// ---------------------------------------------------------------------------

export const VERIFICATION_STATUSES = ['unverified', 'source-backed', 'surveyed'] as const;
export const studioVerificationStatusSchema = z.enum(VERIFICATION_STATUSES);

/** An evidence URL: http(s), no credentials, not a Google Maps/Earth/Street View URL. Empty allowed in drafts. */
const draftEvidenceUrl = z
  .string()
  .trim()
  .max(STUDIO_LIMITS.url)
  .refine((s) => s === '' || isHttpUrl(s), { message: 'Must be an http(s) URL' })
  .refine((s) => !isProhibitedSourceUrl(s), { message: PROHIBITED_SOURCE_MESSAGE });
const draftDate = z.union([z.literal(''), isoDateSchema]);

/**
 * Verification as stored in a DRAFT: evidence may still be incomplete (the
 * validator reports 'verification-evidence', which blocks publishing).
 * Prohibited sources are rejected even in a draft.
 */
export const verificationDraftSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unverified') }),
  z.strictObject({
    status: z.literal('source-backed'),
    citation: z.strictObject({
      url: draftEvidenceUrl,
      title: provenanceLine(STUDIO_LIMITS.citationTitle.max),
      accessedOn: draftDate,
    }),
    note: provenanceText(STUDIO_LIMITS.verificationNote.max),
  }),
  z.strictObject({
    status: z.literal('surveyed'),
    surveyDate: draftDate,
    note: provenanceText(STUDIO_LIMITS.verificationNote.max),
  }),
]);

const evidenceUrl = draftEvidenceUrl.pipe(z.string().min(1, 'An evidence URL is required'));
const note = provenanceText(STUDIO_LIMITS.verificationNote.max).pipe(
  z.string().min(STUDIO_LIMITS.verificationNote.min, 'Explain the evidence (at least 10 characters)'),
);

/** Complete verification (required to publish; the public shape). Dates must not be in the future (validator). */
export const verificationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unverified') }),
  z.object({
    status: z.literal('source-backed'),
    citation: z.object({
      url: evidenceUrl,
      title: provenanceLine(STUDIO_LIMITS.citationTitle.max).pipe(
        z.string().min(STUDIO_LIMITS.citationTitle.min),
      ),
      accessedOn: isoDateSchema,
    }),
    note,
  }),
  z.object({ status: z.literal('surveyed'), surveyDate: isoDateSchema, note }),
]);

/** Public label per verification status (S3). Appearance is always labelled "appearance only". */
export const VERIFICATION_LABELS: Readonly<Record<z.infer<typeof studioVerificationStatusSchema>, string>> = {
  unverified: 'Illustrative model placed by the site owner — not verified',
  'source-backed': 'Model placed by the site owner from a cited source',
  surveyed: 'Model placed by the site owner from a site survey',
};
export const APPEARANCE_LABEL = 'Colours and materials are appearance only';

// ---------------------------------------------------------------------------
// Templates (code templates in asset-library.ts; owner templates in D1)
// ---------------------------------------------------------------------------

/** The 17 library types from the owner's list (S14). */
export const LIBRARY_CATEGORIES = [
  'academic-block',
  'lecture-hall',
  'lab-research',
  'hostel-multistorey',
  'residential',
  'canteen-kiosk',
  'retail-service',
  'administrative',
  'library',
  'auditorium',
  'sports-facility',
  'parking-structure',
  'utility',
  'small-single-storey',
  'generic-low-rise',
  'generic-mid-rise',
  'generic-high-rise',
] as const;
export const libraryCategorySchema = z.enum(LIBRARY_CATEGORIES);

export const ACCURACY_CLASSES = ['generic-prefab', 'stylized', 'source-backed', 'surveyed'] as const;
export const accuracyClassSchema = z.enum(ACCURACY_CLASSES);
export const RENDER_COSTS = ['low', 'medium', 'high'] as const;
export const renderCostSchema = z.enum(RENDER_COSTS);

const rangeSchema = (int = false) =>
  z
    .strictObject({ min: int ? z.number().int() : z.number(), max: int ? z.number().int() : z.number() })
    .refine((r) => r.min <= r.max, { message: 'min must not exceed max' });

/** Allowed options of a template (guidance: placing outside them is a warning, never an auto-fix). */
export const templateConstraintsSchema = z.strictObject({
  widthM: rangeSchema(),
  lengthM: rangeSchema(),
  heightM: rangeSchema(),
  floors: rangeSchema(true),
  roofShapes: z.array(roofShapeSchema).min(1),
  windowPatterns: z.array(windowPatternSchema).min(1),
  balconiesAllowed: z.boolean(),
});

export const templateVariantSchema = z.strictObject({
  id: variantIdSchema,
  name: nameLine(STUDIO_LIMITS.templateName.max).pipe(z.string().min(STUDIO_LIMITS.templateName.min)),
  description: blankToNull(provenanceText(STUDIO_LIMITS.intendedUse)),
  defaults: modelDefaultsSchema,
});

const templateBodyShape = {
  name: nameLine(STUDIO_LIMITS.templateName.max).pipe(z.string().min(STUDIO_LIMITS.templateName.min)),
  libraryCategory: libraryCategorySchema,
  intendedUse: provenanceLine(STUDIO_LIMITS.intendedUse).pipe(z.string().min(3)),
  suggestedCategoryId: studioCategoryIdSchema,
  generatorId: generatorIdSchema,
  generatorVersion: z.number().int().positive(),
  constraints: templateConstraintsSchema,
  /** First variant = the default. At least two visually distinct variants for the major types (S14). */
  variants: z.array(templateVariantSchema).min(1).max(STUDIO_LIMITS.maxVariants),
};

type TemplateBody = {
  generatorId: GeneratorId;
  generatorVersion: number;
  constraints: z.infer<typeof templateConstraintsSchema>;
  variants: z.infer<typeof templateVariantSchema>[];
};

function refineTemplateBody(t: TemplateBody, ctx: z.RefinementCtx): void {
  const g = GENERATORS[t.generatorId];
  if (!g.versions.includes(t.generatorVersion))
    ctx.addIssue({ code: 'custom', path: ['generatorVersion'], message: 'Unknown generator version' });
  for (const r of t.constraints.roofShapes)
    if (!g.roofs.includes(r))
      ctx.addIssue({
        code: 'custom',
        path: ['constraints', 'roofShapes'],
        message: `The ${g.label} generator cannot build a ${r} roof`,
      });
  const ids = new Set<string>();
  t.variants.forEach((v, i) => {
    const at = (...p: (string | number)[]) => ['variants', i, ...p];
    if (ids.has(v.id)) ctx.addIssue({ code: 'custom', path: at('id'), message: 'Duplicate variant id' });
    ids.add(v.id);
    const d = v.defaults;
    if (d.generatorId !== t.generatorId || d.generatorVersion !== t.generatorVersion)
      ctx.addIssue({
        code: 'custom',
        path: at('defaults', 'generatorId'),
        message: "A variant uses its template's generator and version",
      });
    const c = t.constraints;
    for (const k of ['widthM', 'lengthM', 'heightM', 'floors'] as const)
      if (d[k] < c[k].min || d[k] > c[k].max)
        ctx.addIssue({
          code: 'custom',
          path: at('defaults', k),
          message: `${k} outside the template's range`,
        });
    if (!c.roofShapes.includes(d.roof.shape))
      ctx.addIssue({ code: 'custom', path: at('defaults', 'roof', 'shape'), message: 'Roof not allowed' });
    if (!c.windowPatterns.includes(d.facade.windowPattern))
      ctx.addIssue({
        code: 'custom',
        path: at('defaults', 'facade', 'windowPattern'),
        message: 'Window pattern not allowed',
      });
    if (d.facade.balconies && !c.balconiesAllowed)
      ctx.addIssue({
        code: 'custom',
        path: at('defaults', 'facade', 'balconies'),
        message: 'Balconies not allowed',
      });
  });
}

/**
 * One immutable template version. Thumbnails are not stored: they are
 * deterministic SVGs generated from the default variant's mesh.
 */
export const templateDefinitionSchema = z
  .strictObject({
    id: templateIdSchema,
    version: z.number().int().positive(),
    ...templateBodyShape,
    accuracyClass: accuracyClassSchema,
    /** Derived from the mesh face count of the heaviest variant (studio-core): < 60 low, < 250 medium, else high. */
    renderCost: renderCostSchema,
  })
  .superRefine(refineTemplateBody);

/** Owner template input (create / new version). The server assigns id, version and renderCost. */
export const ownerTemplateInputSchema = z
  .strictObject({
    ...templateBodyShape,
    /** Owner templates are never presented as evidence-backed. */
    accuracyClass: z.enum(['generic-prefab', 'stylized']),
    /** The code template this one was derived from, if any (provenance only). */
    basedOn: z
      .strictObject({ templateId: codeTemplateIdSchema, templateVersion: z.number().int().positive() })
      .nullable(),
  })
  .superRefine(refineTemplateBody);

/** Which template version + variant an instance was resolved from (provenance; never re-applied silently). */
export const templateRefSchema = z.strictObject({
  templateId: templateIdSchema,
  templateVersion: z.number().int().positive(),
  variantId: variantIdSchema,
});

// ---------------------------------------------------------------------------
// Draft (the editable record) and the publish-time snapshot
// ---------------------------------------------------------------------------

export const positionCorrectionSchema = z.strictObject({
  /** Why the base footprint is wrong (S5). Stored with the version and audited. */
  reason: provenanceLine(STUDIO_LIMITS.correctionReason.max).pipe(
    z.string().min(STUDIO_LIMITS.correctionReason.min),
  ),
});

/**
 * The editable record. Record kind decides which fields apply (validator
 * code 'not-applicable' / 'identity-required'):
 *  - new building (targetId null): identity required; accessNodeId optional;
 *    positionCorrection null; generator ≠ 'footprint-prism'.
 *  - base-building model (targetId set): identity null (name/category/
 *    description/access live in the place override); accessNodeId null;
 *    'footprint-prism' unless positionCorrection is set.
 */
export const studioDraftSchema = z.strictObject({
  identity: studioIdentitySchema.nullable(),
  model: modelConfigV1Schema,
  verification: verificationDraftSchema,
  /** Owner-chosen routing node (S7); validated server-side, never inferred. */
  accessNodeId: z.number().int().nonnegative().nullable(),
  templateRef: templateRefSchema.nullable(),
  positionCorrection: positionCorrectionSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Validation issues and acknowledgements
// ---------------------------------------------------------------------------

export const SEVERITIES = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Every validation code and its fixed severity (docs/BUILDING_STUDIO_DESIGN.md §6 has messages and fixes). */
export const VALIDATION_CODES = {
  'geometry-invalid': 'error',
  'dimension-out-of-range': 'error',
  'outside-max-bounds': 'error',
  'outside-campus': 'error',
  'unknown-category': 'error',
  'identity-required': 'error',
  'not-applicable': 'error',
  'verification-evidence': 'error',
  'unsupported-model': 'error',
  'access-node-invalid': 'error',
  'base-target-missing': 'error',
  'base-fit-mismatch': 'error',
  'boundary-crossing': 'warning',
  'boundary-uncertain': 'warning',
  'overlap-base-building': 'warning',
  'overlap-studio-building': 'warning',
  'possible-duplicate': 'warning',
  'height-floors-conflict': 'warning',
  'outside-template-range': 'warning',
  'base-footprint-replaced': 'warning',
  'nearby-path': 'info',
  'nearby-entrance': 'info',
  'geometry-guide': 'info',
  'not-routable': 'info',
} as const satisfies Record<string, Severity>;

export type ValidationCode = keyof typeof VALIDATION_CODES;
export type WarningCode = {
  [K in ValidationCode]: (typeof VALIDATION_CODES)[K] extends 'warning' ? K : never;
}[ValidationCode];

export const VALIDATION_CODE_LIST = Object.keys(VALIDATION_CODES) as [ValidationCode, ...ValidationCode[]];
export const WARNING_CODES = VALIDATION_CODE_LIST.filter((c) => VALIDATION_CODES[c] === 'warning') as [
  WarningCode,
  ...WarningCode[],
];
export const validationCodeSchema = z.enum(VALIDATION_CODE_LIST);
export const warningCodeSchema = z.enum(WARNING_CODES);
export const severitySchema = z.enum(SEVERITIES);

const issueDataValue = z.union([
  z.string().max(300),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(200)).max(50),
]);

export const validationIssueSchema = z
  .strictObject({
    code: validationCodeSchema,
    severity: severitySchema,
    /** Human-readable, includes the reason (e.g. which building overlaps by how much). */
    message: z.string().min(1).max(500),
    /** Draft field the issue is about, dot-separated (e.g. 'model.heightM'), or null. */
    path: z.string().max(100).nullable(),
    data: z.record(z.string().max(40), issueDataValue),
  })
  .refine((i) => VALIDATION_CODES[i.code] === i.severity, {
    message: 'severity does not match the code',
    path: ['severity'],
  });

export const validationResultSchema = z.strictObject({
  issues: z.array(validationIssueSchema),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  /** No errors (warnings still need acknowledgements). */
  publishable: z.boolean(),
  /** Distinct warning codes present; each needs an acknowledgement to publish. */
  requiredAcknowledgements: z.array(warningCodeSchema),
});

export const acknowledgementSchema = z.strictObject({
  code: warningCodeSchema,
  reason: provenanceLine(STUDIO_LIMITS.ackReason.max).pipe(z.string().min(STUDIO_LIMITS.ackReason.min)),
});
export const acknowledgementsSchema = z
  .array(acknowledgementSchema)
  .max(STUDIO_LIMITS.maxAcknowledgements)
  .refine((a) => new Set(a.map((x) => x.code)).size === a.length, {
    message: 'One acknowledgement per warning code',
  });

/** Warning codes in `required` that `acks` does not cover (empty → acknowledgements complete). */
export function missingAcknowledgements(
  required: readonly WarningCode[],
  acks: readonly { code: WarningCode }[],
): WarningCode[] {
  const have = new Set(acks.map((a) => a.code));
  return required.filter((c) => !have.has(c));
}

// ---------------------------------------------------------------------------
// Published shape (public, GET /api/locations v2): no notes, actors or drafts
// ---------------------------------------------------------------------------

const ringSchema = z
  .array(lngLatSchema)
  .min(4)
  .max(STUDIO_LIMITS.maxFootprintVertices)
  .refine((r) => r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1], { message: 'Ring must be closed' });

/** Derived footprint (server-computed; RFC 7946: exterior counter-clockwise, holes clockwise). */
export const studioFootprintSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(ringSchema).min(1).max(STUDIO_LIMITS.maxFootprintRings),
  })
  .refine((g) => g.coordinates.reduce((n, r) => n + r.length, 0) <= STUDIO_LIMITS.maxFootprintVertices, {
    message: `At most ${STUDIO_LIMITS.maxFootprintVertices} footprint vertices`,
  });

/**
 * Campus membership computed at publish (classifyFootprint). Only inventory
 * statuses publish: 'outside' is an error; 'uncertain' publishes only through
 * an acknowledged 'boundary-uncertain' warning, recorded as an owner
 * confirmation (decision 'curated', status 'crossing').
 */
export const studioMembershipSchema = z
  .object({
    campusStatus: z.enum(['inside', 'crossing']),
    insideFraction: z.number().min(0).max(1),
    distanceToBoundaryM: z.number().nonnegative(),
    reasonCode: membershipReasonCodeSchema,
    decision: membershipDecisionSchema,
    /** 'owner-confirmation: studio <id> v<version>' for a curated decision, else null. */
    decisionSource: z.string().min(1).max(200).nullable(),
  })
  .refine((m) => (m.decision === 'curated') === (m.decisionSource !== null), {
    message: 'decisionSource is set exactly for curated decisions',
    path: ['decisionSource'],
  });

export const publicTemplateRefSchema = z.object({
  templateId: z.string().min(1).max(64),
  templateVersion: z.number().int().positive(),
  variantId: z.string().min(1).max(48),
});

export const publishedStudioBuildingSchema = z
  .object({
    /** Studio record id. The public id is `studioPublicId(b)` = targetId ?? id. */
    id: studioIdSchema,
    /** Base building this model belongs to, or null for a new building. */
    targetId: baseBuildingIdSchema.nullable(),
    /** Published version number (immutable snapshot). */
    version: z.number().int().positive(),
    publishedAt: isoDateTimeSchema,
    identity: publicStudioIdentitySchema.nullable(),
    verification: verificationSchema,
    /** Accuracy class of the template the model came from (all starter templates: 'generic-prefab'). */
    accuracyClass: accuracyClassSchema,
    templateRef: publicTemplateRefSchema.nullable(),
    model: modelEnvelopeSchema,
    footprint: studioFootprintSchema,
    footprintAreaM2: z.number().positive(),
    membership: studioMembershipSchema,
    accessNodeId: z.number().int().nonnegative().nullable(),
    /** Base targets only: the published footprint replaces the base footprint (owner correction, audited). */
    positionCorrected: z.boolean(),
  })
  .superRefine((b, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (b.targetId === null) {
      if (b.identity === null) add('identity', 'A new building needs an identity');
      if (b.positionCorrected) add('positionCorrected', 'Only a base-building model can correct a position');
      if (b.model.generatorId === 'footprint-prism') add('model', "'footprint-prism' needs a base target");
    } else {
      if (b.identity !== null) add('identity', 'A base-building model keeps the identity of its place');
      if (b.accessNodeId !== null)
        add('accessNodeId', 'A base-building model uses the place override access');
      if (b.positionCorrected && b.model.generatorId === 'footprint-prism')
        add('model', "A corrected position needs a generated footprint, not 'footprint-prism'");
    }
  });

// ---------------------------------------------------------------------------
// Admin API payloads (/api/admin/studio/**). Requests reject unknown keys.
// ---------------------------------------------------------------------------

export const studioStatusSchema = z.enum(['draft', 'published', 'archived']);

export const createStudioBuildingRequestSchema = z.strictObject({
  /** null = new building; a base id = model of that existing building (UNIQUE per target). */
  targetId: baseBuildingIdSchema.nullable(),
  draft: studioDraftSchema,
});
export const saveDraftRequestSchema = z.strictObject({ revision, draft: studioDraftSchema });
export const revisionRequestSchema = z.strictObject({ revision });
export const publishRequestSchema = z.strictObject({
  revision,
  acknowledgements: acknowledgementsSchema,
  changeSummary: provenanceLine(STUDIO_LIMITS.changeSummary.max).pipe(
    z.string().min(STUDIO_LIMITS.changeSummary.min),
  ),
});
export const archiveRequestSchema = z.strictObject({
  revision,
  reason: blankToNull(provenanceLine(STUDIO_LIMITS.archiveReason)),
});
export const restoreRequestSchema = z.strictObject({ revision, acknowledgements: acknowledgementsSchema });
export const deleteStudioBuildingRequestSchema = z.strictObject({
  revision,
  /** Typed confirmation: must equal the record id exactly. */
  confirmId: z.string().max(40),
});
export const duplicateRequestSchema = z.strictObject({
  /** Offset of the copy in metres; null → (widthM + 5) m east (defaultDuplicateOffsetM). */
  offsetM: z
    .strictObject({
      east: z.number().min(-STUDIO_LIMITS.duplicateOffsetM.max).max(STUDIO_LIMITS.duplicateOffsetM.max),
      north: z.number().min(-STUDIO_LIMITS.duplicateOffsetM.max).max(STUDIO_LIMITS.duplicateOffsetM.max),
    })
    .refine((o) => Math.hypot(o.east, o.north) >= 1, {
      message: 'A duplicate needs a visible offset (≥ 1 m)',
    })
    .nullable(),
});
export const applyTemplateRequestSchema = z.strictObject({
  revision,
  templateId: templateIdSchema,
  templateVersion: z.number().int().positive(),
  variantId: variantIdSchema,
  /** true → return the preview (draft, changed fields, validation) without saving. */
  dryRun: z.boolean(),
});
export const validateRequestSchema = z.strictObject({
  targetId: baseBuildingIdSchema.nullable(),
  draft: studioDraftSchema,
  /** The record being edited (excluded from its own overlap/duplicate checks), or null. */
  recordId: studioIdSchema.nullable(),
});
export const studioListQuerySchema = z.object({
  status: studioStatusSchema.optional(),
  targetId: baseBuildingIdSchema.optional(),
  q: z.string().trim().max(STUDIO_LIMITS.name.max).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});
export const createOwnerTemplateRequestSchema = z.strictObject({ definition: ownerTemplateInputSchema });
export const updateOwnerTemplateRequestSchema = z.strictObject({
  revision,
  definition: ownerTemplateInputSchema,
});

/** Default visible offset for a duplicate: one building width plus 5 m to the east. */
export function defaultDuplicateOffsetM(model: { widthM: number }): { east: number; north: number } {
  return { east: Math.min(model.widthM + 5, STUDIO_LIMITS.duplicateOffsetM.max), north: 0 };
}

// --- responses (server output; parsed by the admin app) ---

export const studioBuildingHeadSchema = z.object({
  id: studioIdSchema,
  targetId: baseBuildingIdSchema.nullable(),
  status: studioStatusSchema,
  /** Optimistic-concurrency revision; every write must send it and bumps it. */
  revision,
  /** Number of draft saves (shown as "saved draft (rev n)"). */
  draftRevision: z.number().int().nonnegative(),
  hasDraft: z.boolean(),
  /** Latest published version (kept while archived so restore can re-publish it). */
  publishedVersion: z.number().int().positive().nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  archiveReason: z.string().nullable(),
  createdBy: z.string(),
  createdAt: isoDateTimeSchema,
  updatedBy: z.string(),
  updatedAt: isoDateTimeSchema,
});

export const studioPublishedVersionSchema = z.object({
  version: z.number().int().positive(),
  /** The full record as published, including private notes (admin only). */
  record: studioDraftSchema,
  footprint: studioFootprintSchema,
  footprintAreaM2: z.number().positive(),
  membership: studioMembershipSchema,
  acknowledgements: z.array(acknowledgementSchema),
  changeSummary: z.string(),
  publishedBy: z.string(),
  publishedAt: isoDateTimeSchema,
});

export const MODEL_UNAVAILABLE_REASONS = [
  'unknown-model-config-version',
  'unknown-generator',
  'unknown-generator-version',
  'invalid-config',
] as const;

export const studioBuildingDetailSchema = z.object({
  head: studioBuildingHeadSchema,
  draft: studioDraftSchema.nullable(),
  published: studioPublishedVersionSchema.nullable(),
  /** Validation of the draft (or of the published record when there is no draft) against the CURRENT base data. */
  validation: validationResultSchema.nullable(),
  modelAvailable: z.boolean(),
  unavailableReason: z.enum(MODEL_UNAVAILABLE_REASONS).nullable(),
});

export const studioBuildingSummarySchema = z.object({
  id: studioIdSchema,
  targetId: baseBuildingIdSchema.nullable(),
  status: studioStatusSchema,
  /** Honest title: name, the base building's label, or "Unnamed building (owner-placed model)". */
  title: z.string().min(1),
  categoryId: z.string().nullable(),
  revision,
  hasDraft: z.boolean(),
  publishedVersion: z.number().int().positive().nullable(),
  updatedAt: isoDateTimeSchema,
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  modelAvailable: z.boolean(),
});

export const studioBuildingListSchema = z.object({
  items: z.array(studioBuildingSummarySchema),
  nextCursor: z.string().nullable(),
});

export const publishResponseSchema = z.object({
  building: studioBuildingDetailSchema,
  publicationVersion: z.number().int().nonnegative(),
});

export const applyTemplateResponseSchema = z.object({
  draft: studioDraftSchema,
  /** Dot paths of model fields the template version changed (the before/after preview). */
  changedFields: z.array(z.string()),
  validation: validationResultSchema,
  saved: z.boolean(),
  building: studioBuildingDetailSchema.nullable(),
});

/** DELETE /studio/buildings/:id — the audit event keeps the before-snapshot. */
export const deleteStudioBuildingResponseSchema = z.object({
  deletedId: studioIdSchema,
  auditEventId: z.number().int().positive(),
});

export const STUDIO_QUALITY_KINDS = [
  /** Published model this build cannot generate (drawn as a footprint prism). */
  'model-unavailable',
  /** Base target no longer in the current base dataset (record kept, not applied). */
  'orphan-target',
  /** Published record that now fails validation against the current base data (errors only). */
  'now-invalid',
  /** Published record whose footprint the current boundary classifies 'outside' (not shown). */
  'outside-campus-now',
  /** Draft unchanged for longer than pendingStaleDays. */
  'stale-draft',
] as const;

/** GET /studio/quality. */
export const studioQualityResponseSchema = z.object({
  warnings: z.array(
    z.object({
      kind: z.enum(STUDIO_QUALITY_KINDS),
      id: studioIdSchema,
      targetId: baseBuildingIdSchema.nullable(),
      message: z.string().min(1),
    }),
  ),
  /** Generator versions referenced by any draft or version: these must never be removed. */
  generatorVersionsInUse: z.array(
    z.object({
      generatorId: z.string(),
      generatorVersion: z.number().int().positive(),
      count: z.number().int(),
    }),
  ),
});

export const templateListingSchema = z.object({
  source: z.enum(['code', 'owner']),
  status: z.enum(['active', 'retired']),
  definition: templateDefinitionSchema,
  versions: z.array(z.number().int().positive()),
  /** Owner templates only (optimistic concurrency); null for code templates. */
  revision: revision.nullable(),
});
export const studioLibraryResponseSchema = z.object({ templates: z.array(templateListingSchema) });

/**
 * Error codes the studio adds to apiErrorSchema (src/community/schema.ts):
 * the studio-server agent adds them to the enum and to both STATUS_BY_CODE
 * maps (server/errors.ts, server/http/errors.ts) in one change.
 */
export const STUDIO_ERROR_STATUS = { 'validation-failed': 422, 'unsupported-model': 422 } as const;
export type StudioErrorCode = keyof typeof STUDIO_ERROR_STATUS;

/** Error body extras for studio endpoints (beside the apiErrorSchema fields). */
export const studioErrorDetailsSchema = z.object({
  /** 422 validation-failed: the validation that blocked the write. */
  validation: validationResultSchema.optional(),
  /** 422 validation-failed: warning codes without an acknowledgement. */
  missingAcknowledgements: z.array(warningCodeSchema).optional(),
  /** 409 conflict: the current head, so the client can reload and merge. */
  current: studioBuildingHeadSchema.optional(),
});

// ---------------------------------------------------------------------------
// Audit vocabulary (entity types 'building' and 'template', migration 0002)
// ---------------------------------------------------------------------------

export const STUDIO_AUDIT_ACTIONS = [
  'building.create',
  'building.save-draft',
  'building.discard-draft',
  'building.publish',
  'building.archive',
  'building.restore',
  'building.delete',
  'building.duplicate',
  'building.apply-template',
  'template.create',
  'template.version',
  'template.retire',
  'template.unretire',
] as const;
export type StudioAuditAction = (typeof STUDIO_AUDIT_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShapeParams = z.infer<typeof shapeParamsSchema>;
export type Roof = z.infer<typeof roofSchema>;
export type Facade = z.infer<typeof facadeSchema>;
export type DetailLevel = z.infer<typeof detailLevelSchema>;
export type GeometryGuide = z.infer<typeof geometryGuideSchema>;
export type ModelConfigV1 = z.infer<typeof modelConfigV1Schema>;
export type ModelDefaults = z.infer<typeof modelDefaultsSchema>;
export type ModelEnvelope = z.infer<typeof modelEnvelopeSchema>;
export type StudioIdentity = z.infer<typeof studioIdentitySchema>;
export type PublicStudioIdentity = z.infer<typeof publicStudioIdentitySchema>;
export type StudioVerificationStatus = z.infer<typeof studioVerificationStatusSchema>;
export type VerificationDraft = z.infer<typeof verificationDraftSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type LibraryCategory = z.infer<typeof libraryCategorySchema>;
export type AccuracyClass = z.infer<typeof accuracyClassSchema>;
export type RenderCost = z.infer<typeof renderCostSchema>;
export type TemplateConstraints = z.infer<typeof templateConstraintsSchema>;
export type TemplateVariant = z.infer<typeof templateVariantSchema>;
export type TemplateDefinition = z.infer<typeof templateDefinitionSchema>;
export type OwnerTemplateInput = z.infer<typeof ownerTemplateInputSchema>;
export type TemplateRef = z.infer<typeof templateRefSchema>;
export type PositionCorrection = z.infer<typeof positionCorrectionSchema>;
export type StudioDraft = z.infer<typeof studioDraftSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ValidationResult = z.infer<typeof validationResultSchema>;
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;
export type StudioFootprint = z.infer<typeof studioFootprintSchema>;
export type StudioMembership = z.infer<typeof studioMembershipSchema>;
export type PublishedStudioBuilding = z.infer<typeof publishedStudioBuildingSchema>;
export type StudioStatus = z.infer<typeof studioStatusSchema>;
export type CreateStudioBuildingRequest = z.infer<typeof createStudioBuildingRequestSchema>;
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;
export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type ArchiveRequest = z.infer<typeof archiveRequestSchema>;
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;
export type DeleteStudioBuildingRequest = z.infer<typeof deleteStudioBuildingRequestSchema>;
export type DuplicateRequest = z.infer<typeof duplicateRequestSchema>;
export type ApplyTemplateRequest = z.infer<typeof applyTemplateRequestSchema>;
export type ValidateRequest = z.infer<typeof validateRequestSchema>;
export type StudioListQuery = z.infer<typeof studioListQuerySchema>;
export type StudioBuildingHead = z.infer<typeof studioBuildingHeadSchema>;
export type StudioPublishedVersion = z.infer<typeof studioPublishedVersionSchema>;
export type StudioBuildingDetail = z.infer<typeof studioBuildingDetailSchema>;
export type StudioBuildingSummary = z.infer<typeof studioBuildingSummarySchema>;
export type StudioBuildingList = z.infer<typeof studioBuildingListSchema>;
export type PublishResponse = z.infer<typeof publishResponseSchema>;
export type ApplyTemplateResponse = z.infer<typeof applyTemplateResponseSchema>;
export type TemplateListing = z.infer<typeof templateListingSchema>;
export type StudioLibraryResponse = z.infer<typeof studioLibraryResponseSchema>;
export type StudioErrorDetails = z.infer<typeof studioErrorDetailsSchema>;
export type DeleteStudioBuildingResponse = z.infer<typeof deleteStudioBuildingResponseSchema>;
export type StudioQualityResponse = z.infer<typeof studioQualityResponseSchema>;
