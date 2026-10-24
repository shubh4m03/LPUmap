/**
 * What an OPTIONAL snapping proposal may align to (S6): the nearest mapped
 * building outline, or the nearest UNVERIFIED machine-detected footprint
 * (a placement guide only, never data). Pure; nothing here moves a model —
 * geometry.ts turns a target into a proposal the owner may apply.
 */
import type { BuildingsFile, DetectionsFile, LngLat } from '../../data/schema.ts';
import { createEnuFrame, lngLatToLocalPolygon } from '../footprint.ts';
import { pointToPolygonM } from '../planar.ts';
import type { ModelConfigV1 } from '../schema.ts';

export interface OutlineTarget {
  id: string;
  label: string;
  coordinates: LngLat[][];
  distanceM: number;
}

type PolygonalGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };

/** Outer polygons of a Polygon / MultiPolygon. */
function polygonsOf(g: PolygonalGeometry): LngLat[][][] {
  return g.type === 'Polygon' ? [g.coordinates as LngLat[][]] : (g.coordinates as LngLat[][][]);
}

function nearest<T>(
  items: Iterable<T>,
  model: Pick<ModelConfigV1, 'anchor'>,
  maxM: number,
  polys: (t: T) => LngLat[][][],
): { item: T; coordinates: LngLat[][]; distanceM: number } | null {
  const frame = createEnuFrame(model.anchor);
  let best: { item: T; coordinates: LngLat[][]; distanceM: number } | null = null;
  for (const item of items)
    for (const coordinates of polys(item)) {
      const first = coordinates[0]?.[0];
      if (!first) continue;
      const p = frame.toLocal(first);
      if (Math.hypot(p[0], p[1]) > maxM + 1000) continue; // far away: skip the exact distance
      const d = pointToPolygonM([0, 0], lngLatToLocalPolygon(coordinates, frame));
      if (d <= maxM && (!best || d < best.distanceM)) best = { item, coordinates, distanceM: d };
    }
  return best;
}

/** The mapped building outline nearest to the model's centre (excluding the building being edited). */
export function nearestBuildingOutline(
  buildings: Pick<BuildingsFile, 'features'>,
  model: Pick<ModelConfigV1, 'anchor'>,
  opts: { excludeId?: string | null; maxM?: number } = {},
): OutlineTarget | null {
  const r = nearest(
    buildings.features.filter((f) => f.properties.id !== opts.excludeId),
    model,
    opts.maxM ?? 60,
    (f) => polygonsOf(f.geometry as PolygonalGeometry),
  );
  if (!r) return null;
  const p = r.item.properties;
  return {
    id: p.id,
    label: p.name ?? p.displayName ?? p.id,
    coordinates: r.coordinates,
    distanceM: Math.round(r.distanceM * 10) / 10,
  };
}

/** The unverified detected footprint (polygon kind only) nearest to the model's centre. */
export function nearestDetection(
  detections: Pick<DetectionsFile, 'features'>,
  model: Pick<ModelConfigV1, 'anchor'>,
  maxM = 60,
): OutlineTarget | null {
  const r = nearest(
    detections.features.filter(
      (f) => f.properties.geometryKind === 'footprint' && f.geometry.type !== 'Point',
    ),
    model,
    maxM,
    (f) => polygonsOf(f.geometry as PolygonalGeometry),
  );
  if (!r) return null;
  return {
    id: r.item.properties.id,
    label: `unverified detected footprint ${r.item.properties.id}`,
    coordinates: r.coordinates,
    distanceM: Math.round(r.distanceM * 10) / 10,
  };
}
