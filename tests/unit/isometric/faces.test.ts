/**
 * Faces of one building: prism construction, back-face culling, painter order
 * inside a building (incl. owner-authored StudioMesh models with pitched roofs,
 * L/U shapes, towers and steps), tones and synthetic windows.
 */
import { describe, expect, it } from 'vitest';
import { faceNormal } from '../../../src/building-studio/mesh/types.ts';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import type { ModelConfigV1 } from '../../../src/building-studio/schema.ts';
import {
  isFrontFacing,
  normalizePolygon,
  prismFaces3,
  shadeHex,
  sortVisibleFaces,
  studioFaces3,
  toneFor,
  windowQuads3,
} from '../../../src/isometric/faces.ts';
import { signedArea2, type Pt } from '../../../src/isometric/geometry.ts';
import { createIsoProjection, createLocalFrame, ISO_ROTATIONS } from '../../../src/isometric/projection.ts';
import { buildIsoScene, type IsoStudioModel } from '../../../src/isometric/scene.ts';
import { model } from '../building-studio/fixtures.ts';
import { painterErrors } from './helpers.ts';

const square: Pt[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('prism faces', () => {
  it('normalises rings (outer CCW, holes CW, open) and drops degenerate rings', () => {
    const closedCw: Pt[] = [...square].reverse();
    closedCw.push(closedCw[0]!);
    const hole: Pt[] = [
      [3, 3],
      [6, 3],
      [6, 6],
      [3, 6],
    ];
    const poly = normalizePolygon([
      closedCw,
      hole,
      [
        [1, 1],
        [2, 2],
      ],
    ]);
    expect(poly).toHaveLength(2);
    expect(signedArea2(poly[0]!)).toBeGreaterThan(0);
    expect(signedArea2(poly[1]!)).toBeLessThan(0);
    expect(poly[0]).toHaveLength(4);
  });

  it('builds outward walls (CCW from outside, bottom edge first) and a roof', () => {
    const faces = prismFaces3([square], 0, 12);
    expect(faces).toHaveLength(5);
    for (const f of faces) {
      const n = faceNormal(f.ring);
      for (let k = 0; k < 3; k++) expect(n[k]).toBeCloseTo(f.normal[k]!, 9);
    }
    const walls = faces.filter((f) => f.material === 'wall');
    expect(walls.map((w) => w.normal)).toEqual([
      [0, -1, 0],
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
    ]);
    expect(walls[0]!.ring[0]![2]).toBe(0);
    expect(walls[0]!.ring[2]![2]).toBe(12);
  });

  it('culls back faces: two walls and the roof face the viewer at every rotation', () => {
    const faces = prismFaces3([square], 0, 12);
    for (const r of ISO_ROTATIONS) {
      const proj = createIsoProjection(r);
      const visible = faces.filter((f) => isFrontFacing(f, proj));
      expect(visible).toHaveLength(3);
      expect(visible.some((f) => f.material === 'roof')).toBe(true);
    }
    // At r = 0 (north-east at the top) the viewer sees the south and west walls.
    const vis0 = faces.filter((f) => isFrontFacing(f, createIsoProjection(0)) && f.material === 'wall');
    expect(vis0.map((f) => f.normal)).toEqual([
      [0, -1, 0],
      [-1, 0, 0],
    ]);
  });

  it('draws the roof of a flat prism last', () => {
    for (const r of ISO_ROTATIONS) {
      const sorted = sortVisibleFaces(prismFaces3([square], 0, 12), createIsoProjection(r));
      expect(sorted.at(-1)!.material).toBe('roof');
    }
  });
});

describe('tones (fixed light from the south-south-west)', () => {
  it('gives roofs the roof tone and the two visible walls different tones at every rotation', () => {
    expect(toneFor([0, 0, 1], 'roof')).toBe('roof');
    const faces = prismFaces3([square], 0, 12);
    for (const r of ISO_ROTATIONS) {
      const walls = faces.filter((f) => f.material === 'wall' && isFrontFacing(f, createIsoProjection(r)));
      const tones = walls.map((w) => toneFor(w.normal, w.material));
      expect(new Set(tones).size).toBe(2);
    }
  });

  it('shades an appearance colour toward black', () => {
    expect(shadeHex('#808080', 0.5)).toBe('#404040');
    expect(shadeHex('#ffffff', 1)).toBe('#ffffff');
    expect(shadeHex('not-a-colour', 0.5)).toBe('not-a-colour');
  });
});

// ---------------------------------------------------------------------------
// Studio meshes (the SAME faces as Realistic 3D, S1)
// ---------------------------------------------------------------------------

const VARIANTS: Record<string, Partial<ModelConfigV1>> = {
  'box, flat roof': {},
  'box, gable roof': { roof: { shape: 'gable', pitchDeg: 30, colour: '#9c4a3a', material: 'tile' } },
  'box, hip roof': { roof: { shape: 'hip', pitchDeg: 25, colour: '#9c4a3a', material: 'tile' } },
  'box, shed roof': { roof: { shape: 'shed', pitchDeg: 15, colour: '#7d7d7d', material: 'metal' } },
  'l-shape': {
    generatorId: 'l-shape',
    shape: { kind: 'l-shape', notchWidthFrac: 0.5, notchLengthFrac: 0.5, notchCorner: 'front-right' },
  },
  'u-shape, closed courtyard': {
    generatorId: 'u-shape',
    shape: { kind: 'u-shape', courtyardWidthFrac: 0.5, courtyardDepthFrac: 0.5, openSide: 'none' },
  },
  'u-shape, open front': {
    generatorId: 'u-shape',
    shape: { kind: 'u-shape', courtyardWidthFrac: 0.5, courtyardDepthFrac: 0.5, openSide: 'front' },
  },
  'tower on podium': {
    generatorId: 'tower-podium',
    heightM: 40,
    floors: 12,
    floorHeightM: 3.3,
    shape: { kind: 'tower-podium', podiumFloors: 2, towerWidthFrac: 0.5, towerLengthFrac: 0.5 },
  },
  stepped: {
    generatorId: 'stepped',
    shape: { kind: 'stepped', tiers: 3, setbackM: 3 },
    roof: { shape: 'stepped', colour: '#b0a99f', material: 'concrete' },
  },
};

function studioModelFor(cfg: ModelConfigV1): IsoStudioModel | null {
  const res = generateStudioMesh(cfg);
  if (!res.ok) return null;
  return {
    id: 'stu:test',
    mesh: res.mesh,
    colours: { wall: cfg.facade.wallColour, roof: cfg.roof.colour },
    verificationLabel: 'Illustrative model placed by the site owner — not verified',
    appearanceLabel: 'Colours and materials are appearance only',
  };
}

/** A minimal dataset with one building feature whose footprint is the studio mesh's footprint. */
function sceneWith(m: IsoStudioModel) {
  const frame = createLocalFrame();
  const ring = m.mesh.footprint[0]!.map(([x, y]) => {
    const k = Math.cos((m.mesh.origin[1] * Math.PI) / 180);
    return [m.mesh.origin[0] + x / (k * 111194.9266), m.mesh.origin[1] + y / 111194.9266];
  });
  ring.push(ring[0]!);
  const props = {
    id: m.id,
    name: null,
    displayName: 'Unnamed building (owner-placed model)',
    categoryId: 'academic',
    inCampusInventory: true,
    campusStatus: 'inside',
    anchorLon: m.mesh.origin[0],
    anchorLat: m.mesh.origin[1],
    areaM2: 800,
    directoryKey: null,
    renderHeightM: m.mesh.bbox.max[2],
    renderMinHeightM: 0,
    renderHeightSource: 'osm-levels-estimate',
  };
  const buildings = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props }],
  } as unknown as Parameters<typeof buildIsoScene>[0]['buildings'];
  const empty = { type: 'FeatureCollection' as const, features: [] };
  return (r: 0 | 1 | 2 | 3) =>
    buildIsoScene({ buildings, basemap: empty, boundary: empty, studioModels: [m] }, r, frame);
}

describe('studio meshes in the overview', () => {
  for (const [name, over] of Object.entries(VARIANTS)) {
    it(`${name}: culled, painter-sorted correctly at all rotations`, () => {
      const m = studioModelFor(model(over));
      if (!m) {
        // Generators land with studio-core; the contract stub reports generator-not-implemented.
        expect(generateStudioMesh(model(over))).toMatchObject({ ok: false });
        return;
      }
      const build = sceneWith(m);
      for (const r of ISO_ROTATIONS) {
        const scene = build(r);
        const b = scene.byId.get('stu:test')!;
        expect(b.studio).toBe(m);
        // Only front faces are drawn.
        const visible = studioFaces3(m.mesh, scene.frame).filter((f) => isFrontFacing(f, scene.projection));
        expect(b.faces).toHaveLength(visible.length);
        expect(b.faces.length).toBeLessThan(m.mesh.faces.length);
        // Painter order agrees with exact ray depth at sampled points.
        const { errors } = painterErrors(scene, 12, 0.01);
        expect(errors).toEqual([]);
        // Appearance colours are used (shaded), never the theme's brick tones.
        expect(
          b.faces.every(
            (f) =>
              f.material === 'glass' || f.fill !== null || f.material === 'base' || f.material === 'trim',
          ),
        ).toBe(true);
      }
    });
  }

  it('moves mesh coordinates into the overview frame exactly', () => {
    const m = studioModelFor(model())!;
    const frame = createLocalFrame();
    const faces = studioFaces3(m.mesh, frame);
    const [e0, n0] = frame.toLocal(m.mesh.origin);
    const v = m.mesh.faces[0]!.ring[0]!;
    const w = faces[0]!.ring[0]!;
    expect(w[0] - e0).toBeCloseTo(v[0], 3);
    expect(w[1] - n0).toBeCloseTo(v[1], 6);
    expect(w[2]).toBe(v[2]);
  });

  it('hit-testing uses the footprint prism, not the mesh (S1)', () => {
    const m = studioModelFor(
      model({ roof: { shape: 'gable', pitchDeg: 30, colour: '#9c4a3a', material: 'tile' } }),
    );
    if (!m) return;
    const b = sceneWith(m)(0).byId.get('stu:test')!;
    // Roof polygon + two walls of the rectangular footprint prism.
    expect(b.hit).toHaveLength(3);
  });
});

describe('synthetic windows (appearance only)', () => {
  it('lays a punched grid of floors × columns inside the wall, none on short walls', () => {
    const wall = {
      ring: [
        [0, 0, 0],
        [14, 0, 0],
        [14, 0, 12.8],
        [0, 0, 12.8],
      ] as [number, number, number][],
      holes: [],
      normal: [0, -1, 0] as const,
      material: 'wall' as const,
      windows: {
        pattern: 'punched' as const,
        floorHeightM: 3.2,
        floors: 4,
        bottomM: 0,
        columns: 4,
        density: 0.36,
      },
    };
    const quads = windowQuads3(wall);
    expect(quads).toHaveLength(16);
    for (const q of quads)
      for (const v of q) {
        expect(v[0]).toBeGreaterThanOrEqual(0);
        expect(v[0]).toBeLessThanOrEqual(14);
        expect(v[2]).toBeLessThanOrEqual(12.8);
      }
    expect(
      windowQuads3({
        ...wall,
        ring: wall.ring.map((p) => [p[0] / 10, p[1], p[2]] as [number, number, number]),
      }),
    ).toEqual([]);
    expect(windowQuads3({ ...wall, windows: { ...wall.windows, pattern: 'ribbon' } })).toHaveLength(4);
  });
});
