/**
 * Every generator (box, l-shape, u-shape, hall, tower-podium, kiosk-canopy,
 * stepped): closed outward bodies, exact volumes, footprints that match the
 * derived footprint, rotation invariance, detail levels, budgets and
 * determinism (docs/BUILDING_STUDIO_DESIGN.md §3.1, §4.3).
 */
import { describe, expect, it } from 'vitest';
import { deriveFootprint, localPolygonAreaM2 } from '../../../src/building-studio/footprint.ts';
import { meshHash } from '../../../src/building-studio/mesh/cache.ts';
import {
  DETAIL_SIZES,
  generateStudioMesh,
  generateStudioMeshDetailed,
  meshTriangleCount,
  meshVolumeM3,
  TRIANGLE_BUDGET,
} from '../../../src/building-studio/mesh/generate.ts';
import type { StudioMesh } from '../../../src/building-studio/mesh/types.ts';
import type { ModelConfigV1 } from '../../../src/building-studio/schema.ts';
import { polygonAreaM2 } from '../../../src/geo/boundary.ts';
import { model } from './fixtures.ts';
import { expectClosedOutward, variedModels } from './mesh-asserts.ts';

const gen = (m: ModelConfigV1): StudioMesh => {
  const r = generateStudioMesh(m);
  if (!r.ok) throw new Error(`${m.generatorId}: ${r.message}`);
  return r.mesh;
};

const base = (over: Partial<ModelConfigV1>) =>
  model({
    rotationDeg: 0,
    widthM: 20,
    lengthM: 40,
    heightM: 12.8,
    floors: 4,
    floorHeightM: 3.2,
    detailLevel: 'massing',
    ...over,
  });

const W = 20;
const L = 40;
const H = 12.8;

const shapes: [string, Partial<ModelConfigV1>, number][] = [
  ['box', {}, W * L * H],
  [
    'l-shape',
    {
      generatorId: 'l-shape',
      shape: { kind: 'l-shape', notchWidthFrac: 0.5, notchLengthFrac: 0.4, notchCorner: 'back-right' },
    },
    (W * L - 10 * 16) * H,
  ],
  [
    'u-shape open',
    {
      generatorId: 'u-shape',
      shape: { kind: 'u-shape', courtyardWidthFrac: 0.5, courtyardDepthFrac: 0.5, openSide: 'front' },
    },
    (W * L - 10 * 20) * H,
  ],
  [
    'u-shape courtyard',
    {
      generatorId: 'u-shape',
      shape: { kind: 'u-shape', courtyardWidthFrac: 0.4, courtyardDepthFrac: 0.6, openSide: 'none' },
    },
    (W * L - 8 * 24) * H,
  ],
  ['hall', { generatorId: 'hall', shape: { kind: 'hall' } }, W * L * H],
  [
    'tower-podium',
    {
      generatorId: 'tower-podium',
      shape: { kind: 'tower-podium', podiumFloors: 1, towerWidthFrac: 0.5, towerLengthFrac: 0.25 },
    },
    W * L * 3.2 + 10 * 10 * 9.6,
  ],
  [
    'kiosk-canopy',
    {
      generatorId: 'kiosk-canopy',
      shape: { kind: 'kiosk-canopy', canopyDepthFrac: 0.25, canopySide: 'left' },
    },
    15 * L * H + 5 * L * DETAIL_SIZES.kioskCanopySlabM,
  ],
  [
    'stepped',
    {
      generatorId: 'stepped',
      roof: { shape: 'stepped', colour: '#999999', material: 'concrete' },
      shape: { kind: 'stepped', tiers: 2, setbackM: 3 },
    },
    W * L * 6.4 + 14 * 34 * 6.4,
  ],
];

describe('generators: exact massing volumes and closed outward bodies', () => {
  for (const [name, over, volume] of shapes)
    it(name, () => {
      const m = gen(base(over));
      expect(m.closed).toBe(true);
      expectClosedOutward(m, name);
      expect(meshVolumeM3(m)).toBeCloseTo(volume, 4);
      // The mesh footprint is exactly the derived footprint.
      const fp = deriveFootprint(base(over));
      if (!fp.ok) throw new Error(fp.message);
      expect(localPolygonAreaM2(m.footprint)).toBeCloseTo(fp.areaM2, 6);
    });

  it('the closed courtyard footprint has one clockwise hole and is valid GeoJSON (RFC 7946)', () => {
    const fp = deriveFootprint(base(shapes[3]![1]));
    if (!fp.ok) throw new Error(fp.message);
    const rings = fp.footprint.coordinates;
    expect(rings).toHaveLength(2);
    const signed = (r: readonly (readonly number[])[]) =>
      r.slice(0, -1).reduce((s, p, i) => s + (p[0]! * r[i + 1]![1]! - r[i + 1]![0]! * p[1]!), 0);
    expect(signed(rings[0]!)).toBeGreaterThan(0); // exterior counter-clockwise
    expect(signed(rings[1]!)).toBeLessThan(0); // hole clockwise
    for (const r of rings) expect(r[0]).toEqual(r.at(-1));
  });
});

describe('property checks on 210 varied configs (every generator, roof, pattern and level)', () => {
  const models = variedModels(210);

  it('all generate, close, face outwards and stay within the triangle budget', () => {
    for (const [i, m] of models.entries()) {
      const r = generateStudioMeshDetailed(m);
      if (!r.ok) throw new Error(`#${i} ${m.generatorId}: ${r.message}`);
      expectClosedOutward(r.mesh, `#${i} ${m.generatorId}/${m.roof.shape}/${m.detailLevel}`);
      expect(meshVolumeM3(r.mesh)).toBeGreaterThan(0);
      expect(r.triangles).toBe(meshTriangleCount(r.mesh));
      expect(r.triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET[r.renderedDetailLevel]);
    }
  });

  it('footprints: rings closed, exterior CCW, area = derived area; box area = w × l within 0.1 %', () => {
    for (const m of models) {
      const fp = deriveFootprint(m);
      if (!fp.ok) throw new Error(fp.message);
      for (const ring of fp.footprint.coordinates) expect(ring[0]).toEqual(ring.at(-1));
      const geoArea = polygonAreaM2(fp.footprint);
      expect(Math.abs(geoArea - fp.areaM2) / fp.areaM2).toBeLessThan(1e-3);
      if (m.generatorId === 'box' || m.generatorId === 'hall' || m.generatorId === 'kiosk-canopy')
        expect(Math.abs(geoArea - m.widthM * m.lengthM) / (m.widthM * m.lengthM)).toBeLessThan(1e-3);
    }
  });

  it('rotation preserves area, height, volume and edge lengths', () => {
    for (const m of models.slice(0, 70)) {
      const a = gen({ ...m, rotationDeg: 0 });
      const b = gen({ ...m, rotationDeg: 137.5 });
      expect(localPolygonAreaM2(b.footprint)).toBeCloseTo(localPolygonAreaM2(a.footprint), 6);
      expect(meshVolumeM3(b)).toBeCloseTo(meshVolumeM3(a), 5);
      expect(b.bbox.max[2]).toBeCloseTo(a.bbox.max[2], 9);
      const lens = (s: StudioMesh) =>
        s.footprint[0]!.map((p, i, r) =>
          Math.hypot(r[(i + 1) % r.length]![0] - p[0], r[(i + 1) % r.length]![1] - p[1]),
        ).sort();
      const la = lens(a);
      lens(b).forEach((l, i) => expect(l).toBeCloseTo(la[i]!, 6));
    }
  });

  it('is deterministic: identical meshes and hashes on repeated generation', () => {
    const first = models.map((m) => meshHash(gen(m)));
    const again = models.map((m) => meshHash(gen(structuredClone(m))));
    expect(again).toEqual(first);
    expect(new Set(first).size).toBe(models.length);
  });
});

describe('detail levels (cumulative) and honest details', () => {
  const hostel = (level: ModelConfigV1['detailLevel'], over: Partial<ModelConfigV1> = {}) =>
    gen(
      model({
        rotationDeg: 0,
        widthM: 16,
        lengthM: 60,
        floors: 6,
        floorHeightM: 3.2,
        heightM: 19.2,
        roof: { shape: 'hip', pitchDeg: 25, colour: '#7d4537', material: 'tile' },
        facade: {
          material: 'plaster',
          wallColour: '#efe4d2',
          windowPattern: 'punched',
          windowDensity: 0.35,
          balconies: true,
          entranceSide: 'front',
        },
        detailLevel: level,
        ...over,
      }),
    );

  it('massing → flat top, no windows; roof → pitched; facade → windows; details → balconies + entrance', () => {
    const massing = hostel('massing');
    expect(massing.bbox.max[2]).toBeCloseTo(19.2, 9);
    expect(massing.faces.some((f) => f.windows)).toBe(false);
    const roof = hostel('roof');
    expect(roof.bbox.max[2]).toBeGreaterThan(19.2);
    expect(roof.faces.some((f) => f.windows)).toBe(false);
    const facade = hostel('facade');
    expect(facade.faces.some((f) => f.windows)).toBe(true);
    expect(facade.faces.some((f) => f.material === 'trim' || f.material === 'glass')).toBe(false);
    const details = hostel('details');
    // 5 upper floors × 4 walls (all ≥ 6 m) of balcony slabs (6 faces each), plus a door and a canopy.
    expect(details.faces.filter((f) => f.material === 'trim').length).toBe(5 * 4 * 6 + 6);
    expect(details.faces.filter((f) => f.material === 'glass')).toHaveLength(6);
  });

  it('no balconies when not asked for or on one floor; no entrance when the side is none', () => {
    const flat = { shape: 'flat', colour: '#999999', material: 'concrete' } as const;
    const noBalc = hostel('details', {
      roof: flat,
      facade: { ...model().facade, balconies: false, entranceSide: 'none' },
    });
    // Only the parapet (one annular ring: 2 × 4 walls + top + base).
    expect(noBalc.faces.filter((f) => f.material === 'trim')).toHaveLength(10);
    expect(noBalc.faces.some((f) => f.material === 'glass')).toBe(false);
    const oneFloor = hostel('details', { floors: 1, heightM: 3.2 });
    expect(oneFloor.faces.filter((f) => f.material === 'trim')).toHaveLength(6); // entrance canopy only
  });

  it('the entrance is on the wall facing entranceSide (model-local; rotated with the model)', () => {
    for (const [side, axis, sign] of [
      ['front', 1, 1],
      ['back', 1, -1],
      ['left', 0, -1],
      ['right', 0, 1],
    ] as const) {
      const m = hostel('details', { facade: { ...model().facade, balconies: false, entranceSide: side } });
      const door = m.faces.filter((f) => f.material === 'glass').flatMap((f) => f.ring);
      const c = door.reduce((s, v) => s + v[axis], 0) / door.length;
      expect(Math.sign(c), side).toBe(sign);
      expect(Math.abs(c), side).toBeGreaterThan(axis === 1 ? 29 : 7);
    }
  });

  it('over budget → the next lower level is generated and reported', () => {
    const big = model({
      rotationDeg: 0,
      generatorId: 'u-shape',
      shape: { kind: 'u-shape', courtyardWidthFrac: 0.3, courtyardDepthFrac: 0.3, openSide: 'none' },
      widthM: 300,
      lengthM: 300,
      floors: 400,
      floorHeightM: 3,
      heightM: 1200,
      facade: { ...model().facade, balconies: true },
      detailLevel: 'details',
    });
    const r = generateStudioMeshDetailed(big);
    if (!r.ok) throw new Error(r.message);
    expect(r.requestedDetailLevel).toBe('details');
    expect(r.renderedDetailLevel).toBe('facade');
    expect(r.triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET.facade);
  });

  it('kiosk posts appear only at details, under the outer canopy corners', () => {
    const k = (level: ModelConfigV1['detailLevel']) =>
      gen(
        model({
          rotationDeg: 0,
          generatorId: 'kiosk-canopy',
          shape: { kind: 'kiosk-canopy', canopyDepthFrac: 0.3, canopySide: 'front' },
          widthM: 8,
          lengthM: 10,
          heightM: 3.5,
          floors: 1,
          floorHeightM: 3.5,
          facade: { ...model().facade, entranceSide: 'none' },
          detailLevel: level,
        }),
      );
    const posts = (m: StudioMesh) =>
      m.faces.filter((f) => f.material === 'trim' && f.ring.some((v) => v[2] === 0) && f.normal[2] === 0);
    expect(posts(k('facade'))).toHaveLength(0);
    const d = posts(k('details'));
    expect(d).toHaveLength(8); // 2 posts × 4 sides
    for (const f of d) for (const v of f.ring) expect(v[1]).toBeGreaterThan(4.7); // canopy outer edge at y = 5
  });
});
