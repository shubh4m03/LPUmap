/**
 * Real places for the e2e workflows, chosen at run time from the shipped
 * dataset (public/data) — never hardcoded guesses. Routes are computed with
 * the app's own router on the same graph file, so the coordinates fed to the
 * browser as GPS fixes lie on the route the app draws.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../../../src/config/categories.ts';
import type { GraphFile, LngLat, Place } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { E2E_FACILITY, E2E_FACILITY_ID, E2E_FACILITY_NAME } from './publication.ts';
import {
  createRouter,
  type RouteEndpoint,
  type RouteOk,
  type RouteProfileId,
  type RouteResult,
} from '../../../src/routing/index.ts';

const DATA_DIR = fileURLToPath(new URL('../../../public/data/', import.meta.url));
const readJson = <T>(file: string): T => JSON.parse(readFileSync(DATA_DIR + file, 'utf8')) as T;

interface BuildingFeature {
  geometry: { type: string; coordinates: unknown };
  properties: { id: string; renderHeightM: number };
}

export const PLACES: readonly Place[] = readJson<{ places: Place[] }>('places.json').places;
const GRAPH = readJson<GraphFile>('graph.json');
const BUILDINGS = readJson<{ features: BuildingFeature[] }>('buildings.geojson').features;
const router = createRouter(GRAPH);

const nameCounts = new Map<string, number>();
for (const p of PLACES) {
  if (!p.name) continue;
  const key = p.name.toLowerCase();
  nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
}
/** A name that identifies exactly one record, so a search for it is unambiguous. */
const uniqueName = (p: Place) =>
  p.name !== null && p.name !== undefined && nameCounts.get(p.name.toLowerCase()) === 1;

export type LocatedPlace = Place & { name: string; location: LngLat; graphNodeId: number };

const isRoutable = (p: Place): p is LocatedPlace =>
  uniqueName(p) && p.location !== null && typeof p.graphNodeId === 'number';

export function endpointOf(p: LocatedPlace): RouteEndpoint {
  return { kind: 'place', placeId: p.id, label: p.displayName, location: p.location, nodeId: p.graphNodeId };
}

function footprintOf(id: string): BuildingFeature | undefined {
  return BUILDINGS.find((f) => f.properties.id === id);
}

/** Named on-campus buildings with a footprint, a map position and a path-network node. */
const CAMPUS_BUILDINGS: LocatedPlace[] = PLACES.filter(
  (p): p is LocatedPlace =>
    isRoutable(p) && p.kind === 'building' && p.campusZone === 'on-campus' && footprintOf(p.id) !== undefined,
).sort((a, b) => a.name.localeCompare(b.name));

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`The dataset has no ${what}; the e2e fixture cannot pick one.`);
  return value;
}

/** Workflow A / B target: the tallest named on-campus building (easiest to hit when extruded). */
export const CAMPUS_BUILDING: LocatedPlace = required(
  [...CAMPUS_BUILDINGS].sort(
    (a, b) =>
      (footprintOf(b.id)?.properties.renderHeightM ?? 0) - (footprintOf(a.id)?.properties.renderHeightM ?? 0),
  )[0],
  'named on-campus building with a footprint and graph node',
);

/** The route the app shows first: best of `alternatives()` with the default 'shortest' preference. */
export function computeRoute(
  from: LocatedPlace,
  to: LocatedPlace,
  profile: RouteProfileId = 'walk',
): RouteResult {
  const [best] = router.alternatives({
    from: endpointOf(from),
    to: endpointOf(to),
    profile,
    preference: 'shortest',
  });
  return (
    best ?? router.route({ from: endpointOf(from), to: endpointOf(to), profile, preference: 'shortest' })
  );
}

function walkRoute(from: LocatedPlace, to: LocatedPlace): RouteOk | null {
  const r = computeRoute(from, to);
  return r.ok ? r : null;
}

/**
 * Workflow C / D: the longest walking route between two named, located places
 * (on-campus buildings first), so tracking has room for several fixes.
 */
function pickRoutablePair(): { from: LocatedPlace; to: LocatedPlace; route: RouteOk } {
  let best: { from: LocatedPlace; to: LocatedPlace; route: RouteOk } | undefined;
  for (const from of CAMPUS_BUILDINGS) {
    for (const to of CAMPUS_BUILDINGS) {
      if (from === to) continue;
      const route = walkRoute(from, to);
      if (route && route.coordinates.length > 2 && (!best || route.distanceM > best.route.distanceM))
        best = { from, to, route };
    }
  }
  return required(best, 'pair of named on-campus buildings connected by a walking route');
}

export const ROUTE_PAIR = pickRoutablePair();

/**
 * Workflow E: a quick-action category that has a named, located place to open,
 * or null when the dataset has none (the campus-only v2 data has no named,
 * routable food/finance/water/washroom/gate place). Callers then use
 * SYNTHETIC_FACILITY with the synthetic publication.
 */
function pickFacility(): { categoryLabel: string; place: LocatedPlace } | null {
  for (const c of CATEGORIES.filter((cat) => cat.nearestAction)) {
    const place = PLACES.filter(
      (p): p is LocatedPlace => isRoutable(p) && p.categoryId === c.id && p.kind !== 'organization',
    ).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (place) return { categoryLabel: c.label, place };
  }
  return null;
}

export const FACILITY = pickFacility();

/** What a facility test needs to know about its place. */
export interface FacilityTarget {
  categoryLabel: string;
  place: { id: string; name: string; displayName: string };
}

/**
 * The synthetic routable facility of fixtures/publication.ts (an owner location
 * on a walkable node). Present only when the test enables `syntheticPublication`.
 */
export const SYNTHETIC_FACILITY: FacilityTarget = {
  categoryLabel: E2E_FACILITY.categoryLabel,
  place: { id: E2E_FACILITY_ID, name: E2E_FACILITY_NAME, displayName: E2E_FACILITY_NAME },
};

/** Interior point of a building footprint: the vertex average, nudged inside if needed. */
export function footprintCentre(id: string): LngLat {
  const f = required(footprintOf(id), `footprint for ${id}`);
  const ring = (
    f.geometry.type === 'Polygon'
      ? (f.geometry.coordinates as LngLat[][])[0]
      : (f.geometry.coordinates as LngLat[][][])[0]?.[0]
  ) as LngLat[] | undefined;
  const pts = required(ring, `outer ring for ${id}`).slice(0, -1);
  const avg: LngLat = [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
  return avg;
}

/**
 * A point `metres` to the side of `a → b` (perpendicular, local flat-earth
 * approximation, fine at campus scale).
 */
export function offsetPerpendicular(a: LngLat, b: LngLat, metres: number): LngLat {
  const mPerDegLat = 111_320;
  const mPerDegLon = mPerDegLat * Math.cos((a[1] * Math.PI) / 180);
  const dx = (b[0] - a[0]) * mPerDegLon;
  const dy = (b[1] - a[1]) * mPerDegLat;
  const len = Math.hypot(dx, dy) || 1;
  // Left-hand normal of the segment direction.
  const nx = -dy / len;
  const ny = dx / len;
  return [a[0] + (nx * metres) / mPerDegLon, a[1] + (ny * metres) / mPerDegLat];
}

/** Points every `stepM` metres along a polyline (start and end included). */
export function resample(coords: readonly LngLat[], stepM: number): LngLat[] {
  const out: LngLat[] = [];
  const first = coords[0];
  if (!first) return out;
  out.push(first);
  // Distance walked since the last emitted point, carried across vertices.
  let since = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const seg = haversineM(a, b);
    let t = stepM - since;
    while (t <= seg) {
      const f = t / seg;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      t += stepM;
    }
    since = seg - (t - stepM);
  }
  const last = coords[coords.length - 1]!;
  if (haversineM(out[out.length - 1]!, last) > 1) out.push(last);
  return out;
}

/** Shortest distance from `p` to any vertex of a densely resampled polyline. */
export function distanceToRouteM(p: LngLat, coords: readonly LngLat[]): number {
  return Math.min(...resample(coords, 2).map((q) => haversineM(p, q)));
}

interface QualityReportFile {
  importantCategories: Array<{ id: string; label: string; total: number; status: string }>;
}

/** Labels the About panel lists under "Thin coverage" (from the shipped quality report). */
export const THIN_CATEGORY_LABELS: readonly string[] = readJson<QualityReportFile>('quality-report.json')
  .importantCategories.filter((c) => c.status === 'empty' || c.status === 'sparse')
  .map((c) => c.label);

/** A quick-action category with no record at all in the dataset (its honest empty state). */
export const EMPTY_CATEGORY = CATEGORIES.find(
  (c) => c.nearestAction && !PLACES.some((p) => p.categoryId === c.id),
);
