/**
 * Map-editing preview geometry for the owner's point editors (pure): the
 * point being edited, other records as guides, access-point candidates and
 * the chosen access line. Roles are styled by src/map/editing/layers.ts.
 */
import type { LngLat } from '../../data/schema.ts';
import type { EditHandle, EditPreviewCollection, EditPreviewFeature } from '../../map/editing/types.ts';
import type { AccessCandidate } from './access-points.ts';

export interface PointPreviewInput {
  /** The point being edited (null: not placed yet). */
  point: LngLat | null;
  /** Other records shown for context (e.g. the other locations), as guides. */
  others?: ReadonlyArray<{ id: string; position: LngLat }>;
  candidates?: readonly AccessCandidate[];
  /** The chosen access node (drawn as a line from the point). */
  selectedNodeId?: number | null;
  /** Access-point picking: where the owner clicked (a guide mark; candidates near it are listed). */
  pickClick?: LngLat | null;
}

const pointFeature = (
  p: LngLat,
  role: EditPreviewFeature['properties']['role'],
  id?: string,
): EditPreviewFeature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [p[0], p[1]] },
  properties: id === undefined ? { role } : { role, id },
});

export function pointPreview(input: PointPreviewInput): EditPreviewCollection {
  const features: EditPreviewFeature[] = [];
  for (const o of input.others ?? []) features.push(pointFeature(o.position, 'guide', o.id));
  for (const c of input.candidates ?? []) {
    const chosen = c.nodeId === input.selectedNodeId;
    features.push(pointFeature(c.position, chosen ? 'snap' : 'path', `node:${c.nodeId}`));
    if (chosen && input.point) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [input.point[0], input.point[1]],
            [c.position[0], c.position[1]],
          ],
        },
        properties: { role: 'snap', id: `access:${c.nodeId}` },
      });
    }
  }
  if (input.pickClick) features.push(pointFeature(input.pickClick, 'guide', 'pick-click'));
  if (input.point) features.push(pointFeature(input.point, 'point', 'edited'));
  return { type: 'FeatureCollection', features };
}

/** The draggable handle of a point editor (desktop pointer input). */
export function pointHandle(point: LngLat | null, label = 'Drag to move the point'): EditHandle[] {
  return point ? [{ id: 'move', kind: 'move', position: point, label }] : [];
}

/** Moves `p` by metres east/north (mobile step buttons). */
export function nudge(p: LngLat, eastM: number, northM: number): LngLat {
  const dLat = northM / 111_320;
  const dLon = eastM / (111_320 * Math.cos((p[1] * Math.PI) / 180));
  return [round7(p[0] + dLon), round7(p[1] + dLat)];
}

/** 7 decimals (~1 cm): what we store and send. */
export const round7 = (v: number): number => Math.round(v * 1e7) / 1e7;
export const roundLngLat = (p: LngLat): LngLat => [round7(p[0]), round7(p[1])];
