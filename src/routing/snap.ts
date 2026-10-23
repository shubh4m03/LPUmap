/**
 * Nearest usable node lookup over a uniform grid in a local metric
 * projection. Cells are slightly larger than the snap radius, so near the
 * projection origin the 3×3 neighbourhood of the query cell contains every
 * candidate. The equirectangular x scale is only true at the origin latitude,
 * so the east–west search span widens when the query sits at a latitude where
 * projected metres understate real ones (e.g. an outlier node became the
 * origin). The final distance test uses haversine, the app's single distance
 * definition.
 */
import type { LngLat } from '../data/schema.ts';
import { createLocalProjection, haversineM, isValidLngLat } from '../distance/geodesic.ts';
import type { RoutingGraph } from './graph.ts';

export interface SnapHit {
  nodeId: number;
  distanceM: number;
}

export interface SnapIndex {
  nearest(p: LngLat): SnapHit | null;
}

/** Offsets keep cell coordinates positive inside a safe-integer key. */
const KEY_OFFSET = 2 ** 24;
const KEY_SPAN = 2 ** 25;
const cellKey = (cx: number, cy: number) => (cx + KEY_OFFSET) * KEY_SPAN + (cy + KEY_OFFSET);
/** Beyond this many cells either side a query is not near the indexed network at all. */
const MAX_CELL_SPAN = 64;
const DEG = Math.PI / 180;

export function buildSnapIndex(graph: RoutingGraph, nodeUsable: Uint8Array, maxDistanceM: number): SnapIndex {
  let origin: LngLat | null = null;
  for (let i = 0; i < graph.nodeCount && !origin; i++) {
    if (nodeUsable[i] && graph.nodeValid[i]) origin = [graph.lon[i]!, graph.lat[i]!];
  }
  if (!origin || !(maxDistanceM > 0)) return { nearest: () => null };

  const projection = createLocalProjection(origin);
  const cosOriginLat = Math.cos(origin[1] * DEG);
  // 10 % margin absorbs the tiny disagreement between projected and haversine distance.
  const cell = maxDistanceM * 1.1;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < graph.nodeCount; i++) {
    if (!nodeUsable[i] || !graph.nodeValid[i]) continue;
    const [x, y] = projection.toXY([graph.lon[i]!, graph.lat[i]!]);
    const key = cellKey(Math.floor(x / cell), Math.floor(y / cell));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }

  return {
    nearest(p) {
      if (!isValidLngLat(p)) return null;
      const [x, y] = projection.toXY(p);
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      // Projected x = true east–west metres × cos(originLat) / cos(lat); bound it at the
      // most poleward latitude a candidate within maxDistanceM can have.
      const reachLat = Math.min(89.9, Math.abs(p[1]) + maxDistanceM / 111_000);
      const xStretch = Math.max(1, cosOriginLat / Math.cos(reachLat * DEG));
      const span = Math.ceil((maxDistanceM * xStretch) / cell);
      if (span > MAX_CELL_SPAN) return null;
      if (Math.abs(cx) >= KEY_OFFSET - span - 1 || Math.abs(cy) >= KEY_OFFSET - 2) return null;
      let best: SnapHit | null = null;
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(cellKey(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const node of bucket) {
            const d = haversineM(p, [graph.lon[node]!, graph.lat[node]!]);
            if (d > maxDistanceM) continue;
            if (!best || d < best.distanceM || (d === best.distanceM && node < best.nodeId)) {
              best = { nodeId: node, distanceM: d };
            }
          }
        }
      }
      return best;
    },
  };
}
