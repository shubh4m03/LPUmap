/**
 * Pure helpers of the candidate-footprint map (CandidateMap.tsx): the campus
 * building index, the building under a map point, and the preview geometry.
 */
import type { Geometry } from 'geojson';
import { pointInRing } from '../../../community/geo.ts';
import type { CampusData } from '../../../data/campus-data.ts';
import type { LngLat } from '../../../data/schema.ts';
import type { CandidateFootprint } from '../../../isometric-art/schema.ts';
import type { EditPreviewCollection, EditPreviewFeature } from '../../../map/editing/types.ts';

type BuildingFeature = CampusData['buildings']['features'][number];

export interface CampusBuildingInfo {
  id: string;
  displayName: string;
  anchor: LngLat | null;
  geometry: Geometry;
}

/** Campus-inventory base buildings by id (what the server accepts besides published studio buildings). */
export function campusBuildingIndex(data: CampusData): Map<string, CampusBuildingInfo> {
  const out = new Map<string, CampusBuildingInfo>();
  for (const f of data.buildings.features as BuildingFeature[]) {
    const p = f.properties;
    if (!p.inCampusInventory) continue;
    out.set(p.id, {
      id: p.id,
      displayName: p.displayName,
      anchor: p.anchorLon != null && p.anchorLat != null ? [p.anchorLon, p.anchorLat] : null,
      geometry: f.geometry as Geometry,
    });
  }
  return out;
}

const polygonsOf = (g: Geometry): LngLat[][][] =>
  g.type === 'Polygon'
    ? [g.coordinates as LngLat[][]]
    : g.type === 'MultiPolygon'
      ? (g.coordinates as LngLat[][][])
      : [];

/** The campus building under a map point (outer ring in, not inside a hole), or null. */
export function buildingAt(index: ReadonlyMap<string, CampusBuildingInfo>, p: LngLat): string | null {
  for (const b of index.values()) {
    for (const [outer, ...holes] of polygonsOf(b.geometry)) {
      if (outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) return b.id;
    }
  }
  return null;
}

/** Preview geometry: candidates as dashed guides, the chosen building solid. */
export function candidatePreview(
  index: ReadonlyMap<string, CampusBuildingInfo>,
  candidates: readonly CandidateFootprint[],
  selectedId: string | null,
): EditPreviewCollection {
  const features: EditPreviewFeature[] = [];
  for (const c of candidates) {
    const b = index.get(c.buildingId);
    if (!b || c.buildingId === selectedId) continue;
    features.push({ type: 'Feature', geometry: b.geometry, properties: { role: 'guide', id: c.buildingId } });
  }
  const sel = selectedId ? index.get(selectedId) : undefined;
  if (sel)
    features.push({ type: 'Feature', geometry: sel.geometry, properties: { role: 'footprint', id: sel.id } });
  return { type: 'FeatureCollection', features };
}
