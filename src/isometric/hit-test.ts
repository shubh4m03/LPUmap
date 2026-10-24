/**
 * Hit-testing of the overview (docs/ISOMETRIC_AND_3D_DESIGN.md §6.6 step 5):
 *
 *  1. Markers and labels first, using their enlarged (≥ 24 px) hit boxes.
 *  2. Buildings in REVERSE draw order against the footprint prism's projected
 *     roof polygon and visible wall quads (studio models too: picking always
 *     uses the footprint, S1).
 *  3. Otherwise the exact inverse onto the ground plane: a point for "pick on
 *     map", or a click on empty space.
 */
import type { LngLat } from '../data/schema.ts';
import { boxContains, pointInRings } from './geometry.ts';
import type { PlacedLabel } from './labels.ts';
import type { ScreenTransform } from './projection.ts';
import type { IsoScene } from './scene.ts';

export type IsoHit =
  { kind: 'marker'; id: string } | { kind: 'building'; id: string } | { kind: 'ground'; lngLat: LngLat };

export function hitTest(
  scene: IsoScene,
  t: ScreenTransform,
  labels: readonly PlacedLabel[],
  px: number,
  py: number,
): IsoHit {
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i]!;
    if (boxContains(l.hitBox, px, py)) {
      if (l.id.startsWith('endpoint:')) continue; // endpoints are not selectable records
      return { kind: 'marker', id: l.id };
    }
  }
  const x = (px - t.tx) / t.k;
  const y = (py - t.ty) / t.k;
  for (let i = scene.buildings.length - 1; i >= 0; i--) {
    const b = scene.buildings[i]!;
    if (!boxContains(b.hitBox, x, y)) continue;
    for (const poly of b.hit) if (pointInRings(x, y, poly)) return { kind: 'building', id: b.id };
  }
  const [e, n] = scene.projection.groundAt(x, y);
  return { kind: 'ground', lngLat: scene.frame.toLngLat(e, n) };
}
