/**
 * StudioMesh → interleaved GPU vertex/index arrays for the custom layer.
 * Pure (typed arrays only), so buffer layout, triangle winding and window
 * parameters are unit-tested without WebGL.
 *
 * Every face keeps its own vertices (flat shading: one normal per face).
 * Triangles come from the shared `triangulateFace` helper, so they keep the
 * mesh contract's winding: counter-clockwise seen from outside.
 *
 * Vertex layout (float32, STRIDE_FLOATS per vertex):
 *   0–2  position, local ENU metres at the mesh origin
 *   3–5  outward unit normal (ENU)
 *   6–8  linear RGB 0–1 of the face's material slot (appearance only)
 *   9–10 window-space u, v in metres (u along the wall's bottom edge, v up
 *        from the face's lowest vertex); 0 on faces without windows
 *   11–14 window grid: floor height, first-floor bottom, bay width, density
 *   15–16 pattern id (0 none, 1 ribbon, 2 punched, 3 grid, 4 curtain), floors
 */
import { faceVertices, triangulateFace } from '../../mesh/triangulate.ts';
import type { MaterialSlot, StudioFace, StudioMesh, Vec3, WindowGrid } from '../../mesh/types.ts';

export const STRIDE_FLOATS = 17;
export const STRIDE_BYTES = STRIDE_FLOATS * 4;

/** Attribute offsets in floats, shared with the shader setup. */
export const ATTRIBUTES = {
  position: { offset: 0, size: 3 },
  normal: { offset: 3, size: 3 },
  colour: { offset: 6, size: 3 },
  uv: { offset: 9, size: 2 },
  grid: { offset: 11, size: 4 },
  pattern: { offset: 15, size: 2 },
} as const;

export const PATTERN_IDS: Readonly<Record<WindowGrid['pattern'], number>> = {
  ribbon: 1,
  punched: 2,
  grid: 3,
  curtain: 4,
};

/**
 * Colours of a studio model, `#rrggbb`. Appearance only: never a statement
 * about the real building's materials (S3). Missing slots are derived.
 */
export interface StudioAppearance {
  wall: string;
  roof: string;
  base?: string;
  trim?: string;
  glass?: string;
}

/** Neutral appearance for records whose model cannot be generated (S2 fallback prism). */
export const FALLBACK_APPEARANCE: Readonly<StudioAppearance> = { wall: '#c9c4bb', roof: '#b3ada3' };

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.5];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** Resolved colour of every material slot. */
export function slotColours(a: StudioAppearance): Record<MaterialSlot, Rgb> {
  const wall = hexToRgb(a.wall);
  return {
    wall,
    roof: hexToRgb(a.roof),
    base: a.base ? hexToRgb(a.base) : scale(wall, 0.6),
    trim: a.trim ? hexToRgb(a.trim) : scale(wall, 0.8),
    glass: a.glass ? hexToRgb(a.glass) : [0.32, 0.4, 0.48],
  };
}

export interface MeshBuffers {
  vertices: Float32Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

interface FaceFrame {
  origin: Vec3;
  /** Horizontal unit vector along ring[0] → ring[1]. */
  u: Vec3;
  minZ: number;
  bay: number;
}

function wallFrame(face: StudioFace, grid: WindowGrid): FaceFrame | null {
  const a = face.ring[0];
  const b = face.ring[1];
  if (!a || !b) return null;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  let minZ = Infinity;
  for (const v of face.ring) minZ = Math.min(minZ, v[2]);
  return { origin: a, u: [dx / len, dy / len, 0], minZ, bay: len / Math.max(1, grid.columns) };
}

/** Builds the interleaved arrays of one mesh. Faces that cannot be triangulated are skipped. */
export function buildMeshBuffers(mesh: Pick<StudioMesh, 'faces'>, appearance: StudioAppearance): MeshBuffers {
  const colours = slotColours(appearance);
  const parts: Array<{ verts: Vec3[]; tris: number[]; face: StudioFace; frame: FaceFrame | null }> = [];
  let vertexCount = 0;
  let indexCount = 0;
  for (const face of mesh.faces) {
    const tris = triangulateFace(face);
    if (tris.length === 0) continue;
    const verts = faceVertices(face);
    const frame = face.windows && face.material === 'wall' ? wallFrame(face, face.windows) : null;
    parts.push({ verts, tris, face, frame });
    vertexCount += verts.length;
    indexCount += tris.length;
  }

  const vertices = new Float32Array(vertexCount * STRIDE_FLOATS);
  const indices = vertexCount > 0xffff ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let v = 0;
  let i = 0;
  for (const { verts, tris, face, frame } of parts) {
    const base = v;
    const rgb = colours[face.material];
    const grid = frame ? face.windows : undefined;
    for (const p of verts) {
      const o = v * STRIDE_FLOATS;
      vertices[o] = p[0];
      vertices[o + 1] = p[1];
      vertices[o + 2] = p[2];
      vertices[o + 3] = face.normal[0];
      vertices[o + 4] = face.normal[1];
      vertices[o + 5] = face.normal[2];
      vertices[o + 6] = rgb[0];
      vertices[o + 7] = rgb[1];
      vertices[o + 8] = rgb[2];
      if (frame && grid) {
        vertices[o + 9] = (p[0] - frame.origin[0]) * frame.u[0] + (p[1] - frame.origin[1]) * frame.u[1];
        vertices[o + 10] = p[2] - frame.minZ;
        vertices[o + 11] = grid.floorHeightM;
        vertices[o + 12] = grid.bottomM;
        vertices[o + 13] = frame.bay;
        vertices[o + 14] = grid.density;
        vertices[o + 15] = PATTERN_IDS[grid.pattern];
        vertices[o + 16] = grid.floors;
      }
      v += 1;
    }
    for (const t of tris) indices[i++] = base + t;
  }
  return { vertices, indices, vertexCount, triangleCount: indexCount / 3 };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv(h: number, n: number): number {
  // Quantised to 0.1 mm so float noise from identical inputs cannot split the cache.
  let x = Math.round(n * 1e4) | 0;
  for (let k = 0; k < 4; k++) {
    h = Math.imul(h ^ (x & 0xff), FNV_PRIME);
    x >>>= 8;
  }
  return h;
}

function fnvString(h: number, s: string): number {
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), FNV_PRIME);
  return h;
}

const keyMemo = new WeakMap<object, Map<string, string>>();

/**
 * Content key of a mesh's local geometry + appearance. It ignores the mesh
 * origin, so the same model placed twice (or dragged to a new anchor) shares
 * one GPU buffer: only the per-instance matrix differs.
 */
export function meshContentKey(mesh: Pick<StudioMesh, 'faces'>, appearance: StudioAppearance): string {
  const appearanceKey = [
    appearance.wall,
    appearance.roof,
    appearance.base ?? '',
    appearance.trim ?? '',
    appearance.glass ?? '',
  ].join(',');
  const memo = keyMemo.get(mesh.faces);
  const hit = memo?.get(appearanceKey);
  if (hit) return hit;
  let h = fnvString(FNV_OFFSET, appearanceKey);
  let count = 0;
  for (const f of mesh.faces) {
    h = fnvString(h, f.material);
    for (const ring of [f.ring, ...(f.holes ?? [])]) {
      h = fnv(h, ring.length);
      for (const p of ring) {
        h = fnv(h, p[0]);
        h = fnv(h, p[1]);
        h = fnv(h, p[2]);
        count += 1;
      }
    }
    const w = f.windows;
    if (w) {
      h = fnvString(h, w.pattern);
      for (const n of [w.floorHeightM, w.floors, w.bottomM, w.columns, w.density]) h = fnv(h, n);
    }
  }
  const key = `m${(h >>> 0).toString(36)}-${mesh.faces.length}-${count}`;
  const next = memo ?? new Map<string, string>();
  next.set(appearanceKey, key);
  if (!memo) keyMemo.set(mesh.faces, next);
  return key;
}
