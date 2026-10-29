/**
 * Zod schemas for hand-curated inputs in data/curated/. Every record must cite
 * a source; anchors must reference real OSM ids present in the snapshot.
 * JSON Schema copies are generated into data/schemas/ by build-data.
 */
import { z } from 'zod';
import { verificationStatusSchema, wheelchairSchema } from '../../src/data/schema.ts';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/, 'ISO date (YYYY-MM-DD or full UTC timestamp)');
const httpUrl = z.url({ protocol: /^https?$/ });
export const placeRefSchema = z
  .string()
  .regex(/^(osm:(node|way|relation)\/\d+|cur:[a-z0-9][a-z0-9-]*)$/, 'place id');

/**
 * Licence terms of a cited source (G-07). Required on the entry unless the
 * publisher is in scripts/lib/publisher-terms.ts (lpu.in); the build refuses a
 * source whose licence and attribution are unknown.
 */
export const sourceTermsShape = {
  license: z.string().trim().min(1).optional(),
  attribution: z.string().trim().min(1).optional(),
  licenseUrl: httpUrl.optional(),
};

export const citedSourceSchema = z.strictObject({
  name: z.string().min(1),
  url: httpUrl,
  retrievedAt: isoDate,
  ...sourceTermsShape,
});

export const aliasesFileSchema = z.strictObject({
  $comment: z.string().optional(),
  aliases: z.array(
    z.strictObject({
      target: placeRefSchema,
      aliases: z.array(z.string().trim().min(1)).min(1),
      source: citedSourceSchema,
    }),
  ),
});

/**
 * `check` states how the change was confirmed. Only a physical survey or an
 * official publication marks the record "verified"; anything else is
 * "unverified" even after being applied.
 */
export const overrideCheckSchema = z.enum(['physical-survey', 'official-publication', 'unverified-report']);

export const overridesFileSchema = z.strictObject({
  $comment: z.string().optional(),
  overrides: z.array(
    z.strictObject({
      target: placeRefSchema,
      set: z
        .strictObject({
          name: z.string().trim().min(1).optional(),
          categoryId: z.string().min(1).optional(),
          description: z.string().trim().min(1).optional(),
          openingHours: z.string().trim().min(1).optional(),
          wheelchair: wheelchairSchema.optional(),
        })
        .refine((s) => Object.keys(s).length > 0, 'set must change at least one field'),
      source: z.strictObject({ name: z.string().min(1), url: httpUrl.optional(), ...sourceTermsShape }),
      check: overrideCheckSchema,
      lastVerifiedAt: isoDate,
      verifiedBy: z.string().min(1).optional(),
    }),
  ),
});

/** Written by the organizations workstream; extra keys are tolerated, required ones are not optional. */
export const organizationsFileSchema = z
  .object({
    $comment: z.string().optional(),
    records: z.array(
      z
        .object({
          id: z.string().regex(/^cur:[a-z0-9][a-z0-9-]*$/, 'id must be cur:<slug>'),
          name: z.string().trim().min(1),
          aliases: z.array(z.string().trim().min(1)),
          categoryId: z.string().min(1),
          kind: z.literal('organization'),
          description: z.string().optional(),
          website: z.string().optional(),
          anchor: z.object({ target: placeRefSchema }).optional(),
          source: z
            .object({ name: z.string().min(1), url: httpUrl, retrievedAt: isoDate, ...sourceTermsShape })
            .loose(),
          verificationStatus: verificationStatusSchema,
        })
        .loose(),
    ),
  })
  .loose();

/**
 * How a path connection was established. 'osm-tagging' cites the OSM way
 * itself (e.g. highway=footway + covered=yes running between two blocks) and
 * stays "imported"; a physical survey or an official publication marks the
 * relation "verified". Graph connectivity or distance is never evidence.
 */
export const pathEvidenceSchema = z.enum(['osm-tagging', 'physical-survey', 'official-publication']);

/**
 * data/curated/path-connections.json (G-29): the only producer of
 * `connected_by_path` relations. Each entry cites the OSM way that joins the
 * two places; the build checks that both places exist on campus and that the
 * way is a walkable campus path in the routing graph that reaches both.
 */
export const pathConnectionsFileSchema = z.strictObject({
  $comment: z.string().optional(),
  connections: z.array(
    z.strictObject({
      from: placeRefSchema,
      to: placeRefSchema,
      /** The OSM way of the joining path (must be in graph.json). */
      pathOsmWayId: z.number().int().positive(),
      evidence: pathEvidenceSchema,
      /** What the cited source shows, in our own words (e.g. the way's tags, or what was surveyed). */
      note: z.string().trim().min(1),
      source: citedSourceSchema,
    }),
  ),
});

export type AliasesFile = z.infer<typeof aliasesFileSchema>;
export type OverridesFile = z.infer<typeof overridesFileSchema>;
export type OrganizationsFile = z.infer<typeof organizationsFileSchema>;
export type PathConnectionsFile = z.infer<typeof pathConnectionsFileSchema>;

export const CURATED_SCHEMAS = {
  'aliases.schema.json': aliasesFileSchema,
  'overrides.schema.json': overridesFileSchema,
  'organizations.schema.json': organizationsFileSchema,
  'path-connections.schema.json': pathConnectionsFileSchema,
} as const;
