/**
 * Owner-supplied isometric artwork: frozen wire and file contracts
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md).
 *
 * Shared by the browser app, the admin app, the server and the build scripts:
 * erasable syntax only, explicit `.ts` imports, no DOM/Node. This file must
 * NOT import src/community/schema.ts (that file imports this one for the
 * publication's artwork field).
 *
 * Three record families, kept apart on purpose:
 *  - ASSET   one original artwork file (`iso-art-NNN`, the inventory id). The
 *            file is the visual source; it is published unchanged, and any
 *            derived copy is recorded with the sha256 of its source.
 *  - SUBJECT one thing the artwork depicts (`art:num-25`, `art:scene-091`,
 *            `art:area-scene-pavilion`). A vignette file can show 14 numbered
 *            buildings and the master shows 45, so labels and associations
 *            belong to subjects, never to files.
 *  - ASSOCIATION  the link from a subject to a canonical building id, with a
 *            status: 'verified' (evidence required), 'approximate' (a reviewed
 *            candidate footprint, shown only as "Unconfirmed match", never
 *            routed) or 'unresolved'.
 *
 * Label rules (binding): every printed label is quoted EXACTLY (spelling,
 * typos, capitalisation, punctuation, internal double spaces) together with a
 * reference to the inventory label it comes from; a corrected spelling may
 * appear only in `aliases`. An artwork number ("BLOCK-25", pin "25") is the
 * artwork's own numbering and is never an official LPU block number.
 */
import { z } from 'zod';
import { BASE_BUILDING_ID_RE, STUDIO_ID_RE } from '../building-studio/index.ts';
import {
  PROHIBITED_SOURCE_MESSAGE,
  containsProhibitedSourceUrl,
  hasControlChars,
  isProhibitedSourceUrl,
} from '../building-studio/index.ts';
import { ASSOCIATION_STATUSES, ILLUSTRATION_DISCLAIMER } from './text.ts';

export const ISOMETRIC_ART_REGISTRY_VERSION = 1;
export const ISOMETRIC_ART_MANIFEST_VERSION = 1;

// User-facing wording lives in text.ts (zod-free); re-exported here for contract code.
export {
  ARTWORK_NUMBER_NOTE,
  ASSOCIATION_STATUSES,
  ILLUSTRATION_DISCLAIMER,
  UNCONFIRMED_MATCH_LABEL,
} from './text.ts';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** Inventory asset id: `iso-art-` + the original file's leading number, zero-padded (data/curated/isometric-art/inventory.json). */
export const ART_ASSET_ID_RE = /^iso-art-\d{3}$/;
/** Artwork number as printed (pin or caption heading), e.g. '25', '21A'. Never an official block number. */
export const ARTWORK_NUMBER_RE = /^[1-9]\d{0,2}[A-Z]?$/;
/**
 * Subject id (stable, internal): `art:num-<artwork number, lower case>`,
 * `art:scene-<asset NNN>` or `art:area-<hotspot id without "hs-">`.
 */
export const ART_SUBJECT_ID_RE = /^art:(?:num|scene|area)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ART_SUBJECT_ID_MAX = 64;
/** Hotspot id on the master overview (data/curated/isometric-art/hotspots.json). */
export const ART_HOTSPOT_ID_RE = /^hs-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * Where a quoted label comes from: an inventory label (`iso-art-087/L1`), an
 * inventory pin (`iso-art-119/pin:58`) or a hotspot's printed label
 * (`hotspot:hs-text-lpu-letters`).
 */
export const ART_LABEL_REF_RE =
  /^(?:iso-art-\d{3}\/(?:L[1-9]\d{0,3}|pin:[0-9A-Z]{1,4})|hotspot:hs-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A canonical building id an artwork subject may be linked to: a base building (OSM/curated) or a studio building. */
export const isArtworkBuildingId = (id: string): boolean =>
  BASE_BUILDING_ID_RE.test(id) || STUDIO_ID_RE.test(id);

export const artAssetIdSchema = z.string().regex(ART_ASSET_ID_RE, 'Invalid artwork asset id');
export const artSubjectIdSchema = z
  .string()
  .max(ART_SUBJECT_ID_MAX)
  .regex(ART_SUBJECT_ID_RE, 'Invalid artwork subject id');
export const artHotspotIdSchema = z.string().max(80).regex(ART_HOTSPOT_ID_RE, 'Invalid hotspot id');
export const artworkBuildingIdSchema = z
  .string()
  .max(200)
  .refine(isArtworkBuildingId, { message: 'Invalid building id' });
const sha256Schema = z.string().regex(SHA256_RE, 'Invalid sha256');
const isoDateSchema = z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD');

/** Subject id for an artwork number: '21A' → 'art:num-21a'. */
export const numberSubjectId = (artworkNumber: string): string => `art:num-${artworkNumber.toLowerCase()}`;
/** Subject id for a scene vignette: 'iso-art-091' → 'art:scene-091'. */
export const sceneSubjectId = (assetId: string): string => `art:scene-${assetId.slice('iso-art-'.length)}`;
/** Subject id for a hotspot that is not a numbered pin: 'hs-scene-pavilion' → 'art:area-scene-pavilion'. */
export const areaSubjectId = (hotspotId: string): string => `art:area-${hotspotId.slice('hs-'.length)}`;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Printed text, EXACT: never trimmed, case-folded or normalized here, so
 * "SCHOOL OF CIVIL INGNEERING" and "CAMPUS CAFE  &" (two spaces) survive.
 * Same house control-character rule as the prose below (hasControlChars):
 * C0/C1 controls (incl. tab/newline), DEL, bidi embedding/override/isolate
 * controls and unpaired surrogates are refused; a printed label has none.
 */
export const exactTextSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((s) => !hasControlChars(s), { message: 'Control characters are not allowed' })
  .refine((s) => s === s.trim(), { message: 'Printed text never starts or ends with whitespace' });

/**
 * Owner/agent prose (reasons, notes, evidence descriptions): trimmed single
 * paragraph. Uses the house text rule (src/building-studio/text.ts
 * hasControlChars, the same as public suggestions): C0/C1 controls, bidi
 * embedding/override/isolate controls (display spoofing in the public
 * details and aria-labels) and unpaired surrogates (D1 would store U+FFFD,
 * silently altering the owner's text) are refused.
 */
const prose = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !hasControlChars(s), { message: 'Control characters are not allowed' });

const isHttpUrl = (s: string) => {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
};
/**
 * An evidence URL: http(s), no credentials, no control characters (a tab or
 * bidi control is shown verbatim as the link text but dropped from the href),
 * and never Google Maps / Earth / Street View — they are never a source
 * (docs/GEODATA_SOURCES_AND_LICENSES.md §7; the same rule as Building Studio).
 */
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => !hasControlChars(s), { message: 'Control characters are not allowed' })
  .refine(isHttpUrl, { message: 'Must be an http(s) URL' })
  .refine((s) => !isProhibitedSourceUrl(s), { message: PROHIBITED_SOURCE_MESSAGE });

/**
 * A printed label, quoted exactly, with the label it comes from. `span: true`
 * means `text` is an exact substring of the referenced label (one caption
 * inside a printed caption run); otherwise it equals the referenced text.
 * build-isometric-art.ts checks every quote against the inventory.
 */
export const labelQuoteSchema = z
  .object({
    ref: z.string().regex(ART_LABEL_REF_RE, 'Invalid label reference'),
    text: exactTextSchema,
    span: z.literal(true).optional(),
  })
  .strict();
export type LabelQuote = z.infer<typeof labelQuoteSchema>;

// ---------------------------------------------------------------------------
// Associations (curated baseline, owner override in D1, publication)
// ---------------------------------------------------------------------------

export const associationStatusSchema = z.enum(ASSOCIATION_STATUSES);
export type AssociationStatus = z.infer<typeof associationStatusSchema>;

export const EVIDENCE_KINDS = ['site-sign', 'official-document', 'owner-statement'] as const;

/** Evidence for a verified association (public: no private notes belong here). */
export const associationEvidenceSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    /** Public. A Google Maps / Earth / Street View link is refused here too (never a source). */
    description: prose(500)
      .pipe(z.string().min(3))
      .refine((s) => !containsProhibitedSourceUrl(s), { message: PROHIBITED_SOURCE_MESSAGE }),
    url: httpUrl.optional(),
    date: isoDateSchema,
  })
  .strict();
export type AssociationEvidence = z.infer<typeof associationEvidenceSchema>;

/** A reviewed candidate footprint (docs/research/block-leads/block-candidates.json), best first. */
export const candidateFootprintSchema = z
  .object({
    buildingId: artworkBuildingIdSchema,
    score: z.number().min(0).max(1),
    shapeMatch: z.enum(['strong', 'partial', 'weak']),
    rank: z.number().int().min(1),
  })
  .strict();
export type CandidateFootprint = z.infer<typeof candidateFootprintSchema>;

/**
 * Shared consistency rules of a stored association (curated, D1 row,
 * publication): unresolved ⇔ no building; verified ⇒ at least one evidence.
 * For 'approximate', buildingId is the candidate footprint shown as
 * "Unconfirmed match" — it is never an identity; mergeArtworkAssociations
 * exposes it as `unconfirmedMatchId`, not `buildingId`.
 */
const associationRules = <
  T extends { status: AssociationStatus; buildingId: string | null; evidence: unknown[] },
>(
  a: T,
  ctx: z.RefinementCtx,
) => {
  if ((a.status === 'unresolved') !== (a.buildingId === null))
    ctx.addIssue({
      code: 'custom',
      path: ['buildingId'],
      message: 'An unresolved association has no building; a verified or approximate one has exactly one',
    });
  if (a.status === 'verified' && a.evidence.length === 0)
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'A verified association needs evidence' });
};

/** Curated baseline association (registry.json). One per subject. */
export const curatedAssociationSchema = z
  .object({
    subjectId: artSubjectIdSchema,
    status: associationStatusSchema,
    buildingId: artworkBuildingIdSchema.nullable(),
    evidence: z.array(associationEvidenceSchema).max(10),
    candidateFootprints: z.array(candidateFootprintSchema).max(20),
    /** Why this status (public). */
    reason: prose(1000),
    revision: z.number().int().min(1),
  })
  .strict()
  .superRefine(associationRules);
export type CuratedAssociation = z.infer<typeof curatedAssociationSchema>;

/**
 * An owner decision as published (GET /api/locations v3 `artworkAssociations`):
 * public fields only — never the private note, actors or audit data. Read
 * schema: unknown keys are stripped so older clients survive newer servers.
 */
export const publishedArtworkAssociationSchema = z
  .object({
    subjectId: artSubjectIdSchema,
    status: associationStatusSchema,
    buildingId: artworkBuildingIdSchema.nullable(),
    evidence: z.array(associationEvidenceSchema).max(10),
    revision: z.number().int().positive(),
    updatedAt: z.string(),
  })
  .superRefine(associationRules);
export type PublishedArtworkAssociation = z.infer<typeof publishedArtworkAssociationSchema>;

/** Body of PUT /api/admin/artwork/associations/:subjectId (strict: unknown keys rejected). */
export const artworkAssociationWriteSchema = z
  .object({
    /** null = no owner decision exists yet (create); else the current row's revision (409 when stale). */
    expectedRevision: z.number().int().positive().nullable(),
    status: associationStatusSchema,
    buildingId: artworkBuildingIdSchema.nullable(),
    evidence: z.array(associationEvidenceSchema).max(10),
    /** Private owner note: stored in D1, shown in admin, never published. */
    note: prose(1000).nullable().optional(),
  })
  .strict()
  .superRefine(associationRules);
export type ArtworkAssociationWrite = z.infer<typeof artworkAssociationWriteSchema>;

/** Body of DELETE /api/admin/artwork/associations/:subjectId (reset to the curated baseline). */
export const artworkAssociationResetSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();

// ---------------------------------------------------------------------------
// Registry (data/curated/isometric-art/registry.json, curated)
// ---------------------------------------------------------------------------

const imageFormat = z.enum(['image/jpeg', 'image/webp', 'image/png']);
const quality = z.number().min(0.5).max(1);

/**
 * How a derived web copy is made from an original (Playwright Chromium canvas
 * in a dev script; outputs are committed). Every derived copy is a UNIFORM
 * scale of the whole original (no crop, stretch or recolour beyond the
 * colour-managed conversion to sRGB), so hotspot coordinates stay valid.
 */
export const derivedSpecSchema = z.discriminatedUnion('purpose', [
  /** Same pixel size, colour-managed sRGB (the master is CMYK with a SWOP profile). */
  z.object({ purpose: z.literal('web-full'), format: imageFormat, quality }).strict(),
  /** One uniformly downscaled copy for first paint and phones. */
  z
    .object({
      purpose: z.literal('preview'),
      format: imageFormat,
      quality,
      maxWidth: z.number().int().min(256).max(4096),
    })
    .strict(),
  /** Zoom pyramid: level 0 = full size, each next level halves; tiles cover the image without overlap. */
  z
    .object({
      purpose: z.literal('tiles'),
      format: imageFormat,
      quality,
      tileSize: z.union([z.literal(256), z.literal(512)]),
      levels: z.number().int().min(1).max(8),
    })
    .strict(),
]);
export type DerivedSpec = z.infer<typeof derivedSpecSchema>;

export const ART_ASSET_KINDS = ['master', 'vignette', 'scene'] as const;

export const registryAssetSchema = z
  .object({
    assetId: artAssetIdSchema,
    kind: z.enum(ART_ASSET_KINDS),
    /** false only for a byte-identical duplicate (it is never published; its canonical copy is). */
    publishOriginal: z.boolean(),
    duplicateOf: artAssetIdSchema.nullable(),
    derive: z.array(derivedSpecSchema).max(4),
    /** 'derived-model' is reserved for a future model built FROM the artwork; originals are always 'original-artwork'. */
    visualFidelity: z.enum(['original-artwork', 'derived-model']),
    notes: z.string().max(2000),
    needsManualVerification: z.array(prose(500)).max(20),
  })
  .strict();
export type RegistryAsset = z.infer<typeof registryAssetSchema>;

export const SUBJECT_KINDS = ['numbered', 'scene', 'area'] as const;
export const SUBJECT_RELATIONS = ['candidate-part-of', 'visual-correspondence'] as const;

export const artSubjectSchema = z
  .object({
    subjectId: artSubjectIdSchema,
    kind: z.enum(SUBJECT_KINDS),
    /** The artwork's own number (pin or caption heading); null for scenes and areas. */
    artworkNumber: z.string().regex(ARTWORK_NUMBER_RE).nullable(),
    /** The name to show, exactly as printed (a caption, or the only index row); null when none or ambiguous. */
    displayLabel: labelQuoteSchema.nullable(),
    /** The artwork's block heading, exactly as printed (e.g. "BLOCK-25,26:"); artwork numbering, never official. */
    visibleBlockLabel: labelQuoteSchema.nullable(),
    /** Every other printed label naming this subject (index rows, further captions), exact. */
    otherLabels: z.array(labelQuoteSchema).max(20),
    /** An index section heading, only when all of the subject's index rows sit under that one heading. */
    artworkCategory: labelQuoteSchema.nullable(),
    /** Master-overview hotspots that ARE this subject (each hotspot belongs to exactly one subject). */
    hotspotIds: z.array(artHotspotIdSchema).max(20),
    /** Vignettes (canonical assets) that depict this subject. */
    vignetteAssetIds: z.array(artAssetIdSchema).max(20),
    /** Unverified links to other subjects; never shown as identity. */
    relations: z
      .array(z.object({ subjectId: artSubjectIdSchema, relation: z.enum(SUBJECT_RELATIONS) }).strict())
      .max(20),
    /** Search-only spellings (a corrected spelling may live here, never in a label). */
    aliases: z.array(prose(300)).max(20),
    /** Set when a printed label must not be displayed until the owner decides (it stays recorded exactly). */
    displayHold: z
      .object({ reason: prose(500) })
      .strict()
      .nullable(),
    needsManualVerification: z.array(prose(500)).max(20),
    notes: z.string().max(2000),
  })
  .strict()
  .superRefine((s, ctx) => {
    const numbered = s.kind === 'numbered';
    if (numbered !== (s.artworkNumber !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['artworkNumber'],
        message: 'Only numbered subjects have a number',
      });
    if (numbered && s.artworkNumber !== null && s.subjectId !== numberSubjectId(s.artworkNumber))
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: 'Numbered subject id must be art:num-<number>',
      });
    const prefix = { numbered: 'art:num-', scene: 'art:scene-', area: 'art:area-' }[s.kind];
    if (!s.subjectId.startsWith(prefix))
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: `A ${s.kind} subject id starts with ${prefix}`,
      });
  });
export type ArtSubject = z.infer<typeof artSubjectSchema>;

export const isometricArtRegistrySchema = z
  .object({
    $comment: z.string().optional(),
    schemaVersion: z.literal(ISOMETRIC_ART_REGISTRY_VERSION),
    kind: z.literal('lpu-isometric-art-registry'),
    /** Repo paths of the files this registry references by id (records are never copied). */
    sources: z.object({ inventory: z.string(), hotspots: z.string(), candidates: z.string() }).strict(),
    assets: z.array(registryAssetSchema).min(1),
    subjects: z.array(artSubjectSchema).min(1),
    associations: z.array(curatedAssociationSchema),
  })
  .strict();
export type IsometricArtRegistry = z.infer<typeof isometricArtRegistrySchema>;

// ---------------------------------------------------------------------------
// Published manifest (public/isometric-art/manifest.json, generated)
// ---------------------------------------------------------------------------

/** A file inside public/isometric-art/, by path relative to the manifest (no leading slash, no '..'). */
const relUrl = z
  .string()
  .max(300)
  .regex(/^(?:original|derived)\/[A-Za-z0-9._/-]+$/)
  .refine((s) => !s.split('/').includes('..'), { message: 'No parent segments' });

export const manifestDerivedSchema = z
  .object({
    purpose: z.enum(['web-full', 'preview', 'tile']),
    url: relUrl,
    sha256: sha256Schema,
    /** sha256 of the ORIGINAL it was made from: a changed original makes this copy stale (art:check fails). */
    sourceSha256: sha256Schema,
    bytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mime: imageFormat,
    /** Tiles only: pyramid level (0 = full size), column and row. */
    tile: z
      .object({
        level: z.number().int().min(0),
        col: z.number().int().min(0),
        row: z.number().int().min(0),
        /** Tile rectangle in normalized source coordinates. */
        nx: z.number().min(0).max(1),
        ny: z.number().min(0).max(1),
        nw: z.number().gt(0).max(1),
        nh: z.number().gt(0).max(1),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ManifestDerived = z.infer<typeof manifestDerivedSchema>;

export const manifestLabelSchema = z
  .object({
    labelId: z.string().regex(ART_LABEL_REF_RE),
    kind: z.string().min(1).max(40),
    text: exactTextSchema,
    lines: z.array(z.string()).min(1),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict();

const nPoint = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);

export const manifestAssetSchema = z
  .object({
    assetId: artAssetIdSchema,
    kind: z.enum(ART_ASSET_KINDS),
    source: z
      .object({
        /** Repo path of the original (lpu-isometric-map-design/…); never modified. */
        originalPath: z.string(),
        sha256: sha256Schema,
        bytes: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        mime: z.enum(['image/jpeg', 'image/png']),
      })
      .strict(),
    /** The unchanged original as published (same file name); null for a duplicate (use duplicateOf). */
    original: z
      .object({ url: relUrl, sha256: sha256Schema, bytes: z.number().int().positive() })
      .strict()
      .nullable(),
    duplicateOf: artAssetIdSchema.nullable(),
    derived: z.array(manifestDerivedSchema),
    /** Every printed label of this file, exact (from the inventory). */
    labels: z.array(manifestLabelSchema),
    visualFidelity: z.enum(['original-artwork', 'derived-model']),
    /** Master: every hotspot. Vignette/scene: none (hotspots are traced on the master only). */
    hotspotIds: z.array(artHotspotIdSchema),
    /** Normalized content frame (the white card of a vignette slide), when measured. */
    contentFrame: z
      .object({ nx: z.number(), ny: z.number(), nw: z.number(), nh: z.number() })
      .strict()
      .nullable(),
    needsManualVerification: z.array(z.string()),
  })
  .strict();
export type ManifestAsset = z.infer<typeof manifestAssetSchema>;

export const manifestHotspotSchema = z
  .object({
    hotspotId: artHotspotIdSchema,
    subjectId: artSubjectIdSchema,
    kind: z.enum(['pin-structure', 'unassigned-structure', 'unpinned-structure', 'scene', 'printed-text']),
    /** Normalized source-image coordinates of the master: x = px / width, y = px / height. */
    polygon: z.array(nPoint).min(3),
    labelAnchor: nPoint,
    pin: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        rx: z.number().positive(),
        ry: z.number().positive(),
      })
      .strict()
      .nullable(),
    /** Text printed at this hotspot on the overview (a pin number or printed letters), exact; null when none. */
    printedLabel: exactTextSchema.nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
    /** 'needs-manual-verification' outlines are drawn with a "needs review" style, never silently as certain. */
    reviewStatus: z.enum(['traced', 'needs-manual-verification']),
  })
  .strict();
export type ManifestHotspot = z.infer<typeof manifestHotspotSchema>;

export const isometricArtManifestSchema = z
  .object({
    schemaVersion: z.literal(ISOMETRIC_ART_MANIFEST_VERSION),
    kind: z.literal('lpu-isometric-art-manifest'),
    generatedFrom: z
      .object({ registrySha256: sha256Schema, inventorySha256: sha256Schema, hotspotsSha256: sha256Schema })
      .strict(),
    disclaimer: z.literal(ILLUSTRATION_DISCLAIMER),
    /** The coordinate space of every hotspot: the master overview's pixel size. */
    coordinateSpace: z
      .object({
        assetId: artAssetIdSchema,
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    assets: z.array(manifestAssetSchema).min(1),
    hotspots: z.array(manifestHotspotSchema),
    subjects: z.array(artSubjectSchema),
    /** Curated baseline (owner decisions from D1 override it; see mergeArtworkAssociations). */
    associations: z.array(curatedAssociationSchema),
  })
  .strict();
export type IsometricArtManifest = z.infer<typeof isometricArtManifestSchema>;
