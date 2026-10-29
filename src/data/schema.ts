/**
 * Runtime contracts for every generated dataset file in public/data/.
 *
 * This module is shared by the Node data pipeline (scripts/*.ts, run with
 * Node's native type stripping) and the browser app, so it must use only
 * erasable TypeScript syntax and explicit `.ts` import extensions.
 *
 * Bump DATA_SCHEMA_VERSION on any breaking change. The app refuses to load a
 * dataset whose schemaVersion differs (see src/data/loader.ts) instead of
 * failing later with obscure runtime errors.
 *
 * Version 2 (the "v2 geographic contract", docs/MODULE_CONTRACTS.md):
 * - buildings.geojson carries BuildingPropsV2: campus membership by exact
 *   area fraction (src/geo/boundary.ts), provenance, tag pass-throughs, and
 *   render-only values under a visible `render` prefix. It never contains a
 *   footprint classified 'outside'.
 * - places.json holds campus places only; off-campus POIs move to the opt-in
 *   context-places.json. Machine-detected footprints live in detections.json
 *   (never extruded, searched, routed or counted as campus buildings).
 * - boundary-review.json summarises uncertain boundary sections and the
 *   footprints held out of the campus inventory for review.
 */
import { z } from 'zod';

export const DATA_SCHEMA_VERSION = 2;

export const lngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const verificationStatusSchema = z.enum(['verified', 'imported', 'estimated', 'unverified']);

/** One registered data source. Records reference it by `sourceId`. */
export const sourceRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url().optional(),
  license: z.string().optional(),
  attribution: z.string().optional(),
  retrievedAt: z.string().optional(),
  notes: z.string().optional(),
  /** Canonical licence URL (e.g. the CDLA-Permissive-2.0 text). */
  licenseUrl: z.string().url().optional(),
  /** Path (relative to the app root) of a shipped copy of the licence text, when the licence requires it. */
  licenseTextPath: z.string().min(1).optional(),
});

/**
 * Provenance attached to every source-dependent record. Ingesting a feature
 * from OSM makes it "imported", not "verified" — "verified" requires a dated
 * human check recorded in data/curated.
 */
export const provenanceSchema = z.object({
  sourceId: z.string().min(1),
  sourceRef: z.string().optional(),
  retrievedAt: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
  verificationStatus: verificationStatusSchema,
  notes: z.string().optional(),
});

export const campusZoneSchema = z.enum(['on-campus', 'off-campus-nearby']);
export const wheelchairSchema = z.enum(['yes', 'limited', 'no', 'unknown']);
/**
 * How a render height was chosen. 'studio-model' is an owner-placed Building Studio model
 * (docs/BUILDING_STUDIO_DESIGN.md change C1): illustrative, never a measurement. The data
 * pipeline never emits it; only the client merge of published studio buildings does.
 */
export const heightSourceSchema = z.enum(['osm-height', 'osm-levels-estimate', 'fallback', 'studio-model']);

export const placeKindSchema = z.enum([
  'building', // has (or is) a mapped footprint
  'facility', // a service/amenity point or area
  'gate', // campus entrance/gate
  'entrance', // building entrance
  'landmark',
  'area', // grounds, parks, pitches, parking areas
  'organization', // department/school/office with no verified map position
]);

export const placeSchema = z.object({
  id: z.string().min(1),
  /** Source name. `null` means the source has no name — never invent one. */
  name: z.string().min(1).nullable(),
  /** Truthful label shown in UI, e.g. "Unnamed building · 4 floors" when name is null. */
  displayName: z.string().min(1),
  aliases: z.array(z.string()),
  categoryId: z.string().min(1),
  subcategory: z.string().optional(),
  kind: placeKindSchema,
  /** Representative point. `null` = no dependable position (searchable, never routed). */
  location: lngLatSchema.nullable(),
  /** Building footprint id this place is, or is located in (a relation is also emitted). */
  buildingId: z.string().optional(),
  campusZone: campusZoneSchema,
  description: z.string().optional(),
  /** Raw OSM-style opening_hours string, parsed conservatively at runtime. */
  openingHours: z.string().optional(),
  contact: z
    .object({
      phone: z.string().optional(),
      email: z.string().optional(),
      website: z.string().url().optional(),
    })
    .optional(),
  wheelchair: wheelchairSchema,
  levels: z.number().int().positive().optional(),
  heightM: z.number().positive().optional(),
  heightSource: heightSourceSchema.optional(),
  /** Nearest routing-graph node and the straight connector length to it (inferred). */
  graphNodeId: z.number().int().nonnegative().optional(),
  connectorLengthM: z.number().nonnegative().optional(),
  provenance: provenanceSchema,
});

/**
 * places.json: the campus inventory of places. v2 rule: every place is
 * `campusZone: 'on-campus'` — off-campus POIs belong in context-places.json.
 */
export const placesFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  places: z.array(placeSchema).superRefine((places, ctx) => {
    places.forEach((p, i) => {
      if (p.campusZone !== 'on-campus')
        ctx.addIssue({
          code: 'custom',
          path: [i, 'campusZone'],
          message: `${p.id} is off campus; off-campus places belong in context-places.json`,
        });
    });
  }),
});

/**
 * context-places.json (v2, lazy): off-campus POIs for the opt-in "Nearby,
 * outside campus" layer. Same Place shape; every place is 'off-campus-nearby'.
 * Never part of campus search, counts or the directory unless that layer is on.
 */
export const contextPlacesFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  places: z.array(placeSchema).superRefine((places, ctx) => {
    places.forEach((p, i) => {
      if (p.campusZone !== 'off-campus-nearby')
        ctx.addIssue({
          code: 'custom',
          path: [i, 'campusZone'],
          message: `${p.id} is on campus; campus places belong in places.json`,
        });
      if (p.kind === 'building')
        ctx.addIssue({
          code: 'custom',
          path: [i, 'kind'],
          message: `${p.id}: off-campus buildings are never shipped (owner decision 2); use a point kind`,
        });
      if (p.buildingId !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: [i, 'buildingId'],
          message: `${p.id}: context places carry no footprint reference`,
        });
    });
  }),
});

export const relationTypeSchema = z.enum([
  'located_in',
  'accessed_via',
  'connected_by_path',
  'nearby',
  'part_of',
]);

/**
 * `connected_by_path` (G-29) states that a mapped walkway joins two places. It
 * is produced ONLY from explicit evidence: a curated record
 * (data/curated/path-connections.json) that cites the joining OSM way, such as
 * a covered walkway. It is never derived from graph connectivity or distance,
 * so it is always `method: 'curated'`, `inferred: false` and carries the way
 * id in `pathOsmWayId`. No such record exists today.
 */
export const relationSchema = z
  .object({
    id: z.string().min(1),
    type: relationTypeSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    /** true when derived from geometry rather than stated by a source. */
    inferred: z.boolean(),
    method: z.enum(['osm-containment', 'osm-entrance-on-outline', 'distance', 'curated']),
    distanceM: z.number().nonnegative().optional(),
    /** connected_by_path only: the OSM way of the cited path; it must exist in graph.json. */
    pathOsmWayId: z.number().int().positive().optional(),
    provenance: provenanceSchema,
  })
  .superRefine((r, ctx) => {
    if (r.type === 'connected_by_path') {
      if (r.method !== 'curated' || r.inferred)
        ctx.addIssue({
          code: 'custom',
          path: ['method'],
          message: `${r.id}: connected_by_path needs explicit evidence (method 'curated', inferred false)`,
        });
      if (r.pathOsmWayId === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['pathOsmWayId'],
          message: `${r.id}: connected_by_path must cite the joining path (pathOsmWayId)`,
        });
    } else if (r.pathOsmWayId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['pathOsmWayId'],
        message: `${r.id}: pathOsmWayId belongs to connected_by_path relations only`,
      });
    }
  });

export const relationsFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  relations: z.array(relationSchema),
});

export const graphEdgeSchema = z.object({
  id: z.number().int().nonnegative(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  lengthM: z.number().positive(),
  highway: z.string(),
  foot: z.boolean(),
  /** ride = may cycle; push = must dismount and walk the bike; no = prohibited. */
  bicycle: z.enum(['ride', 'push', 'no']),
  steps: z.boolean(),
  wheelchair: wheelchairSchema,
  /** true = cycling allowed only from→to. */
  onewayBicycle: z.boolean(),
  /** true = walking allowed only from→to (explicit oneway:foot only). */
  onewayFoot: z.boolean(),
  indoor: z.boolean(),
  surface: z.string().nullable(),
  name: z.string().nullable(),
  source: z.enum(['osm', 'curated-connector']),
  osmWayId: z.number().int().nullable(),
  /**
   * v2: true when the edge's midpoint lies inside the campus boundary. The
   * pipeline always sets it; it is optional only so hand-written test graphs
   * stay valid. Off-campus edges are real, legal public paths kept for context.
   */
  campus: z.boolean().optional(),
});

export const graphFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  /** Node i is nodes[i] = [lon, lat]. */
  nodes: z.array(lngLatSchema),
  edges: z.array(graphEdgeSchema),
});

const anyGeometrySchema = z.object({ type: z.string(), coordinates: z.unknown() });
/** Footprints are always areas. Coordinates are checked by src/geo/boundary.ts (invalid → 'uncertain', never dropped). */
export const polygonalGeometrySchema = z.object({
  type: z.enum(['Polygon', 'MultiPolygon']),
  coordinates: z.array(z.unknown()),
});

const featureCollection = <P extends z.ZodType, G extends z.ZodType = typeof anyGeometrySchema>(
  props: P,
  geometry?: G,
) =>
  z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(
      z.object({
        type: z.literal('Feature'),
        id: z.union([z.string(), z.number()]).optional(),
        geometry: (geometry ?? anyGeometrySchema) as G,
        properties: props,
      }),
    ),
  });

// ---------------------------------------------------------------------------
// Campus membership (v2). Rules: src/geo/boundary.ts classifyFootprint and
// docs/MODULE_CONTRACTS.md "v2 geographic contract".
// ---------------------------------------------------------------------------

/**
 * inside    — insideFraction ≥ 0.995 (or a curated decision).
 * crossing  — 0.005 < f < 0.995, f ≥ 0.5 and no conflicting evidence: in the campus inventory.
 * outside   — f ≤ 0.005 (or a curated decision). Never shipped as a footprint.
 * uncertain — invalid geometry, inside an open boundary-review section, or a crossing
 *             footprint that fails the inventory test. Held out of the inventory for review.
 */
export const campusStatusSchema = z.enum(['inside', 'crossing', 'outside', 'uncertain']);
/** Statuses that make a footprint part of the campus inventory. */
export const CAMPUS_INVENTORY_STATUSES = ['inside', 'crossing'] as const;

export const membershipMethodSchema = z.enum([
  'polygon-clip', // exact area fraction by polygon clipping in local metres
  'curated-decision', // a dated curated decision (data/curated/boundary-review.json)
  'none', // geometry invalid: no measurement possible
]);

export const membershipReasonCodeSchema = z.enum([
  'interior', // f ≥ 0.995
  'exterior', // f ≤ 0.005
  'crossing-majority', // 0.005 < f < 0.995, f ≥ 0.5, no conflicting evidence → included
  'crossing-minority', // 0.005 < f < 0.5 → uncertain
  'crossing-conflict', // f ≥ 0.5 but conflicting evidence (e.g. non-campus operator) → uncertain
  'review-section', // within an open boundary-review section → uncertain
  'invalid-geometry', // invalid polygon → uncertain (never auto-dropped)
  'curated-decision', // curated decision wins
]);

export const membershipDecisionSchema = z.enum(['auto', 'curated']);

/** Where a footprint's geometry comes from. Machine detections are NOT here: see detections.json. */
export const geometrySourceSchema = z.enum([
  'osm', // OpenStreetMap way/relation
  'curated', // dated curated trace/survey in data/curated
  'studio', // owner-placed Building Studio footprint (client merge only, change C1)
]);

/** 0 outline only (placeholder height); 1 + levels estimate; 2 + tagged height; 3 surveyed/verified. */
export const fidelityLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const levelsSourceSchema = z.enum(['osm-building-levels', 'curated']);

/** Map keys: grid references such as `C4-07` (docs/ISOMETRIC_AND_3D_DESIGN.md §7.3). */
export const DIRECTORY_KEY_RE = /^[A-Z][1-9]\d?-\d{2}$/;
export const directoryKeySchema = z.string().regex(DIRECTORY_KEY_RE);

/**
 * buildings.geojson feature properties (v2). Flat and primitive so MapLibre
 * expressions can read them. Three groups:
 *  - FACTS: identity, provenance, membership, geometry measurements and OSM tag
 *    pass-throughs. A tag pass-through is null when the tag is absent — never inferred.
 *  - DIRECTORY: map key and cited official block label (null unless cited).
 *  - RENDER (`render*` prefix): values chosen only so the building can be drawn.
 *    They are not measurements; `renderHeightSource` says how each was chosen.
 */
const buildingPropsV2Object = z.object({
  // --- identity (facts)
  /** Stable id: equals the building place id (`osm:way/…`, `cur:…`). */
  id: z.string().min(1),
  /** Source name; null = the source has none. Never invented. */
  name: z.string().min(1).nullable(),
  /** Honest label, e.g. "Unnamed building · 4 floors". */
  displayName: z.string().min(1),
  categoryId: z.string().min(1),

  // --- provenance / verification (facts)
  geometrySource: geometrySourceSchema,
  /** Manifest source id ('osm', 'curated:…'). */
  sourceId: z.string().min(1),
  /** Element reference in that source, e.g. 'way/422437885'. */
  sourceRef: z.string().min(1),
  retrievedAt: z.string().nullable(),
  verificationStatus: verificationStatusSchema,
  lastVerifiedAt: z.string().nullable(),

  // --- campus membership (facts derived from geometry + curated decisions)
  campusStatus: campusStatusSchema,
  /** true iff campusStatus is 'inside' or 'crossing'. Directory/search/counts/routing use only these. */
  inCampusInventory: z.boolean(),
  /** Share of the footprint area inside the boundary, 0–1 (4 decimals). null only for invalid geometry. */
  insideFraction: z.number().min(0).max(1).nullable(),
  /** Shortest distance between footprint and boundary line, metres (0 when they touch/cross). null for invalid geometry. */
  distanceToBoundaryM: z.number().nonnegative().nullable(),
  membershipMethod: membershipMethodSchema,
  membershipReasonCode: membershipReasonCodeSchema,
  /** Human-readable reason, generated from the rule that fired. */
  membershipReason: z.string().min(1),
  membershipDecision: membershipDecisionSchema,
  /** Curated decision source ('<kind>: <ref>'); null for 'auto'. */
  membershipDecisionSource: z.string().min(1).nullable(),
  /** Open boundary-review section the footprint falls in, else null. */
  reviewSectionId: z.string().min(1).nullable(),
  /** The point-on-surface test disagrees with the area-fraction test (recorded, never silently resolved). */
  pointAreaDisagreement: z.boolean(),

  // --- geometry measurements (facts, local-metre projection)
  /** Footprint area in m²; null only for invalid geometry. */
  areaM2: z.number().nonnegative().nullable(),
  /** Point-on-surface (keys, labels, routing anchors); mean of distinct vertices for invalid geometry. */
  anchorLon: z.number().min(-180).max(180),
  anchorLat: z.number().min(-90).max(90),
  /** OSM building:part present. */
  isBuildingPart: z.boolean(),

  // --- tag pass-throughs (facts; null when untagged)
  levels: z.number().positive().nullable(),
  levelsSource: levelsSourceSchema.nullable(),
  minLevel: z.number().nonnegative().nullable(),
  /** OSM `height` tag in metres (a mapper's measurement). */
  osmHeightM: z.number().positive().nullable(),
  /** OSM `min_height` tag in metres. */
  osmMinHeightM: z.number().nonnegative().nullable(),
  roofShape: z.string().min(1).nullable(),
  roofMaterial: z.string().min(1).nullable(),
  roofColour: z.string().min(1).nullable(),
  roofLevels: z.number().nonnegative().nullable(),
  buildingMaterial: z.string().min(1).nullable(),
  buildingColour: z.string().min(1).nullable(),

  // --- fidelity (how much of the drawn building is evidence)
  fidelityLevel: fidelityLevelSchema,
  fidelityReason: z.string().min(1),

  // --- directory
  directoryKey: directoryKeySchema.nullable(),
  directoryCell: z
    .string()
    .regex(/^[A-Z][1-9]\d?$/)
    .nullable(),
  /** Only from a curated alias citing a source that ties the label to this exact footprint. */
  officialBlockLabel: z.string().min(1).nullable(),
  officialBlockSourceId: z.string().min(1).nullable(),

  // --- RENDER ONLY (not facts)
  /** Extrusion top, metres. Only 'osm-height' is a sourced measurement. */
  renderHeightM: z.number().positive(),
  /** Extrusion base, metres. */
  renderMinHeightM: z.number().nonnegative(),
  renderHeightSource: heightSourceSchema,
});

type BuildingPropsV2Raw = z.infer<typeof buildingPropsV2Object>;

/** Cross-field invariants of BuildingPropsV2. Returns problems (empty = consistent). */
export function buildingPropsProblems(p: BuildingPropsV2Raw): string[] {
  const out: string[] = [];
  const inventory = p.campusStatus === 'inside' || p.campusStatus === 'crossing';
  if (p.inCampusInventory !== inventory)
    out.push('inCampusInventory must equal campusStatus ∈ {inside, crossing}');
  if (p.campusStatus === 'outside')
    out.push('footprints classified outside are never shipped (owner decision 2)');
  if ((p.areaM2 === null) !== (p.membershipReasonCode === 'invalid-geometry'))
    out.push('areaM2 is null exactly when the geometry is invalid');
  if ((p.insideFraction === null) !== (p.membershipReasonCode === 'invalid-geometry'))
    out.push('insideFraction is null exactly when the geometry is invalid');
  if (p.membershipReasonCode === 'invalid-geometry' && p.campusStatus !== 'uncertain')
    out.push('invalid geometry must be uncertain');
  if ((p.membershipDecision === 'curated') !== (p.membershipDecisionSource !== null))
    out.push('membershipDecisionSource is set exactly for curated decisions');
  if ((p.membershipDecision === 'curated') !== (p.membershipMethod === 'curated-decision'))
    out.push('membershipMethod is curated-decision exactly for curated decisions');
  if (p.membershipReasonCode === 'review-section' && p.reviewSectionId === null)
    out.push('review-section reason needs reviewSectionId');
  if ((p.officialBlockLabel === null) !== (p.officialBlockSourceId === null))
    out.push('officialBlockLabel and officialBlockSourceId are both set or both null');
  if (p.directoryKey !== null && !p.inCampusInventory)
    out.push('only campus-inventory buildings get a map key');
  if (
    p.directoryKey !== null &&
    p.directoryCell !== null &&
    !p.directoryKey.startsWith(`${p.directoryCell}-`)
  )
    out.push('directoryKey must start with directoryCell');
  if ((p.levels === null) !== (p.levelsSource === null))
    out.push('levels and levelsSource are both set or both null');
  if (p.renderMinHeightM >= p.renderHeightM) out.push('renderMinHeightM must be below renderHeightM');
  if (p.renderHeightSource === 'osm-height' && p.osmHeightM === null)
    out.push("'osm-height' needs osmHeightM");
  if (p.renderHeightSource === 'osm-levels-estimate' && p.levels === null)
    out.push("'osm-levels-estimate' needs levels");
  // An illustrative studio model is fidelity 0 (3 only when surveyed and verified, below).
  const expectedFidelity =
    p.renderHeightSource === 'fallback' || p.renderHeightSource === 'studio-model'
      ? 0
      : p.renderHeightSource === 'osm-levels-estimate'
        ? 1
        : 2;
  if (p.fidelityLevel === 3) {
    if (p.verificationStatus !== 'verified') out.push('fidelityLevel 3 requires verificationStatus verified');
  } else if (p.fidelityLevel !== expectedFidelity) {
    out.push(`fidelityLevel ${p.fidelityLevel} does not match renderHeightSource ${p.renderHeightSource}`);
  }
  return out;
}

export const buildingPropsSchema = buildingPropsV2Object.superRefine((p, ctx) => {
  for (const message of buildingPropsProblems(p)) ctx.addIssue({ code: 'custom', message });
});
export const buildingsFileSchema = featureCollection(buildingPropsSchema, polygonalGeometrySchema);

// ---------------------------------------------------------------------------
// Machine-detected footprints (v2, lazy): a separate, flat, dashed
// "Unverified detected footprints" layer. Never extruded, searched, routed,
// keyed or counted as campus buildings. Never shifted to "correct" the
// documented ~5.6 m MS–OSM offset.
// ---------------------------------------------------------------------------

export const detectionSourceSchema = z.enum(['microsoft-ml', 'google-open-buildings']);
/** Manifest source id that must be present (with licence) when a detection source is used. */
export const DETECTION_MANIFEST_SOURCE_IDS = {
  'microsoft-ml': 'microsoft-ml-buildings',
  'google-open-buildings': 'google-open-buildings',
} as const satisfies Record<z.infer<typeof detectionSourceSchema>, string>;
export const DETECTION_ID_RE = /^det:(microsoft-ml|google-open-buildings):[0-9a-f]{8,64}$/;
export const detectionReviewStatusSchema = z.enum(['unreviewed', 'confirmed', 'rejected']);

/**
 * 'footprint' = the source's own polygon (Microsoft); 'point' = a source
 * centroid with no polygon available (Google Open Buildings points file).
 * A point is never drawn as a shape and its area is the source's reported area.
 */
export const detectionGeometryKindSchema = z.enum(['footprint', 'point']);

export const detectionPropsSchema = z
  .object({
    /** 'det:<source>:<hash of source geometry>' — stable for an unchanged source release. */
    id: z.string().regex(DETECTION_ID_RE),
    source: detectionSourceSchema,
    geometryKind: detectionGeometryKindSchema,
    /** Release/tile reference in the source, e.g. 'quadkey 123121013, release 2026-02-03'. */
    sourceRef: z.string().min(1),
    areaM2: z.number().positive(),
    /** Source confidence 0–1; null when the source gives none (MS publishes -1 → null). */
    confidence: z.number().min(0).max(1).nullable(),
    /** OSM footprint this detection matches (IoU/coverage rule in the pipeline), else null. */
    matchedOsmId: z.string().min(1).nullable(),
    matchIoU: z.number().min(0).max(1).nullable(),
    /** Independent evidence ids (another detection source, an OSM id, a survey). */
    confirmedBy: z.array(z.string().min(1)),
    campusStatus: campusStatusSchema,
    insideFraction: z.number().min(0).max(1).nullable(),
    reviewSectionId: z.string().min(1).nullable(),
    reviewStatus: detectionReviewStatusSchema,
  })
  .superRefine((p, ctx) => {
    if (!p.id.startsWith(`det:${p.source}:`))
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'id prefix must match source' });
    if (p.campusStatus === 'outside')
      ctx.addIssue({
        code: 'custom',
        path: ['campusStatus'],
        message: 'outside detections are never shipped',
      });
    if ((p.matchedOsmId === null) !== (p.matchIoU === null))
      ctx.addIssue({
        code: 'custom',
        path: ['matchIoU'],
        message: 'matchIoU is set exactly when matchedOsmId is',
      });
  });
export const detectionGeometrySchema = z.union([
  polygonalGeometrySchema,
  z.object({ type: z.literal('Point'), coordinates: lngLatSchema }),
]);
export const detectionsFileSchema = featureCollection(
  detectionPropsSchema,
  detectionGeometrySchema,
).superRefine((fc, ctx) => {
  fc.features.forEach((f, i) => {
    const isPoint = f.geometry.type === 'Point';
    if (isPoint !== (f.properties.geometryKind === 'point'))
      ctx.addIssue({
        code: 'custom',
        path: ['features', i, 'properties', 'geometryKind'],
        message: `geometryKind '${f.properties.geometryKind}' does not match geometry type ${f.geometry.type}`,
      });
    if (isPoint && f.properties.source !== 'google-open-buildings')
      ctx.addIssue({
        code: 'custom',
        path: ['features', i, 'geometry'],
        message: 'only google-open-buildings detections may be points (no polygon available)',
      });
  });
});

export const basemapLayerSchema = z.enum([
  'road-major',
  'road',
  'service',
  'path',
  'steps',
  'landuse',
  'green',
  'water',
  'pitch',
  'parking',
]);
export const basemapPropsSchema = z.object({
  id: z.string(),
  layer: basemapLayerSchema,
  subclass: z.string(),
  name: z.string().nullable(),
});
export const basemapFileSchema = featureCollection(basemapPropsSchema);

export const boundaryFileSchema = featureCollection(
  z.object({ id: z.string(), name: z.string(), sourceRef: z.string() }),
  polygonalGeometrySchema,
);

// ---------------------------------------------------------------------------
// Boundary review (curated input + generated summary)
// ---------------------------------------------------------------------------

export const reviewGeometrySchema = z.union([
  z.object({ type: z.literal('LineString'), coordinates: z.array(lngLatSchema).min(2) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(lngLatSchema).min(4)).min(1) }),
]);

/**
 * A stretch of the campus boundary whose position is not trusted. Footprints
 * touching the section geometry or within `bufferM` of it are 'uncertain'
 * while the section is open.
 */
export const boundaryReviewSectionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
  title: z.string().min(1),
  status: z.enum(['open', 'resolved']),
  reason: z.string().min(1),
  /** Verifiable evidence (OSM ids, audit sections, imagery notes). Never invented. */
  evidence: z.array(z.string().min(1)).min(1),
  bufferM: z.number().nonnegative(),
  geometry: reviewGeometrySchema,
  /** How the section was resolved (required when status is 'resolved'). */
  resolution: z.string().min(1).optional(),
});

export const membershipDecisionSourceKindSchema = z.enum([
  'owner-confirmation',
  'official-publication',
  'physical-survey',
  'osm-boundary-fix',
]);

/** A dated human decision about one footprint's campus membership. Wins over every automatic rule except invalid geometry. */
export const curatedMembershipDecisionSchema = z.object({
  featureId: z.string().min(1),
  status: z.enum(['inside', 'crossing', 'outside']),
  decidedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.object({ kind: membershipDecisionSourceKindSchema, ref: z.string().min(1) }),
  note: z.string().optional(),
});

/** data/curated/boundary-review.json (committed; read by the pipeline, server and admin). */
export const curatedBoundaryReviewSchema = z.object({
  $comment: z.string().optional(),
  sections: z.array(boundaryReviewSectionSchema),
  decisions: z.array(curatedMembershipDecisionSchema),
});

export const boundaryReviewItemSchema = z.object({
  /** Building/detection/place id. */
  id: z.string().min(1),
  kind: z.enum(['building', 'detection', 'place']),
  displayName: z.string().min(1),
  campusStatus: campusStatusSchema,
  insideFraction: z.number().min(0).max(1).nullable(),
  distanceToBoundaryM: z.number().nonnegative().nullable(),
  membershipReasonCode: membershipReasonCodeSchema,
  membershipReason: z.string().min(1),
  reviewSectionId: z.string().min(1).nullable(),
  pointAreaDisagreement: z.boolean(),
  anchor: lngLatSchema.nullable(),
  decision: membershipDecisionSchema,
  decisionSource: z.string().min(1).nullable(),
});

/** boundary-review.json (generated, lazy): everything held out of, or near the edge of, the inventory. */
export const boundaryReviewFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  /** e.g. 'relation/21599790 v1'. */
  boundarySourceRef: z.string().min(1),
  /** Thresholds the classification used (echoed so the file is self-describing). */
  rules: z.object({
    insideMinFraction: z.number(),
    outsideMaxFraction: z.number(),
    crossingInventoryMinFraction: z.number(),
  }),
  sections: z.array(boundaryReviewSectionSchema.extend({ affectedIds: z.array(z.string().min(1)) })),
  decisions: z.array(curatedMembershipDecisionSchema),
  /** Every 'uncertain' footprint plus every 'crossing' one, sorted by id. */
  items: z.array(boundaryReviewItemSchema),
});

/** Keys of `manifest.files` a v2 dataset must list. */
export const REQUIRED_MANIFEST_FILE_KEYS = [
  'boundary',
  'buildings',
  'basemap',
  'places',
  'relations',
  'graph',
  'quality',
  'contextPlaces',
  'detections',
  'boundaryReview',
] as const;

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(DATA_SCHEMA_VERSION),
    /** Content hash of all data files — changes iff data changes (deterministic). */
    datasetVersion: z.string().min(6),
    /** Latest source retrieval time (not wall-clock), keeping rebuilds deterministic. */
    builtFrom: z.string(),
    sources: z.array(sourceRecordSchema),
    files: z.record(z.string(), z.object({ path: z.string(), bytes: z.number().int(), sha256: z.string() })),
    /** Every count is derived from the processed files (see docs/MODULE_CONTRACTS.md for the keys). */
    counts: z.record(z.string(), z.number().int().nonnegative()),
    /** [west, south, east, north] of the verified campus boundary. */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  })
  .superRefine((m, ctx) => {
    for (const k of REQUIRED_MANIFEST_FILE_KEYS)
      if (!(k in m.files))
        ctx.addIssue({ code: 'custom', path: ['files', k], message: `missing file entry '${k}'` });
    const ids = m.sources.map((s) => s.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['sources'], message: 'duplicate source id' });
    if (!ids.includes('osm'))
      ctx.addIssue({ code: 'custom', path: ['sources'], message: "the 'osm' source is required" });
  });

export type LngLat = z.infer<typeof lngLatSchema>;
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type CampusZone = z.infer<typeof campusZoneSchema>;
export type Wheelchair = z.infer<typeof wheelchairSchema>;
export type HeightSource = z.infer<typeof heightSourceSchema>;
export type PlaceKind = z.infer<typeof placeKindSchema>;
export type Place = z.infer<typeof placeSchema>;
export type PlacesFile = z.infer<typeof placesFileSchema>;
export type ContextPlacesFile = z.infer<typeof contextPlacesFileSchema>;
export type RelationType = z.infer<typeof relationTypeSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type RelationsFile = z.infer<typeof relationsFileSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphFile = z.infer<typeof graphFileSchema>;
export type CampusStatus = z.infer<typeof campusStatusSchema>;
export type MembershipMethod = z.infer<typeof membershipMethodSchema>;
export type MembershipReasonCode = z.infer<typeof membershipReasonCodeSchema>;
export type MembershipDecision = z.infer<typeof membershipDecisionSchema>;
export type GeometrySource = z.infer<typeof geometrySourceSchema>;
export type FidelityLevel = z.infer<typeof fidelityLevelSchema>;
export type LevelsSource = z.infer<typeof levelsSourceSchema>;
export type BuildingProps = z.infer<typeof buildingPropsSchema>;
/** Alias naming the v2 shape explicitly (docs/ISOMETRIC_AND_3D_DESIGN.md §11.3). */
export type BuildingPropsV2 = BuildingProps;
export type BuildingsFile = z.infer<typeof buildingsFileSchema>;
export type DetectionSource = z.infer<typeof detectionSourceSchema>;
export type DetectionReviewStatus = z.infer<typeof detectionReviewStatusSchema>;
export type DetectionGeometryKind = z.infer<typeof detectionGeometryKindSchema>;
export type DetectionProps = z.infer<typeof detectionPropsSchema>;
export type DetectionsFile = z.infer<typeof detectionsFileSchema>;
export type BasemapLayer = z.infer<typeof basemapLayerSchema>;
export type BasemapProps = z.infer<typeof basemapPropsSchema>;
export type BasemapFile = z.infer<typeof basemapFileSchema>;
export type BoundaryFile = z.infer<typeof boundaryFileSchema>;
export type ReviewGeometry = z.infer<typeof reviewGeometrySchema>;
export type BoundaryReviewSection = z.infer<typeof boundaryReviewSectionSchema>;
export type CuratedMembershipDecision = z.infer<typeof curatedMembershipDecisionSchema>;
export type CuratedBoundaryReview = z.infer<typeof curatedBoundaryReviewSchema>;
export type BoundaryReviewItem = z.infer<typeof boundaryReviewItemSchema>;
export type BoundaryReviewFile = z.infer<typeof boundaryReviewFileSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/** true for footprints that belong to the campus inventory (directory, search, counts, extrusion). */
export function isCampusInventoryStatus(status: CampusStatus): boolean {
  return status === 'inside' || status === 'crossing';
}

/** File names inside public/data/. */
export const DATA_FILES = {
  manifest: 'manifest.json',
  boundary: 'boundary.geojson',
  buildings: 'buildings.geojson',
  basemap: 'basemap.geojson',
  places: 'places.json',
  relations: 'relations.json',
  graph: 'graph.json',
  quality: 'quality-report.json',
  /** v2, lazy: off-campus POIs for the opt-in context layer. */
  contextPlaces: 'context-places.json',
  /** v2, lazy: machine-detected footprints (unverified layer). */
  detections: 'detections.geojson',
  /** v2, lazy: boundary-review summary (admin data-quality, docs). */
  boundaryReview: 'boundary-review.json',
} as const;

/** Files loadCampusData() fetches at startup. The others are lazy (src/data/loader.ts createOptionalLoaders). */
export const STARTUP_DATA_FILE_KEYS = [
  'boundary',
  'buildings',
  'basemap',
  'places',
  'relations',
  'graph',
] as const;

/**
 * data/curated/directory-keys.json — the committed map-key lock
 * (docs/ISOMETRIC_AND_3D_DESIGN.md §7.3). `npm run data:build` only reads it;
 * only the explicit `data:keys` command writes it.
 */
export const directoryKeysLockSchema = z
  .object({
    $comment: z.string(),
    version: z.number().int().positive(),
    /** Must equal APP_CONFIG.directory.gridOrigin. */
    gridOrigin: lngLatSchema,
    cellM: z.number().positive(),
    /** buildingId → key. */
    keys: z.record(z.string().min(1), directoryKeySchema),
    /** key → retirement record. Retired keys are never reused within a version. */
    retired: z.record(
      directoryKeySchema,
      z.object({
        id: z.string().min(1),
        retiredAt: z.string().min(1),
        replacedBy: z.string().min(1).optional(),
      }),
    ),
  })
  .superRefine((lock, ctx) => {
    const seen = new Map<string, string>();
    for (const [id, key] of Object.entries(lock.keys)) {
      const prev = seen.get(key);
      if (prev)
        ctx.addIssue({ code: 'custom', path: ['keys', id], message: `key ${key} also used by ${prev}` });
      seen.set(key, id);
      if (key in lock.retired)
        ctx.addIssue({ code: 'custom', path: ['keys', id], message: `key ${key} is retired` });
    }
  });
export type DirectoryKeysLock = z.infer<typeof directoryKeysLockSchema>;
