/**
 * Structural checks for StudioMesh (docs/BUILDING_STUDIO_DESIGN.md §4.3) and
 * a deterministic generator of varied, schema-valid model configs.
 */
import { expect } from 'vitest';
import { meshVolumeM3 } from '../../../src/building-studio/mesh/generate.ts';
import { faceVertices, triangulateFace } from '../../../src/building-studio/mesh/triangulate.ts';
import {
  faceNormal,
  type StudioFace,
  type StudioMesh,
  type Vec3,
} from '../../../src/building-studio/mesh/types.ts';
import { GENERATORS, type ModelConfigV1, type RoofShape } from '../../../src/building-studio/schema.ts';
import { model } from './fixtures.ts';

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const crossV = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const newellArea = (r: readonly Vec3[]) => {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < r.length; i++) {
    const c = crossV(r[i]!, r[(i + 1) % r.length]!);
    n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
  }
  return Math.hypot(...n) / 2;
};

/** Area of a planar face (holes subtracted). */
export const faceArea = (f: StudioFace) =>
  newellArea(f.ring) - (f.holes ?? []).reduce((s, h) => s + newellArea(h), 0);

/** Area covered by the face's triangles. */
export const triArea = (f: StudioFace) => {
  const v = faceVertices(f);
  const t = triangulateFace(f);
  let a = 0;
  for (let i = 0; i < t.length; i += 3)
    a += Math.hypot(...crossV(sub(v[t[i + 1]!]!, v[t[i]!]!), sub(v[t[i + 2]!]!, v[t[i]!]!))) / 2;
  return a;
};

const key = (v: Vec3) => v.map((x) => (Math.round(x * 1e5) / 1e5 + 0).toFixed(5)).join(',');

/** Directed edges of every face ring and hole. */
function edges(f: StudioFace): [string, string][] {
  return [f.ring, ...(f.holes ?? [])].flatMap((r) =>
    r.map((v, i) => [key(v), key(r[(i + 1) % r.length]!)] as [string, string]),
  );
}

/**
 * Every face well-formed (planar, unit Newell normal, ≥ 3 vertices, positive
 * area, exact consistent triangulation), the surface closed (every directed
 * edge is matched by its reverse) and every connected solid outward-facing
 * (positive signed volume).
 */
export function expectClosedOutward(mesh: StudioMesh, label = ''): void {
  for (const f of mesh.faces) {
    expect(f.ring.length, label).toBeGreaterThanOrEqual(3);
    expect(Math.hypot(...f.normal), label).toBeCloseTo(1, 9);
    const n = faceNormal(f.ring);
    for (let k = 0; k < 3; k++) expect(f.normal[k], label).toBeCloseTo(n[k]!, 9);
    for (const v of faceVertices(f))
      expect(Math.abs(dot(sub(v, f.ring[0]!), f.normal)), label).toBeLessThan(1e-3);
    const area = faceArea(f);
    expect(area, `${label} degenerate ${f.material} face`).toBeGreaterThan(1e-6);
    expect(triArea(f), label).toBeCloseTo(area, 5);
    const v = faceVertices(f);
    const t = triangulateFace(f);
    for (let i = 0; i < t.length; i += 3)
      expect(
        dot(crossV(sub(v[t[i + 1]!]!, v[t[i]!]!), sub(v[t[i + 2]!]!, v[t[i]!]!)), f.normal),
        label,
      ).toBeGreaterThan(0);
    if (f.windows) expect(f.material, label).toBe('wall');
  }
  // Closed: directed edge multiset equals its reverse. Components via shared edges.
  const count = new Map<string, number>();
  const owner = new Map<string, number[]>();
  mesh.faces.forEach((f, fi) =>
    edges(f).forEach(([a, b]) => {
      count.set(`${a}|${b}`, (count.get(`${a}|${b}`) ?? 0) + 1);
      const u = a < b ? `${a}|${b}` : `${b}|${a}`;
      owner.set(u, [...(owner.get(u) ?? []), fi]);
    }),
  );
  for (const [k, c] of count) {
    const [a, b] = k.split('|');
    expect(count.get(`${b}|${a}`) ?? 0, `${label} unmatched edge ${k}`).toBe(c);
  }
  const parent = mesh.faces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (const fs of owner.values()) for (const f of fs) parent[find(f)] = find(fs[0]!);
  const groups = new Map<number, StudioFace[]>();
  mesh.faces.forEach((f, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), f]));
  for (const faces of groups.values())
    expect(meshVolumeM3({ faces }), `${label} solid volume`).toBeGreaterThan(0);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const between = (r: () => number, min: number, max: number, step = 0.1) =>
  Math.min(max, Math.max(min, Number((Math.round((min + r() * (max - min)) / step) * step).toFixed(4))));

/** `n` varied, schema-valid configs covering every generator, roof, pattern and detail level. */
export function variedModels(n: number, seed = 7): ModelConfigV1[] {
  const r = rng(seed);
  const gens = ['box', 'l-shape', 'u-shape', 'hall', 'tower-podium', 'kiosk-canopy', 'stepped'] as const;
  const out: ModelConfigV1[] = [];
  for (let i = 0; i < n; i++) {
    const g = gens[i % gens.length]!;
    const floors = 1 + Math.floor(r() * 12);
    const floorHeightM = between(r, 2.8, 4.2);
    const widthM = between(r, 8, 60);
    const lengthM = between(r, 8, 80);
    const roofShape: RoofShape = pick(r, GENERATORS[g].roofs);
    const pattern = pick(r, ['none', 'ribbon', 'punched', 'grid', 'curtain'] as const);
    let shape: ModelConfigV1['shape'];
    let f = floors;
    switch (g) {
      case 'l-shape':
        shape = {
          kind: g,
          notchWidthFrac: between(r, 0.2, 0.8, 0.05),
          notchLengthFrac: between(r, 0.2, 0.8, 0.05),
          notchCorner: pick(r, ['front-left', 'front-right', 'back-left', 'back-right'] as const),
        };
        break;
      case 'u-shape':
        shape = {
          kind: g,
          courtyardWidthFrac: between(r, 0.2, 0.8, 0.05),
          courtyardDepthFrac: between(r, 0.2, 0.8, 0.05),
          openSide: pick(r, ['front', 'back', 'left', 'right', 'none'] as const),
        };
        break;
      case 'tower-podium':
        f = Math.max(floors, 3);
        shape = {
          kind: g,
          podiumFloors: 1 + Math.floor(r() * Math.min(6, f - 1)),
          towerWidthFrac: between(r, 0.25, 0.9, 0.05),
          towerLengthFrac: between(r, 0.25, 0.9, 0.05),
        };
        break;
      case 'kiosk-canopy':
        shape = {
          kind: g,
          canopyDepthFrac: between(r, 0.1, 0.6, 0.05),
          canopySide: pick(r, ['front', 'back', 'left', 'right'] as const),
        };
        break;
      case 'stepped': {
        const tiers = 2 + Math.floor(r() * 3);
        f = Math.max(floors, tiers);
        const maxSetback = Math.max(0.5, (Math.min(widthM, lengthM) - 2) / (2 * (tiers - 1)) - 0.1);
        shape = { kind: g, tiers, setbackM: Math.min(20, between(r, 0.5, maxSetback)) };
        break;
      }
      default:
        shape = { kind: g };
    }
    out.push(
      model({
        anchor: [75.7032 + (r() - 0.5) * 0.01, 31.2533 + (r() - 0.5) * 0.01],
        rotationDeg: Math.round(r() * 3590) / 10,
        generatorId: g,
        widthM,
        lengthM,
        floors: f,
        floorHeightM,
        heightM: Math.round(f * floorHeightM * 100) / 100,
        baseOffsetM: r() < 0.2 ? between(r, 0.5, 3) : 0,
        shape,
        roof:
          roofShape === 'shed' || roofShape === 'gable' || roofShape === 'hip'
            ? { shape: roofShape, pitchDeg: between(r, 5, 40, 1), colour: '#884433', material: 'tile' }
            : { shape: roofShape, colour: '#999999', material: 'concrete' },
        facade: {
          material: 'plaster',
          wallColour: '#e8dcc8',
          windowPattern: pattern,
          windowDensity: pattern === 'none' ? 0 : between(r, 0.2, 0.8, 0.05),
          balconies: r() < 0.4,
          entranceSide: pick(r, ['front', 'back', 'left', 'right', 'none'] as const),
        },
        detailLevel: pick(r, ['massing', 'roof', 'facade', 'details'] as const),
      }),
    );
  }
  return out;
}
