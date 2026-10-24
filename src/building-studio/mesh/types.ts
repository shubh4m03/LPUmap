/**
 * StudioMesh: the renderer-agnostic output of the procedural model module
 * (S1, docs/BUILDING_STUDIO_DESIGN.md §4). The realistic-3D custom layer
 * (raw WebGL2), the isometric Canvas2D renderer and the thumbnail SVGs all
 * draw the SAME faces. Pure data; no DOM, WebGL or MapLibre types.
 *
 * Conventions (normative):
 *  - Coordinates are metres in a local east/north/up frame at `origin`
 *    (x east, y north, z up; z = 0 is the ground at the origin). The model's
 *    rotation is already applied, so a renderer only translates by origin.
 *  - A face is planar (within 1 mm). Its `ring` has ≥ 3 vertices, is open
 *    (the first vertex is not repeated), is simple, and runs
 *    counter-clockwise when seen from outside (from the side `normal` points
 *    to). `holes` (optional) are simple, open and clockwise from outside.
 *  - `normal` is the outward unit normal (Newell's method over the ring).
 *  - A wall face that carries `windows` has ring[0] → ring[1] as its bottom
 *    edge, left to right seen from outside; the grid's u axis runs along that
 *    edge and v straight up. Windows are synthetic patterns drawn by the
 *    renderer (fragment shader / canvas), clipped to the face. They are
 *    appearance only, never a claim about the real building.
 *  - Faces of one mesh form a closed surface when `closed` is true (every
 *    generator; the signed volume then equals the body volume).
 */
import type { LngLat } from '../../data/schema.ts';
import type { WindowPattern } from '../schema.ts';

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

/** Material slots. Colours come from the model's roof/facade appearance (appearance only). */
export type MaterialSlot = 'wall' | 'roof' | 'base' | 'trim' | 'glass';

export interface WindowGrid {
  pattern: Exclude<WindowPattern, 'none'>;
  floorHeightM: number;
  /** Number of floors the grid spans, upwards from `bottomM`. */
  floors: number;
  /** Height of the first floor's bottom above the face's lowest vertex, metres. */
  bottomM: number;
  /** Window bays along the bottom edge (≥ 1). */
  columns: number;
  /** 0–1 share of each bay/floor cell the opening fills. */
  density: number;
}

export interface StudioFace {
  ring: Vec3[];
  holes?: Vec3[][];
  normal: Vec3;
  material: MaterialSlot;
  windows?: WindowGrid;
}

export interface StudioBBox {
  min: Vec3;
  max: Vec3;
}

/** A ground polygon in the local frame: outer ring counter-clockwise, holes clockwise, rings open. */
export type LocalPolygon = Vec2[][];

export interface StudioMesh {
  /** [lon, lat] of the local frame origin (the model anchor). */
  origin: LngLat;
  faces: StudioFace[];
  bbox: StudioBBox;
  /** Ground footprint in the local frame (the derived footprint; picking and 2D use its lon/lat form). */
  footprint: LocalPolygon;
  closed: boolean;
}

export type MeshFailureReason =
  | 'unsupported-model'
  | 'missing-base-footprint'
  | 'invalid-geometry'
  /** Stub only: the generator lands with studio-core. Consumers render the fallback prism. */
  | 'generator-not-implemented';

export type MeshResult =
  { ok: true; mesh: StudioMesh } | { ok: false; reason: MeshFailureReason; message: string };

/** Newell's method: unit normal of a planar ring (counter-clockwise from the side it points to). */
export function faceNormal(ring: readonly Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
}

/** Bounding box of every vertex of every face. */
export function meshBBox(faces: readonly StudioFace[]): StudioBBox {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const f of faces)
    for (const v of [f.ring, ...(f.holes ?? [])].flat())
      for (let k = 0; k < 3; k++) {
        if (v[k]! < min[k]!) min[k] = v[k]!;
        if (v[k]! > max[k]!) max[k] = v[k]!;
      }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}
