/**
 * Triangle helper contract for StudioMesh faces (WebGL buffers, thumbnail
 * fills). Ear clipping with hole bridging on the face's own plane; pure and
 * allocation-light. Faces are small (≤ a few hundred vertices), so the
 * O(n²) ear search is fine.
 *
 * Contract: `triangulateFace(face)` returns vertex indices into
 * `faceVertices(face)` (= ring, then each hole in order), three per
 * triangle, each triangle counter-clockwise seen from outside (same winding
 * as the ring). The triangles cover the face exactly (area-preserving) for
 * any simple ring with simple, non-touching holes.
 */
import type { StudioFace, Vec2, Vec3 } from './types.ts';

/** ring, then every hole, in order: the index space of triangulateFace. */
export function faceVertices(face: Pick<StudioFace, 'ring' | 'holes'>): Vec3[] {
  return [face.ring, ...(face.holes ?? [])].flat();
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Signed area (positive = counter-clockwise). */
export function signedArea2(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  return s / 2;
}

/** Projects the face onto its dominant axis plane so the ring is counter-clockwise in 2D. */
function project(face: Pick<StudioFace, 'normal'>, verts: readonly Vec3[]): Vec2[] {
  const n = face.normal;
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const k = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
  let i = (k + 1) % 3;
  let j = (k + 2) % 3;
  if (n[k]! < 0) [i, j] = [j, i];
  return verts.map((v) => [v[i]!, v[j]!] as const);
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const same = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** True when p lies strictly inside segment a–b (collinear, between the endpoints). */
function onSegmentInterior(p: Vec2, a: Vec2, b: Vec2): boolean {
  if (same(p, a) || same(p, b)) return false;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (Math.abs(cross(a, b, p)) > 1e-9 * Math.max(1, len)) return false;
  const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
  return t > 0 && t < 1;
}

/**
 * Merges holes into the outer index cycle with zero-width bridges (the
 * earcut approach): each hole, rightmost first, is joined from its rightmost
 * vertex M to the nearest vertex V with V.x ≥ M.x whose bridge crosses no
 * edge and passes through no other vertex. Looking rightwards from the
 * rightmost hole vertex guarantees the bridge leaves the hole outwards.
 */
function bridgeHoles(pts: readonly Vec2[], outer: number[], holes: number[][]): number[] {
  let poly = outer;
  const pending = holes
    .filter((h) => h.length >= 3)
    .map((h) => {
      let m = 0;
      for (let q = 1; q < h.length; q++) if (pts[h[q]!]![0] > pts[h[m]!]![0]) m = q;
      return { h, m };
    })
    .sort((a, b) => pts[b.h[b.m]!]![0] - pts[a.h[a.m]!]![0]);
  for (let hi = 0; hi < pending.length; hi++) {
    const { h, m } = pending[hi]!;
    const M = pts[h[m]!]!;
    const edges: [Vec2, Vec2][] = [];
    const addCycle = (c: readonly number[]) => {
      for (let q = 0; q < c.length; q++) edges.push([pts[c[q]!]!, pts[c[(q + 1) % c.length]!]!]);
    };
    addCycle(poly);
    for (let r = hi; r < pending.length; r++) addCycle(pending[r]!.h);
    let best = -1;
    let bestD = Infinity;
    for (let q = 0; q < poly.length; q++) {
      const V = pts[poly[q]!]!;
      const d = (V[0] - M[0]) ** 2 + (V[1] - M[1]) ** 2;
      if (d >= bestD || V[0] < M[0] || same(V, M)) continue;
      const blocked = edges.some(
        ([a, b]) =>
          onSegmentInterior(a, M, V) ||
          (!same(a, V) && !same(b, V) && !same(a, M) && !same(b, M) && segmentsCross(M, V, a, b)),
      );
      if (!blocked) {
        best = q;
        bestD = d;
      }
    }
    if (best < 0) continue; // degenerate input: leave the hole unfilled rather than produce crossing triangles
    const holeCycle = [...h.slice(m), ...h.slice(0, m), h[m]!];
    poly = [...poly.slice(0, best + 1), ...holeCycle, ...poly.slice(best)];
  }
  return poly;
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/** Triangle indices into faceVertices(face); see the module contract. */
export function triangulateFace(face: Pick<StudioFace, 'ring' | 'holes' | 'normal'>): number[] {
  const verts = faceVertices(face);
  const pts = project(face, verts);
  const outer = face.ring.map((_, q) => q);
  const holes: number[][] = [];
  let offset = face.ring.length;
  for (const h of face.holes ?? []) {
    holes.push(h.map((_, q) => offset + q));
    offset += h.length;
  }
  const poly = bridgeHoles(pts, outer, holes);
  const out: number[] = [];
  const idx = [...poly];
  let guard = idx.length * idx.length + 10;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let q = 0; q < idx.length; q++) {
      const ia = idx[(q + idx.length - 1) % idx.length]!;
      const ib = idx[q]!;
      const ic = idx[(q + 1) % idx.length]!;
      const a = pts[ia]!;
      const b = pts[ib]!;
      const c = pts[ic]!;
      if (cross(a, b, c) <= 1e-12) continue; // reflex or degenerate
      let ear = true;
      for (const ip of idx) {
        const p = pts[ip]!;
        if (ip === ia || ip === ib || ip === ic || same(p, a) || same(p, b) || same(p, c)) continue;
        if (pointInTriangle(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(ia, ib, ic);
      idx.splice(q, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Collinear leftovers: drop one zero-area vertex and continue.
      const q = idx.findIndex((ib, n) => {
        const a = pts[idx[(n + idx.length - 1) % idx.length]!]!;
        const c = pts[idx[(n + 1) % idx.length]!]!;
        return Math.abs(cross(a, pts[ib]!, c)) <= 1e-12;
      });
      if (q < 0) break;
      idx.splice(q, 1);
    }
  }
  if (idx.length === 3 && cross(pts[idx[0]!]!, pts[idx[1]!]!, pts[idx[2]!]!) > 1e-12)
    out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
}
