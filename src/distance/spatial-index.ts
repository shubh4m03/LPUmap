/**
 * Uniform grid spatial index over a local metric projection.
 *
 * Cells are bucketed in local metres; reported distances are haversine so
 * they match every other distance in the app. The equirectangular projection
 * scales east–west distances by cos(origin latitude), so it overstates them
 * at latitudes farther from the equator than the origin. The ring search
 * shrinks its lower bound by that worst-case ratio (plus a 1 % margin for
 * great-circle curvature), which keeps `nearest` and `within` exact against
 * brute force even when the data is spread widely or contains an outlier.
 *
 * Shared with scripts/: erasable syntax and `.ts` import extensions only.
 */
import type { LngLat } from '../data/schema.ts';
import { createLocalProjection, haversineM, isValidLngLat } from './geodesic.ts';

export const DEFAULT_GRID_CELL_SIZE_M = 100;
/** Extra margin on grid lower bounds for great-circle curvature. */
const CURVATURE_SAFETY = 0.99;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface GridHit<T> {
  item: T;
  distanceM: number;
}

export interface GridIndex<T> {
  nearest(p: LngLat, k: number, maxDistanceM?: number): Array<GridHit<T>>;
  within(p: LngLat, radiusM: number): Array<GridHit<T>>;
  /** Number of items that had a valid location. */
  readonly size: number;
}

interface Entry<T> {
  item: T;
  location: LngLat;
  order: number;
}

const byDistance = (a: { distanceM: number; order: number }, b: { distanceM: number; order: number }) =>
  a.distanceM - b.distanceM || a.order - b.order;

export function createGridIndex<T>(
  items: readonly T[],
  getLocation: (t: T) => LngLat | null,
  cellSizeM: number = DEFAULT_GRID_CELL_SIZE_M,
): GridIndex<T> {
  if (!(cellSizeM > 0) || !Number.isFinite(cellSizeM)) throw new RangeError('cellSizeM must be positive');

  const entries: Array<Entry<T>> = [];
  items.forEach((item, order) => {
    const location = getLocation(item);
    if (isValidLngLat(location)) entries.push({ item, location, order });
  });

  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const { location } of entries) {
    minLat = Math.min(minLat, location[1]);
    maxLat = Math.max(maxLat, location[1]);
  }
  const originLat = entries.length > 0 ? (minLat + maxLat) / 2 : 0;
  const origin: LngLat = [entries[0]?.location[0] ?? 0, originLat];
  const projection = createLocalProjection(origin);
  const maxAbsLat = Math.max(Math.abs(minLat), Math.abs(maxLat));

  /**
   * Factor by which a projected distance may overstate the true distance for
   * a search involving `p`: true east–west metres at latitude φ are
   * cos φ / cos φ0 of the projected ones, worst at the highest |latitude|.
   */
  const safetyFor = (p: LngLat): number => {
    const worstLat = Math.max(maxAbsLat, Math.abs(p[1]));
    return CURVATURE_SAFETY * Math.min(1, Math.cos(toRad(worstLat)) / Math.cos(toRad(originLat)));
  };
  const cellOf = (p: LngLat): [number, number] => {
    const [x, y] = projection.toXY(p);
    return [Math.floor(x / cellSizeM), Math.floor(y / cellSizeM)];
  };

  const cells = new Map<string, Array<Entry<T>>>();
  let minCx = Infinity;
  let maxCx = -Infinity;
  let minCy = Infinity;
  let maxCy = -Infinity;
  for (const entry of entries) {
    const [cx, cy] = cellOf(entry.location);
    minCx = Math.min(minCx, cx);
    maxCx = Math.max(maxCx, cx);
    minCy = Math.min(minCy, cy);
    maxCy = Math.max(maxCy, cy);
    const key = `${cx},${cy}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(entry);
    else cells.set(key, [entry]);
  }

  /** Visits every occupied-extent cell on the square ring at Chebyshev radius r. */
  function visitRing(pcx: number, pcy: number, r: number, visit: (e: Entry<T>) => void): void {
    const y0 = Math.max(minCy, pcy - r);
    const y1 = Math.min(maxCy, pcy + r);
    for (let cy = y0; cy <= y1; cy++) {
      const edgeRow = cy === pcy - r || cy === pcy + r;
      if (edgeRow) {
        const x0 = Math.max(minCx, pcx - r);
        const x1 = Math.min(maxCx, pcx + r);
        for (let cx = x0; cx <= x1; cx++) cells.get(`${cx},${cy}`)?.forEach(visit);
      } else {
        for (const cx of r === 0 ? [pcx] : [pcx - r, pcx + r]) {
          if (cx >= minCx && cx <= maxCx) cells.get(`${cx},${cy}`)?.forEach(visit);
        }
      }
    }
  }

  function ringBounds(p: LngLat): { pcx: number; pcy: number; rStart: number; rEnd: number } {
    const [pcx, pcy] = cellOf(p);
    const dx = Math.max(minCx - pcx, 0, pcx - maxCx);
    const dy = Math.max(minCy - pcy, 0, pcy - maxCy);
    const rEnd = Math.max(
      Math.abs(pcx - minCx),
      Math.abs(pcx - maxCx),
      Math.abs(pcy - minCy),
      Math.abs(pcy - maxCy),
    );
    return { pcx, pcy, rStart: Math.max(dx, dy), rEnd };
  }

  function nearest(p: LngLat, k: number, maxDistanceM: number = Infinity): Array<GridHit<T>> {
    if (entries.length === 0 || !(k >= 1) || !isValidLngLat(p) || !(maxDistanceM >= 0)) return [];
    const want = Math.floor(k);
    const { pcx, pcy, rStart, rEnd } = ringBounds(p);
    const safety = safetyFor(p);
    const found: Array<{ item: T; distanceM: number; order: number }> = [];
    const visit = (e: Entry<T>) => {
      const distanceM = haversineM(p, e.location);
      if (distanceM <= maxDistanceM) found.push({ item: e.item, distanceM, order: e.order });
    };
    for (let r = rStart; r <= rEnd; r++) {
      visitRing(pcx, pcy, r, visit);
      // Any item in a ring beyond r is at least r whole cells away.
      const lowerBound = r * cellSizeM * safety;
      if (lowerBound > maxDistanceM) break;
      if (found.length >= want) {
        found.sort(byDistance);
        if (found[want - 1]!.distanceM <= lowerBound) break;
      }
    }
    found.sort(byDistance);
    return found.slice(0, want).map(({ item, distanceM }) => ({ item, distanceM }));
  }

  function within(p: LngLat, radiusM: number): Array<GridHit<T>> {
    if (entries.length === 0 || !isValidLngLat(p) || !(radiusM >= 0)) return [];
    const { pcx, pcy, rStart, rEnd } = ringBounds(p);
    const reach = Math.min(rEnd, Math.ceil(radiusM / (cellSizeM * safetyFor(p))) + 1);
    const found: Array<{ item: T; distanceM: number; order: number }> = [];
    for (let r = rStart; r <= reach; r++) {
      visitRing(pcx, pcy, r, (e) => {
        const distanceM = haversineM(p, e.location);
        if (distanceM <= radiusM) found.push({ item: e.item, distanceM, order: e.order });
      });
    }
    found.sort(byDistance);
    return found.map(({ item, distanceM }) => ({ item, distanceM }));
  }

  return { nearest, within, size: entries.length };
}
