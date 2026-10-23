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
 */
import { z } from 'zod';

export const DATA_SCHEMA_VERSION = 1;

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
export const heightSourceSchema = z.enum(['osm-height', 'osm-levels-estimate', 'fallback']);

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

export const placesFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  places: z.array(placeSchema),
});

export const relationTypeSchema = z.enum([
  'located_in',
  'accessed_via',
  'connected_by_path',
  'nearby',
  'part_of',
]);

export const relationSchema = z.object({
  id: z.string().min(1),
  type: relationTypeSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  /** true when derived from geometry rather than stated by a source. */
  inferred: z.boolean(),
  method: z.enum(['osm-containment', 'osm-entrance-on-outline', 'graph-path', 'distance', 'curated']),
  distanceM: z.number().nonnegative().optional(),
  provenance: provenanceSchema,
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
});

export const graphFileSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  /** Node i is nodes[i] = [lon, lat]. */
  nodes: z.array(lngLatSchema),
  edges: z.array(graphEdgeSchema),
});

const featureCollection = <P extends z.ZodType>(props: P) =>
  z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(
      z.object({
        type: z.literal('Feature'),
        id: z.union([z.string(), z.number()]).optional(),
        geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
        properties: props,
      }),
    ),
  });

export const buildingPropsSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  displayName: z.string(),
  levels: z.number().nullable(),
  /** Render height. Only `osm-height` is a sourced measurement. */
  heightM: z.number().positive(),
  minHeightM: z.number().nonnegative(),
  heightSource: heightSourceSchema,
  categoryId: z.string(),
  campusZone: campusZoneSchema,
});
export const buildingsFileSchema = featureCollection(buildingPropsSchema);

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
);

export const manifestSchema = z.object({
  schemaVersion: z.literal(DATA_SCHEMA_VERSION),
  /** Content hash of all data files — changes iff data changes (deterministic). */
  datasetVersion: z.string().min(6),
  /** Latest source retrieval time (not wall-clock), keeping rebuilds deterministic. */
  builtFrom: z.string(),
  sources: z.array(sourceRecordSchema),
  files: z.record(z.string(), z.object({ path: z.string(), bytes: z.number().int(), sha256: z.string() })),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  /** [west, south, east, north] of the verified campus boundary. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
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
export type RelationType = z.infer<typeof relationTypeSchema>;
export type Relation = z.infer<typeof relationSchema>;
export type RelationsFile = z.infer<typeof relationsFileSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphFile = z.infer<typeof graphFileSchema>;
export type BuildingProps = z.infer<typeof buildingPropsSchema>;
export type BuildingsFile = z.infer<typeof buildingsFileSchema>;
export type BasemapLayer = z.infer<typeof basemapLayerSchema>;
export type BasemapProps = z.infer<typeof basemapPropsSchema>;
export type BasemapFile = z.infer<typeof basemapFileSchema>;
export type BoundaryFile = z.infer<typeof boundaryFileSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

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
} as const;
