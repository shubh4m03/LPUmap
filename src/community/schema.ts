/**
 * Shared wire contracts for community contributions, moderation, owner
 * locations, overrides and the public publication layer.
 *
 * Imported by the browser app, the admin app and the server (Pages
 * Functions), so: erasable syntax only, explicit `.ts` imports, no DOM/Node.
 * The server is the only authority: it re-validates every payload with these
 * schemas and assigns all status/actor/provenance fields itself.
 */
import { z } from 'zod';
import { publishedStudioBuildingSchema } from '../building-studio/schema.ts';
import { MARK_FLOOD_MESSAGE, hasCombiningMarkFlood, hasInvisibleNameChars } from '../building-studio/text.ts';
import { CATEGORIES } from '../config/categories.ts';
import { lngLatSchema, wheelchairSchema, verificationStatusSchema } from '../data/schema.ts';
import { publishedArtworkAssociationSchema } from '../isometric-art/schema.ts';

/**
 * Version 2 (Building Studio, docs/BUILDING_STUDIO_DESIGN.md §9) = version 1
 * + `buildings` (published, non-archived studio buildings); v1 fields are
 * unchanged. Version 3 (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.3) = v2 +
 * `artworkAssociations` (owner decisions linking illustration subjects to
 * buildings). Readers accept all three, so a server rolled back to v1 or v2
 * still feeds current clients (an older body simply lacks the newer arrays).
 */
export const PUBLICATION_SCHEMA_VERSION = 3;
export const SUPPORTED_PUBLICATION_SCHEMA_VERSIONS = [1, 2, 3] as const;

/** Categories a contributor or the owner may assign (excludes generic placeholders). */
export const ASSIGNABLE_CATEGORY_IDS = CATEGORIES.filter((c) => c.id !== 'building' && c.id !== 'other').map(
  (c) => c.id,
);

export const categoryIdSchema = z.string().refine((id) => ASSIGNABLE_CATEGORY_IDS.includes(id), {
  message: 'Unknown category',
});

export const LIMITS = {
  name: { min: 2, max: 120 },
  description: 500,
  landmark: 160,
  details: 1000,
  url: 500,
  note: 1000,
  openingHours: 200,
  /** Max request body sizes (bytes). */
  publicBodyBytes: 8 * 1024,
  adminBodyBytes: 32 * 1024,
} as const;

/** Bidi embedding/override (U+202A–202E) and isolate (U+2066–2069) controls: display spoofing. */
const isBidiControl = (c: number) => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

/**
 * True when `s` contains a C0/C1 control character, DEL, a bidi
 * embedding/override/isolate control or an unpaired UTF-16 surrogate, except
 * the listed allowed code points. ZWJ/ZWNJ and LRM/RLM stay allowed (needed
 * by Indic and RTL scripts).
 */
function hasControlChars(s: string, allowed: readonly number[] = []): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return true;
    if ((c < 0x20 || (c >= 0x7f && c <= 0x9f) || isBidiControl(c)) && !allowed.includes(c)) return true;
  }
  return false;
}

/** Single-line text: trimmed, no control characters, no stacked-mark floods. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !hasControlChars(s), { message: 'Control characters are not allowed' })
    .refine((s) => !hasCombiningMarkFlood(s), { message: MARK_FLOOD_MESSAGE });

/**
 * A place name: a single line that also rejects invisible characters (zero-width
 * spaces, stray joiners, U+2028/2029; see hasInvisibleNameChars), so two names
 * that look identical never compare different.
 */
const nameLine = (max: number) =>
  line(max).refine((s) => !hasInvisibleNameChars(s), {
    message:
      'Invisible characters (zero-width spaces, joiners outside a non-Latin word, line or paragraph separators) are not allowed in names',
  });

/** Multi-line text: trimmed; tab, LF and CR allowed, other control characters and stacked-mark floods rejected. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !hasControlChars(s, [0x09, 0x0a, 0x0d]), {
      message: 'Control characters are not allowed',
    })
    .refine((s) => !hasCombiningMarkFlood(s), { message: MARK_FLOOD_MESSAGE });

export const httpUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.url)
  .refine(
    (s) => {
      try {
        const u = new URL(s);
        return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
      } catch {
        return false;
      }
    },
    { message: 'Must be an http(s) URL' },
  );

const optional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s.optional());

export const suggestionStatusSchema = z.enum([
  'pending',
  'needs_information',
  'approved',
  'rejected',
  'duplicate',
]);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

/**
 * Public submission body. `.strict()` is deliberately NOT used: unknown keys
 * (status, approved, reviewer, isAdmin, …) are stripped and ignored, and the
 * server assigns status itself. `website` is the honeypot field.
 */
export const contributionInputSchema = z.object({
  name: nameLine(LIMITS.name.max).pipe(z.string().min(LIMITS.name.min)),
  categoryId: categoryIdSchema,
  location: lngLatSchema,
  description: optional(text(LIMITS.description)),
  landmark: optional(line(LIMITS.landmark)),
  evidenceUrl: optional(httpUrlSchema),
  details: optional(text(LIMITS.details)),
  /** Honeypot: humans never see or fill it. Any value → silently discarded. */
  website: z.string().max(200).optional(),
});
export type ContributionInput = z.infer<typeof contributionInputSchema>;

export const duplicateCandidateSchema = z.object({
  id: z.string(),
  kind: z.enum(['place', 'location', 'suggestion']),
  name: z.string(),
  distanceM: z.number().nonnegative(),
  reason: z.string(),
});
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const contributionResponseSchema = z.object({
  reference: z.string(),
  status: z.literal('pending'),
  message: z.string(),
  possibleDuplicates: z.array(duplicateCandidateSchema),
});
export type ContributionResponse = z.infer<typeof contributionResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'invalid',
      'outside-area',
      'rate-limited',
      'too-large',
      'unauthenticated',
      'forbidden',
      'csrf',
      'not-found',
      'conflict',
      'invalid-transition',
      // Building Studio (STUDIO_ERROR_STATUS, docs/BUILDING_STUDIO_DESIGN.md §7).
      'validation-failed',
      'unsupported-model',
      'unavailable',
      'not-configured',
      'internal',
    ]),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    retryAfterS: z.number().int().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Editable place fields shared by owner locations and overrides. */
export const placeFieldsSchema = z.object({
  name: nameLine(LIMITS.name.max).pipe(z.string().min(LIMITS.name.min)),
  categoryId: categoryIdSchema,
  location: lngLatSchema,
  description: optional(text(LIMITS.description)),
  openingHours: optional(line(LIMITS.openingHours)),
  wheelchair: wheelchairSchema.default('unknown'),
  website: optional(httpUrlSchema),
  sourceUrl: optional(httpUrlSchema),
  verificationStatus: verificationStatusSchema.default('unverified'),
  lastVerifiedAt: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});
export type PlaceFields = z.infer<typeof placeFieldsSchema>;

/**
 * Override of a base (OSM/curated) place: every field optional; absent = keep base value.
 * The defaults of placeFieldsSchema are removed first — Zod 4's `.partial()` still applies
 * `.default()`, which would silently reset the base wheelchair/verification values.
 */
export const overrideFieldsSchema = placeFieldsSchema
  .extend({
    wheelchair: wheelchairSchema.optional(),
    verificationStatus: verificationStatusSchema.optional(),
  })
  .partial();
export type OverrideFields = z.infer<typeof overrideFieldsSchema>;

/**
 * Access point: an existing routing-graph node the owner asserts is the real
 * way in. The server checks it exists, is walkable and is within
 * APP_CONFIG.routing.maxPlaceConnectorM of the location — it never picks one.
 */
export const accessPointSchema = z.object({
  nodeId: z.number().int().nonnegative(),
  note: optional(line(300)),
});

export const locationStatusSchema = z.enum(['active', 'hidden']);

/** A published owner-created or approved community location (public shape). */
export const publishedLocationSchema = z.object({
  id: z.string().regex(/^(own|com):[A-Za-z0-9_-]+$/),
  origin: z.enum(['owner', 'community']),
  name: z.string(),
  categoryId: z.string(),
  location: lngLatSchema,
  description: z.string().optional(),
  openingHours: z.string().optional(),
  wheelchair: wheelchairSchema,
  website: z.string().optional(),
  sourceUrl: z.string().optional(),
  verificationStatus: verificationStatusSchema,
  lastVerifiedAt: z.string().optional(),
  accessNodeId: z.number().int().nonnegative().nullable(),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
});
export type PublishedLocation = z.infer<typeof publishedLocationSchema>;

/** A published override of a base place (public shape — no private notes). */
export const publishedOverrideSchema = z.object({
  targetId: z.string().min(1),
  hidden: z.boolean(),
  fields: overrideFieldsSchema,
  accessNodeId: z.number().int().nonnegative().nullable(),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
});
export type PublishedOverride = z.infer<typeof publishedOverrideSchema>;

/** GET /api/locations response (v1, v2 or v3). */
export const publicationSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(PUBLICATION_SCHEMA_VERSION)]),
  /** Monotonic counter bumped on every publicly visible change (drives the ETag). */
  publicationVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
  locations: z.array(publishedLocationSchema),
  overrides: z.array(publishedOverrideSchema),
  /**
   * v2: published, non-archived studio buildings in id order (no notes,
   * actors or drafts). A v2 server always sends the array (possibly empty);
   * it is optional only so a v1 body still parses. Absent = none.
   */
  buildings: z.array(publishedStudioBuildingSchema).optional(),
  /**
   * v3: the owner's artwork association decisions in subject order (public
   * fields only: no private note, no actors). Each overrides the curated
   * baseline in public/isometric-art/manifest.json (mergeArtworkAssociations).
   * A v3 server always sends the array; absent (v1/v2) = no decisions.
   */
  artworkAssociations: z.array(publishedArtworkAssociationSchema).optional(),
});
export type Publication = z.infer<typeof publicationSchema>;

export const EMPTY_PUBLICATION: Publication = {
  schemaVersion: PUBLICATION_SCHEMA_VERSION,
  publicationVersion: 0,
  generatedAt: '1970-01-01T00:00:00.000Z',
  locations: [],
  overrides: [],
  buildings: [],
  artworkAssociations: [],
};

/** Allowed moderation transitions (server-enforced). `approved` is terminal except via unpublish+reopen. */
export const SUGGESTION_TRANSITIONS: Record<SuggestionStatus, readonly SuggestionStatus[]> = {
  pending: ['approved', 'rejected', 'duplicate', 'needs_information'],
  needs_information: ['approved', 'rejected', 'duplicate', 'pending'],
  rejected: ['pending'],
  duplicate: ['pending'],
  approved: [],
};

export function canTransition(from: SuggestionStatus, to: SuggestionStatus): boolean {
  return SUGGESTION_TRANSITIONS[from].includes(to);
}
