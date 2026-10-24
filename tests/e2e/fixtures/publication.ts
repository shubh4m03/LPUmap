/**
 * A deterministic, clearly SYNTHETIC owner publication (GET /api/locations,
 * v2) for the e2e suite. It is served only through Playwright route
 * interception (never a live backend) and never shipped: nothing here is
 * written to public/data or dist.
 *
 * Every name says "E2E" and "synthetic"/"test fixture"; nothing claims to be a
 * real LPU building. Positions are chosen at run time from the shipped
 * dataset (empty campus ground next to a walkable path), so the records pass
 * the same membership and access-node rules the server applies.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  starterTemplate,
  modelFromVariant,
  templateRefFor,
} from '../../../src/building-studio/asset-library.ts';
import { deriveFootprint } from '../../../src/building-studio/footprint.ts';
import {
  publishedStudioBuildingSchema,
  type ModelConfigV1,
  type PublishedStudioBuilding,
} from '../../../src/building-studio/schema.ts';
import { membershipForPublish } from '../../../src/building-studio/validate.ts';
import { boundaryPolygons, campusZoneFor } from '../../../src/community/geo.ts';
import {
  PUBLICATION_SCHEMA_VERSION,
  publicationSchema,
  type Publication,
  type PublishedLocation,
} from '../../../src/community/schema.ts';
import { CATEGORIES } from '../../../src/config/categories.ts';
import {
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  graphFileSchema,
  type LngLat,
} from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { boundaryFromFeatureCollection, classifyFootprint } from '../../../src/geo/boundary.ts';

const DATA_DIR = fileURLToPath(new URL('../../../public/data/', import.meta.url));
const readJson = (file: string): unknown => JSON.parse(readFileSync(DATA_DIR + file, 'utf8'));

const BOUNDARY = boundaryFileSchema.parse(readJson('boundary.geojson'));
const REVIEW = boundaryReviewFileSchema.parse(readJson('boundary-review.json'));
const BUILDINGS = buildingsFileSchema.parse(readJson('buildings.geojson')).features;
const GRAPH = graphFileSchema.parse(readJson('graph.json'));
const CAMPUS = boundaryFromFeatureCollection(BOUNDARY);
const POLYGONS = boundaryPolygons(BOUNDARY);

const PUBLISHED_AT = '2026-10-24T05:00:00.000Z';
const M_PER_DEG_LAT = 111_320;

/** Studio ids: `stu:` + lower-case base32 (a–z, 2–7). */
export const E2E_HALL_ID = 'stu:eeeeeeeeeeeeeeeeeeeeehall';
export const E2E_KIOSK_ID = 'stu:eeeeeeeeeeeeeeeeeeeekiosk';
export const E2E_HALL_NAME = 'E2E fixture hall (synthetic)';
export const E2E_KIOSK_NAME = 'E2E fixture kiosk (synthetic)';
export const E2E_DRAFT_NAME = 'E2E draft building (must never appear)';
export const E2E_ARCHIVED_NAME = 'E2E archived building (must never appear)';
export const E2E_FACILITY_ID = 'own:e2e-synthetic-canteen';
export const E2E_FACILITY_NAME = 'E2E Synthetic Canteen (test fixture)';

const walkable = new Set<number>();
for (const e of GRAPH.edges)
  if (e.foot) {
    walkable.add(e.from);
    walkable.add(e.to);
  }
const footNodes = [...walkable].sort((a, b) => a - b);

/** Every building vertex, for a cheap "stay clear of mapped buildings" test. */
const buildingVertices: LngLat[] = BUILDINGS.flatMap((f) =>
  (f.geometry.type === 'Polygon'
    ? (f.geometry.coordinates as LngLat[][])
    : (f.geometry.coordinates as LngLat[][][]).flat()
  ).flat(),
);

const north = (p: LngLat, metres: number): LngLat => [p[0], p[1] + metres / M_PER_DEG_LAT];

interface Placed {
  model: ModelConfigV1;
  record: Omit<PublishedStudioBuilding, 'id' | 'identity' | 'accessNodeId' | 'templateRef'>;
  nodeId: number;
}

/**
 * The first walkable node (by index) with free ground north of it: the model
 * stands `gapM` north of the node, classifies 'inside' with the shipped
 * boundary review, and keeps `clearM` from every mapped building vertex.
 */
function place(
  templateId: string,
  variantId: string,
  avoid: readonly LngLat[],
  opts: { gapM?: number; clearM?: number; avoidM?: number } = {},
): Placed {
  const entry = starterTemplate(templateId);
  const variant = entry?.definition.variants.find((v) => v.id === variantId);
  if (!entry || !variant) throw new Error(`starter template ${templateId}/${variantId} is missing`);
  const { gapM = 6, clearM = 25, avoidM = 250 } = opts;
  for (const nodeId of footNodes) {
    const node = GRAPH.nodes[nodeId]!;
    if (campusZoneFor(node, POLYGONS) !== 'on-campus') continue;
    if (avoid.some((a) => haversineM(a, node) < avoidM)) continue;
    const half = variant.defaults.lengthM / 2;
    const anchor = north(node, half + gapM);
    const reach = Math.hypot(variant.defaults.widthM, variant.defaults.lengthM) / 2 + clearM;
    if (buildingVertices.some((v) => haversineM(v, anchor) < reach)) continue;
    const model = modelFromVariant(variant, { anchor, rotationDeg: 0 });
    const fp = deriveFootprint(model);
    if (!fp.ok) continue;
    const m = classifyFootprint(
      { id: 'stu:candidate', geometry: fp.footprint },
      CAMPUS,
      REVIEW.sections,
      REVIEW.decisions,
    );
    if (m.status !== 'inside') continue;
    const membership = membershipForPublish(m, { id: 'stu:candidate', version: 1 });
    if (!membership) continue;
    return {
      model,
      nodeId,
      record: {
        targetId: null,
        version: 1,
        publishedAt: PUBLISHED_AT,
        verification: { status: 'unverified' },
        accuracyClass: entry.definition.accuracyClass,
        model,
        footprint: fp.footprint,
        footprintAreaM2: Math.round(fp.areaM2 * 100) / 100,
        membership,
        positionCorrected: false,
      },
    };
  }
  throw new Error(`no free campus ground found for the ${templateId} fixture`);
}

function templateRef(templateId: string, variantId: string) {
  return templateRefFor(starterTemplate(templateId)!.definition, variantId);
}

const hall = place('lecture-hall', 'gable', []);
const kiosk = place('canteen-kiosk', 'front-canopy', [hall.model.anchor]);

/** Routable: the owner chose the walkable node just south of it as its access point. */
export const E2E_HALL: PublishedStudioBuilding = publishedStudioBuildingSchema.parse({
  ...hall.record,
  id: E2E_HALL_ID,
  identity: {
    name: E2E_HALL_NAME,
    aliases: ['E2E-HALL'],
    categoryId: 'academic',
    subtype: null,
    description: 'Synthetic end-to-end test record. Not a real building.',
    directoryVisible: true,
  },
  templateRef: templateRef('lecture-hall', 'gable'),
  accessNodeId: hall.nodeId,
});

/** Not routable: no access node (routing is never inferred from where a model stands). */
export const E2E_KIOSK: PublishedStudioBuilding = publishedStudioBuildingSchema.parse({
  ...kiosk.record,
  id: E2E_KIOSK_ID,
  identity: {
    name: E2E_KIOSK_NAME,
    aliases: [],
    categoryId: 'building',
    subtype: null,
    description: 'Synthetic end-to-end test record. Not a real building.',
    directoryVisible: true,
  },
  templateRef: templateRef('canteen-kiosk', 'front-canopy'),
  accessNodeId: null,
});

/** Ground centres of the fixture buildings (the model anchors). */
export const E2E_HALL_ANCHOR: LngLat = hall.model.anchor;
export const E2E_KIOSK_ANCHOR: LngLat = kiosk.model.anchor;

/**
 * A quick-action category with a named, routable place: an owner location on a
 * walkable node, far from the fixture buildings (the campus-only dataset has none).
 */
function facility(): { categoryLabel: string; location: PublishedLocation } {
  const category = CATEGORIES.find((c) => c.nearestAction);
  if (!category) throw new Error('no quick-action category is configured');
  const nodeId = footNodes.find((n) => {
    const p = GRAPH.nodes[n]!;
    return (
      campusZoneFor(p, POLYGONS) === 'on-campus' &&
      haversineM(p, hall.model.anchor) > 200 &&
      haversineM(p, kiosk.model.anchor) > 200
    );
  });
  if (nodeId === undefined) throw new Error('no walkable campus node for the facility fixture');
  return {
    categoryLabel: category.label,
    location: {
      id: E2E_FACILITY_ID,
      origin: 'owner',
      name: E2E_FACILITY_NAME,
      categoryId: category.id,
      location: GRAPH.nodes[nodeId]!,
      description: 'Synthetic end-to-end test record. Not a real place.',
      wheelchair: 'unknown',
      verificationStatus: 'unverified',
      accessNodeId: nodeId,
      revision: 1,
      updatedAt: PUBLISHED_AT,
    },
  };
}

export const E2E_FACILITY = facility();

/** A record shaped like a published one, used only inside keys the public schema strips. */
const leaked = (id: string, name: string) => ({
  ...E2E_KIOSK,
  id,
  identity: { ...E2E_KIOSK.identity!, name },
});

/**
 * The response body. `drafts` and `archived` are what a misbehaving server
 * might leak next to the public lists; the app must never show them.
 */
export function syntheticPublicationBody(): Record<string, unknown> {
  const publication: Publication = {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    publicationVersion: 42,
    generatedAt: PUBLISHED_AT,
    locations: [E2E_FACILITY.location],
    overrides: [],
    buildings: [E2E_HALL, E2E_KIOSK].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  publicationSchema.parse(publication); // fail fast if the fixture drifts from the contract
  return {
    ...publication,
    drafts: [leaked('stu:eeeeeeeeeeeeeeeeeeeeedraft', E2E_DRAFT_NAME)],
    archived: [leaked('stu:eeeeeeeeeeeeeeeeeearchived', E2E_ARCHIVED_NAME)],
  };
}
