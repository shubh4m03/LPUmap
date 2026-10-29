/**
 * Whether a point is inside the campus boundary, decided exactly as the merge
 * service decides it for a published location (src/community/merge.ts rule 4a:
 * `campusZoneFor` over `boundaryPolygons(base.boundary)`), so the admin can say
 * BEFORE publishing what the public app will do with the point. Pure.
 */
import { useMemo } from 'react';
import { boundaryPolygons, pointInPolygons, type PolygonRings } from '../../community/index.ts';
import type { BoundaryFile, LngLat } from '../../data/index.ts';
import { isValidLngLat } from '../../distance/index.ts';
import type { CampusDataState } from '../data/campus-data.ts';

/** 'unknown': no position yet, or the boundary is not loaded / has no polygon. */
export type CampusZoneVerdict = 'on-campus' | 'outside' | 'unknown';

const polygonCache = new WeakMap<object, PolygonRings[]>();

export function campusZoneOf(
  boundary: BoundaryFile | null | undefined,
  point: LngLat | null | undefined,
): CampusZoneVerdict {
  if (!point || !isValidLngLat(point) || !boundary || !Array.isArray(boundary.features)) return 'unknown';
  let polygons = polygonCache.get(boundary);
  if (!polygons) {
    polygons = boundaryPolygons(boundary);
    polygonCache.set(boundary, polygons);
  }
  if (polygons.length === 0) return 'unknown';
  return pointInPolygons(point, polygons) ? 'on-campus' : 'outside';
}

/** The verdict for `point` against the admin's campus dataset ('unknown' while it loads). */
export function useCampusZone(campus: CampusDataState, point: LngLat | null): CampusZoneVerdict {
  const boundary = campus.status === 'ready' ? campus.data.boundary : null;
  const lon = point?.[0];
  const lat = point?.[1];
  return useMemo(
    () => campusZoneOf(boundary, lon === undefined || lat === undefined ? null : [lon, lat]),
    [boundary, lon, lat],
  );
}
