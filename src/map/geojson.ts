/**
 * Pure GeoJSON derivations for the dynamic map sources. MapView memoises
 * these so a source is only re-uploaded (setData) when its input changes.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { getCategory } from '../config/categories.ts';
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat, Place, Relation } from '../data/schema.ts';
import { destinationPoint, isValidLngLat } from '../distance/geodesic.ts';
import type { MapRouteOverlay, MapUserLocation } from './types.ts';

export type RouteRole = 'alternative' | 'completed' | 'remaining';

export interface PoiProps {
  id: string;
  categoryId: string;
  group: string;
  color: string;
  /** Source name only; unnamed places get no map label (never an invented one). */
  name?: string;
  offCampus: boolean;
  /** The "Nearby, outside campus" layer badge, set on every off-campus marker. */
  badge?: string;
}

export interface PoiCollectionOptions {
  /**
   * Draw off-campus places (owner decision 2: only while the opt-in
   * "Nearby, outside campus" layer is on). Default: that layer's default
   * visibility (off).
   */
  includeOffCampus?: boolean;
}

export interface RouteProps {
  role: RouteRole;
}

export interface UserLocationProps {
  role: 'accuracy' | 'position';
  stale: boolean;
}

export function emptyCollection<G extends Point | LineString | Polygon, P>(): FeatureCollection<G, P> {
  return { type: 'FeatureCollection', features: [] };
}

/**
 * Organisations (departments, schools, offices) that are located_in another
 * place that exists in the dataset, mapped to that host place's id. They get no
 * marker of their own: it would sit on the host's marker and repeat its label.
 * They stay reachable through search and the host's related places.
 */
export function anchoredOrganizations(
  places: readonly Place[],
  relations: readonly Relation[],
): Map<string, string> {
  const orgs = new Set(places.filter((p) => p.kind === 'organization').map((p) => p.id));
  const known = new Set(places.map((p) => p.id));
  const out = new Map<string, string>();
  for (const r of relations) {
    if (r.type === 'located_in' && orgs.has(r.from) && known.has(r.to) && !out.has(r.from))
      out.set(r.from, r.to);
  }
  return out;
}

/**
 * Point markers for every place with a dependable location, except buildings
 * that already render as footprints (they are selected via the footprint),
 * places drawn by their host instead (`hidden`, e.g. anchored organisations)
 * and — unless `includeOffCampus` — off-campus places, whatever list they
 * arrive in (owner decision 2).
 */
export function poiCollection(
  places: readonly Place[],
  footprintIds: ReadonlySet<string>,
  hidden: ReadonlySet<string> | ReadonlyMap<string, string> = new Set<string>(),
  opts: PoiCollectionOptions = {},
): FeatureCollection<Point, PoiProps> {
  const nearby = APP_CONFIG.optionalLayers.nearbyOutsideCampus;
  const includeOffCampus = opts.includeOffCampus ?? nearby.defaultVisible;
  const features: Array<Feature<Point, PoiProps>> = [];
  for (const p of places) {
    if (!p.location || !isValidLngLat(p.location) || footprintIds.has(p.id) || hidden.has(p.id)) continue;
    const offCampus = p.campusZone === 'off-campus-nearby';
    if (offCampus && !includeOffCampus) continue;
    const cat = getCategory(p.categoryId);
    const props: PoiProps = {
      id: p.id,
      categoryId: p.categoryId,
      group: cat.group,
      color: cat.color,
      offCampus,
    };
    if (offCampus) props.badge = nearby.badge;
    if (p.name) props.name = p.name;
    features.push({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: p.location },
      properties: props,
    });
  }
  return { type: 'FeatureCollection', features };
}

function cleanLine(coords: readonly LngLat[] | undefined): LngLat[] | null {
  if (!coords) return null;
  const valid = coords.filter((c) => isValidLngLat(c));
  return valid.length >= 2 ? valid : null;
}

/** Alternatives first, then completed, then remaining, so later features draw on top. */
export function routeCollection(route: MapRouteOverlay | null): FeatureCollection<LineString, RouteProps> {
  const features: Array<Feature<LineString, RouteProps>> = [];
  if (!route) return { type: 'FeatureCollection', features };
  const push = (coords: LngLat[] | null, role: RouteRole) => {
    if (coords)
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { role },
      });
  };
  for (const alt of route.alternatives ?? []) push(cleanLine(alt), 'alternative');
  push(cleanLine(route.completed), 'completed');
  push(cleanLine(route.coordinates), 'remaining');
  return { type: 'FeatureCollection', features };
}

/** Number of vertices in the main (remaining) route line, for the e2e hook. */
export function routeCoordinateCount(route: MapRouteOverlay | null): number {
  return cleanLine(route?.coordinates)?.length ?? 0;
}

export const ACCURACY_CIRCLE_STEPS = 64;

/**
 * Geodesic circle of `radiusM` metres around `center`. Computed in metres via
 * destinationPoint rather than as a pixel radius, so it stays true to scale
 * at every zoom and pitch.
 */
export function accuracyCircle(center: LngLat, radiusM: number, steps = ACCURACY_CIRCLE_STEPS): Polygon {
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) ring.push(destinationPoint(center, (360 * i) / steps, radiusM));
  const first = ring[0];
  if (first) ring.push(first);
  return { type: 'Polygon', coordinates: [ring] };
}

export function userLocationCollection(
  loc: MapUserLocation | null,
): FeatureCollection<Point | Polygon, UserLocationProps> {
  const features: Array<Feature<Point | Polygon, UserLocationProps>> = [];
  if (!loc || !isValidLngLat(loc.lngLat)) return { type: 'FeatureCollection', features };
  if (Number.isFinite(loc.accuracyM) && loc.accuracyM > 0) {
    features.push({
      type: 'Feature',
      geometry: accuracyCircle(loc.lngLat, loc.accuracyM),
      properties: { role: 'accuracy', stale: loc.stale },
    });
  }
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: loc.lngLat },
    properties: { role: 'position', stale: loc.stale },
  });
  return { type: 'FeatureCollection', features };
}
