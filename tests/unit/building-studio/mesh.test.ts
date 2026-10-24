/**
 * StudioMesh contract (src/building-studio/mesh/*) and footprint derivation
 * (src/building-studio/footprint.ts): closed, outward-facing, planar faces;
 * exact volumes; deterministic; metre-accurate local frame.
 */
import { describe, expect, it } from 'vitest';
import { haversineM } from '../../../src/distance/geodesic.ts';
import {
  createEnuFrame,
  deriveFootprint,
  localPolygonAreaM2,
  rotateToEnu,
} from '../../../src/building-studio/footprint.ts';
import {
  fallbackPrismMesh,
  generateStudioMesh,
  meshVolumeM3,
  WINDOW_BAY_M,
} from '../../../src/building-studio/mesh/generate.ts';
import { faceVertices, triangulateFace } from '../../../src/building-studio/mesh/triangulate.ts';
import {
  faceNormal,
  type StudioFace,
  type StudioMesh,
  type Vec3,
} from '../../../src/building-studio/mesh/types.ts';
import type { ModelConfigV1 } from '../../../src/building-studio/schema.ts';
import { ANCHOR, FOOTPRINT, model, published } from './fixtures.ts';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossV = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const centroid = (vs: readonly Vec3[]): Vec3 => {
  const s = vs.reduce<Vec3>((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]);
  return [s[0] / vs.length, s[1] / vs.length, s[2] / vs.length];
};
/** Area of a planar face (holes subtracted) from Newell vectors. */
const faceArea = (f: StudioFace) => {
  const ringArea = (r: readonly Vec3[]) => {
    let n: Vec3 = [0, 0, 0];
    for (let i = 0; i < r.length; i++)
      n = [
        n[0] + crossV(r[i]!, r[(i + 1) % r.length]!)[0],
        n[1] + crossV(r[i]!, r[(i + 1) % r.length]!)[1],
        n[2] + crossV(r[i]!, r[(i + 1) % r.length]!)[2],
      ];
    return Math.hypot(...n) / 2;
  };
  return ringArea(f.ring) - (f.holes ?? []).reduce((s, h) => s + ringArea(h), 0);
};
const triArea = (f: StudioFace) => {
  const v = faceVertices(f);
  const t = triangulateFace(f);
  let a = 0;
  for (let i = 0; i < t.length; i += 3)
    a += Math.hypot(...crossV(sub(v[t[i + 1]!]!, v[t[i]!]!), sub(v[t[i + 2]!]!, v[t[i]!]!))) / 2;
  return a;
};

function expectWellFormed(mesh: StudioMesh) {
  const body = centroid(mesh.faces.flatMap((f) => f.ring));
  for (const f of mesh.faces) {
    expect(f.ring.length).toBeGreaterThanOrEqual(3);
    expect(Math.hypot(...f.normal)).toBeCloseTo(1, 9);
    // The stored normal is the Newell normal of the ring (counter-clockwise from outside).
    const n = faceNormal(f.ring);
    for (let k = 0; k < 3; k++) expect(f.normal[k]).toBeCloseTo(n[k]!, 9);
    // Planar within 1 mm.
    for (const v of faceVertices(f)) expect(Math.abs(dot(sub(v, f.ring[0]!), f.normal))).toBeLessThan(1e-3);
    // Triangles cover the face exactly and keep its winding.
    expect(triArea(f)).toBeCloseTo(faceArea(f), 6);
    const v = faceVertices(f);
    const t = triangulateFace(f);
    for (let i = 0; i < t.length; i += 3)
      expect(
        dot(crossV(sub(v[t[i + 1]!]!, v[t[i]!]!), sub(v[t[i + 2]!]!, v[t[i]!]!)), f.normal),
      ).toBeGreaterThan(0);
    // Outward for convex bodies: normal points away from the body centroid.
    if (mesh.faces.length <= 8) expect(dot(f.normal, sub(centroid(f.ring), body))).toBeGreaterThan(0);
  }
}

const boxModel = (over: Partial<ModelConfigV1> = {}) => model({ rotationDeg: 0, ...over });

describe('local frame (S5): equirectangular at the anchor', () => {
  it('is accurate to < 1 cm at 300 m in every direction (vs haversine)', () => {
    const f = createEnuFrame(ANCHOR);
    let worst = 0;
    for (let deg = 0; deg < 360; deg += 15) {
      const t = (deg * Math.PI) / 180;
      const p = f.toLngLat([300 * Math.sin(t), 300 * Math.cos(t)]);
      worst = Math.max(worst, Math.abs(haversineM(ANCHOR, p) - 300));
      // Pairwise distance between two far points too (chord across the frame).
      const q = f.toLngLat([-300 * Math.sin(t), -300 * Math.cos(t)]);
      worst = Math.max(worst, Math.abs(haversineM(p, q) - 600) / 2);
    }
    expect(worst).toBeLessThan(0.01);
    const back = f.toLocal(f.toLngLat([123.4, -56.7]));
    expect(back[0]).toBeCloseTo(123.4, 9);
    expect(back[1]).toBeCloseTo(-56.7, 9);
  });

  it('rotation is clockwise from north and preserves orientation', () => {
    const [e, n] = rotateToEnu([0, 10], 90); // forward (north at 0°) → east at 90°
    expect(e).toBeCloseTo(10, 9);
    expect(n).toBeCloseTo(0, 9);
    const [e2, n2] = rotateToEnu([10, 0], 90); // right (east at 0°) → south at 90°
    expect(e2).toBeCloseTo(0, 9);
    expect(n2).toBeCloseTo(-10, 9);
  });
});

describe('deriveFootprint (server-recomputed; client footprints are ignored)', () => {
  it('box: width × length rectangle around the anchor, closed, counter-clockwise', () => {
    const r = deriveFootprint(boxModel({ rotationDeg: 37 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.areaM2).toBeCloseTo(800, 6);
    const ring = r.footprint.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(localPolygonAreaM2(r.local)).toBeCloseTo(800, 6);
    // Edge lengths in metres survive the lon/lat round trip (< 1 cm).
    expect(haversineM(ring[0]!, ring[1]!)).toBeCloseTo(20, 2);
    expect(haversineM(ring[1]!, ring[2]!)).toBeCloseTo(40, 2);
  });

  it('rotation 90°: the length runs east–west', () => {
    const r = deriveFootprint(boxModel({ rotationDeg: 90 }));
    if (!r.ok) throw new Error(r.message);
    const xs = r.local[0]!.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 9);
  });

  it('footprint-prism returns the base footprint; it needs one', () => {
    const m = boxModel({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } });
    expect(deriveFootprint(m)).toMatchObject({ ok: false, reason: 'missing-base-footprint' });
    const r = deriveFootprint(m, { baseFootprint: FOOTPRINT.coordinates });
    expect(r.ok).toBe(true);
    if (r.ok)
      for (const [i, p] of r.footprint.coordinates[0]!.entries())
        for (const k of [0, 1]) expect(p[k]).toBeCloseTo(FOOTPRINT.coordinates[0]![i]![k]!, 12);
  });

  it('every generator derives a footprint; the mesh footprint is the same polygon', () => {
    const m = boxModel({
      generatorId: 'l-shape',
      shape: { kind: 'l-shape', notchWidthFrac: 0.5, notchLengthFrac: 0.5, notchCorner: 'front-left' },
    });
    const r = deriveFootprint(m);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.areaM2).toBeCloseTo(800 - 200, 6);
    const mesh = generateStudioMesh(m);
    expect(mesh.ok).toBe(true);
    if (mesh.ok) expect(localPolygonAreaM2(mesh.mesh.footprint)).toBeCloseTo(r.areaM2, 6);
  });

  it('impossible parameters are reported as invalid geometry, never repaired', () => {
    const podium = boxModel({
      generatorId: 'tower-podium',
      floors: 2,
      shape: { kind: 'tower-podium', podiumFloors: 2, towerWidthFrac: 0.5, towerLengthFrac: 0.5 },
    });
    expect(deriveFootprint(podium)).toMatchObject({ ok: false, reason: 'invalid-geometry' });
    expect(generateStudioMesh(podium)).toMatchObject({ ok: false, reason: 'invalid-geometry' });
  });
});

describe('generateStudioMesh: box', () => {
  const W = 20;
  const L = 40;
  const H = 12.8;
  const gen = (over: Partial<ModelConfigV1> = {}) => {
    const r = generateStudioMesh(boxModel(over));
    if (!r.ok) throw new Error(r.message);
    return r.mesh;
  };

  it('flat: 6 closed, outward, planar faces; exact volume and bbox', () => {
    const m = gen();
    expect(m.faces).toHaveLength(6);
    expect(m.closed).toBe(true);
    expect(m.origin).toEqual(ANCHOR);
    expectWellFormed(m);
    expect(meshVolumeM3(m)).toBeCloseTo(W * L * H, 6);
    expect(m.bbox).toEqual({ min: [-10, -20, 0], max: [10, 20, H] });
    expect(m.faces.map((f) => f.material).sort()).toEqual(['base', 'roof', 'wall', 'wall', 'wall', 'wall']);
  });

  it('gable / hip / shed: closed bodies with the documented roof volumes', () => {
    const p = 30;
    const tan = Math.tan((p * Math.PI) / 180);
    const A = W / 2;
    const B = L / 2;
    const cases: [ModelConfigV1['roof']['shape'], number, number][] = [
      ['gable', W * L * H + 0.5 * W * (A * tan) * L, 7],
      ['hip', W * L * H + 2 * A * (A * tan) * (B - A) + (4 / 3) * A * A * (A * tan), 9],
      ['shed', W * L * H + 0.5 * W * (W * tan) * L, 6],
    ];
    for (const [shape, volume, faces] of cases) {
      const m = gen({ roof: { shape, pitchDeg: p, colour: '#884433', material: 'tile' } });
      expect(m.faces, shape).toHaveLength(faces);
      expectWellFormed(m);
      expect(meshVolumeM3(m), shape).toBeCloseTo(volume, 6);
    }
  });

  it('gable and hip ridges follow the longer side; a square hip is a pyramid', () => {
    const wide = gen({
      widthM: 40,
      lengthM: 20,
      roof: { shape: 'gable', pitchDeg: 30, colour: '#884433', material: 'tile' },
    });
    const apexes = wide.faces.flatMap((f) => f.ring).filter((v) => v[2] > H + 1e-9);
    expect(new Set(apexes.map((v) => v[1].toFixed(6)))).toEqual(new Set(['0.000000'])); // ridge along x
    const sq = gen({
      widthM: 20,
      lengthM: 20,
      roof: { shape: 'hip', pitchDeg: 30, colour: '#884433', material: 'tile' },
    });
    expectWellFormed(sq);
    expect(sq.faces.filter((f) => f.material === 'roof').every((f) => f.ring.length === 3)).toBe(true);
  });

  it('rotation and base offset keep shape and volume; the mesh is already in east/north/up', () => {
    const m = gen({ rotationDeg: 123, baseOffsetM: 2.5 });
    expectWellFormed(m);
    expect(meshVolumeM3(m)).toBeCloseTo(W * L * H, 6);
    expect(m.bbox.min[2]).toBeCloseTo(2.5, 9);
    expect(localPolygonAreaM2(m.footprint)).toBeCloseTo(W * L, 6);
  });

  it('window grids only on walls, from the facade level; massing has a flat top and none', () => {
    const m = gen();
    const walls = m.faces.filter((f) => f.material === 'wall');
    expect(walls.every((f) => f.windows !== undefined)).toBe(true);
    const long = walls.find((f) => Math.abs(f.ring[0]![1] - f.ring[1]![1]) > 30)!;
    expect(long.windows).toEqual({
      pattern: 'punched',
      floorHeightM: 3.2,
      floors: 4,
      bottomM: 0,
      columns: Math.round(L / WINDOW_BAY_M),
      density: 0.4,
    });
    // Bottom edge first, left to right from outside (z of ring[0] and ring[1] is the wall base).
    expect(long.ring[0]![2]).toBe(0);
    expect(long.ring[1]![2]).toBe(0);
    const massing = gen({
      detailLevel: 'massing',
      roof: { shape: 'hip', pitchDeg: 30, colour: '#884433', material: 'tile' },
    });
    expect(massing.faces).toHaveLength(6);
    expect(massing.faces.some((f) => f.windows)).toBe(false);
    expect(gen({ detailLevel: 'roof' }).faces.some((f) => f.windows)).toBe(false);
    expect(
      gen({ facade: { ...model().facade, windowPattern: 'none', windowDensity: 0 } }).faces.some(
        (f) => f.windows,
      ),
    ).toBe(false);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(gen({ rotationDeg: 17 }))).toBe(JSON.stringify(gen({ rotationDeg: 17 })));
  });

  it('refuses an unsupported model instead of reinterpreting it', () => {
    expect(generateStudioMesh({ ...boxModel(), generatorVersion: 9 })).toMatchObject({
      ok: false,
      reason: 'unsupported-model',
    });
  });
});

describe('footprint-prism and the S2 fallback prism', () => {
  /** A 30 × 30 m courtyard block (10 × 10 m hole) around ANCHOR. */
  const f = createEnuFrame(ANCHOR);
  const sq = (h: number) => [
    f.toLngLat([-h, -h]),
    f.toLngLat([h, -h]),
    f.toLngLat([h, h]),
    f.toLngLat([-h, h]),
    f.toLngLat([-h, -h]),
  ];
  const courtyard = [sq(15), [...sq(5)].reverse()];

  it('extrudes the base footprint (holes included) to the body height', () => {
    const r = generateStudioMesh(
      boxModel({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } }),
      { baseFootprint: courtyard },
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.mesh.faces).toHaveLength(2 + 8);
    const roof = r.mesh.faces.find((x) => x.material === 'roof')!;
    expect(roof.holes).toHaveLength(1);
    expect(triArea(roof)).toBeCloseTo(900 - 100, 4);
    expect(meshVolumeM3(r.mesh)).toBeCloseTo((900 - 100) * 12.8, 3);
    for (const face of r.mesh.faces) expect(triArea(face)).toBeCloseTo(faceArea(face), 4);
  });

  it('fallback: the published footprint × [baseOffsetM, baseOffsetM + heightM], never dropped', () => {
    const b = published({ model: { ...model(), modelConfigVersion: 9, baseOffsetM: 1 } as never });
    const m = fallbackPrismMesh(b);
    expect(m.origin).toEqual(ANCHOR);
    expect(m.faces.some((x) => x.windows)).toBe(false);
    const area = localPolygonAreaM2(m.footprint);
    expect(meshVolumeM3(m)).toBeCloseTo(area * 12.8, 3);
    expect(m.bbox.min[2]).toBeCloseTo(1, 9);
    // Without an anchor the origin is the footprint's vertex mean.
    const { anchor: _a, ...noAnchor } = model();
    const m2 = fallbackPrismMesh({ footprint: b.footprint, model: noAnchor as never });
    expect(m2.origin[0]).toBeCloseTo(75.7032, 9);
    expect(m2.origin[1]).toBeCloseTo(31.2533, 9);
  });
});

describe('triangulateFace', () => {
  const flat = (pts: [number, number][], holes: [number, number][][] = []): StudioFace => ({
    ring: pts.map(([x, y]) => [x, y, 0]),
    ...(holes.length ? { holes: holes.map((h) => h.map(([x, y]) => [x, y, 0] as Vec3)) } : {}),
    normal: [0, 0, 1],
    material: 'roof',
  });

  it('handles concave rings (L-shape) and collinear vertices', () => {
    const l = flat([
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 30],
      [5, 30],
      [0, 30],
      [0, 15],
    ]);
    expect(triArea(l)).toBeCloseTo(20 * 10 + 10 * 20, 9);
    expect(triangulateFace(l).length / 3).toBeGreaterThanOrEqual(l.ring.length - 2 - 2);
  });

  it('handles several holes', () => {
    const f = flat(
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      [
        [
          [2, 2],
          [2, 8],
          [8, 8],
          [8, 2],
        ],
        [
          [20, 10],
          [20, 18],
          [28, 18],
          [28, 10],
        ],
      ],
    );
    expect(triArea(f)).toBeCloseTo(600 - 36 - 64, 9);
  });

  it('works on vertical and downward faces (projection keeps the winding)', () => {
    const wall: StudioFace = {
      ring: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 0, 5],
        [5, 0, 8],
        [0, 0, 5],
      ],
      normal: [0, -1, 0],
      material: 'wall',
    };
    expect(triArea(wall)).toBeCloseTo(50 + 15, 9);
    const base: StudioFace = {
      ring: [
        [0, 0, 0],
        [0, 10, 0],
        [10, 10, 0],
        [10, 0, 0],
      ],
      normal: [0, 0, -1],
      material: 'base',
    };
    expect(triArea(base)).toBeCloseTo(100, 9);
  });
});

describe('footprint-prism on every real campus footprint (public/data, read-only)', () => {
  it('builds a closed prism whose triangles cover each face exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { buildingsFileSchema } = await import('../../../src/data/schema.ts');
    const { polygonAreaM2 } = await import('../../../src/geo/boundary.ts');
    const fc = buildingsFileSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'buildings.geojson'), 'utf8')),
    );
    let withHoles = 0;
    for (const feat of fc.features) {
      if (feat.geometry.type !== 'Polygon') continue;
      const coords = feat.geometry.coordinates as [number, number][][];
      if (coords.length > 1) withHoles++;
      const anchor: [number, number] = [feat.properties.anchorLon, feat.properties.anchorLat];
      const r = generateStudioMesh(
        model({ anchor, generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' }, rotationDeg: 0 }),
        { baseFootprint: coords },
      );
      if (!r.ok) throw new Error(`${feat.properties.id}: ${r.message}`);
      const area = polygonAreaM2(feat.geometry as never);
      const roof = r.mesh.faces.find((x) => x.material === 'roof')!;
      expect(Math.abs(triArea(roof) - area) / area, feat.properties.id).toBeLessThan(1e-3);
      expect(Math.abs(meshVolumeM3(r.mesh) - area * 12.8) / (area * 12.8), feat.properties.id).toBeLessThan(
        1e-3,
      );
    }
    expect(fc.features.length).toBeGreaterThan(100);
    expect(withHoles, 'the real data exercises a footprint with a courtyard hole').toBeGreaterThanOrEqual(1);
  });
});
