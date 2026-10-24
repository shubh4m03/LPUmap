import { describe, expect, it } from 'vitest';
import { fallbackPrismMesh, generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import type { StudioFace, StudioMesh, Vec3 } from '../../../src/building-studio/mesh/types.ts';
import { faceNormal } from '../../../src/building-studio/mesh/types.ts';
import {
  ATTRIBUTES,
  buildMeshBuffers,
  hexToRgb,
  meshContentKey,
  PATTERN_IDS,
  slotColours,
  STRIDE_FLOATS,
} from '../../../src/building-studio/render/maplibre/buffers.ts';
import { FOOTPRINT, model } from '../building-studio/fixtures.ts';

const APPEARANCE = { wall: '#e8dcc8', roof: '#b0a99f' };

function meshOf(over: Parameters<typeof model>[0] = {}): StudioMesh {
  const r = generateStudioMesh(model(over));
  if (!r.ok) throw new Error(r.message);
  return r.mesh;
}

const vertexAt = (v: Float32Array, i: number, attr: keyof typeof ATTRIBUTES): number[] => {
  const a = ATTRIBUTES[attr];
  return Array.from(v.subarray(i * STRIDE_FLOATS + a.offset, i * STRIDE_FLOATS + a.offset + a.size));
};

describe('buildMeshBuffers', () => {
  it('lays out one vertex per face vertex and indexes inside the buffer', () => {
    const mesh = meshOf();
    const b = buildMeshBuffers(mesh, APPEARANCE);
    const ringVerts = mesh.faces.reduce(
      (s, f) => s + f.ring.length + (f.holes ?? []).reduce((h, r) => h + r.length, 0),
      0,
    );
    expect(b.vertexCount).toBe(ringVerts);
    expect(b.vertices.length).toBe(ringVerts * STRIDE_FLOATS);
    expect(b.indices).toBeInstanceOf(Uint16Array);
    expect(b.triangleCount * 3).toBe(b.indices.length);
    expect(Math.max(...b.indices)).toBeLessThan(b.vertexCount);
  });

  it('keeps the contract winding: every triangle is counter-clockwise seen from outside', () => {
    for (const roof of [
      { shape: 'flat' as const, colour: '#b0a99f', material: 'concrete' as const },
      { shape: 'gable' as const, pitchDeg: 30, colour: '#b0a99f', material: 'tile' as const },
      { shape: 'hip' as const, pitchDeg: 25, colour: '#b0a99f', material: 'tile' as const },
    ]) {
      const b = buildMeshBuffers(meshOf({ roof, detailLevel: 'facade' }), APPEARANCE);
      for (let t = 0; t < b.indices.length; t += 3) {
        const [a, c, d] = [b.indices[t]!, b.indices[t + 1]!, b.indices[t + 2]!].map((i) =>
          vertexAt(b.vertices, i, 'position'),
        );
        const n = vertexAt(b.vertices, b.indices[t]!, 'normal');
        const u = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
        const w = [d![0]! - a![0]!, d![1]! - a![1]!, d![2]! - a![2]!];
        const cross = [
          u[1]! * w[2]! - u[2]! * w[1]!,
          u[2]! * w[0]! - u[0]! * w[2]!,
          u[0]! * w[1]! - u[1]! * w[0]!,
        ];
        expect(cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]!).toBeGreaterThan(0);
      }
    }
  });

  it('colours each face by its material slot (appearance only)', () => {
    const mesh = meshOf();
    const b = buildMeshBuffers(mesh, APPEARANCE);
    const colours = slotColours(APPEARANCE);
    let v = 0;
    for (const f of mesh.faces) {
      expect(vertexAt(b.vertices, v, 'colour').map((x) => +x.toFixed(4))).toEqual(
        colours[f.material].map((x) => +Math.fround(x).toFixed(4)),
      );
      v += f.ring.length + (f.holes ?? []).reduce((s, h) => s + h.length, 0);
    }
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('not a colour')).toEqual([0.5, 0.5, 0.5]);
  });

  it('gives wall faces with windows their grid in wall metres; other faces none', () => {
    const mesh = meshOf({ rotationDeg: 0, detailLevel: 'facade' });
    const b = buildMeshBuffers(mesh, APPEARANCE);
    let v = 0;
    let walls = 0;
    for (const f of mesh.faces) {
      const pattern = vertexAt(b.vertices, v, 'pattern');
      if (f.windows) {
        walls += 1;
        const len = Math.hypot(f.ring[1]![0] - f.ring[0]![0], f.ring[1]![1] - f.ring[0]![1]);
        expect(pattern).toEqual([PATTERN_IDS[f.windows.pattern], f.windows.floors]);
        const grid = vertexAt(b.vertices, v, 'grid');
        expect(grid[0]).toBeCloseTo(f.windows.floorHeightM, 5);
        expect(grid[2]).toBeCloseTo(len / f.windows.columns, 4);
        expect(grid[3]).toBeCloseTo(f.windows.density, 5);
        // ring[0] is u = 0 at the bottom; ring[1] is u = edge length.
        expect(vertexAt(b.vertices, v, 'uv')[0]).toBeCloseTo(0, 5);
        expect(vertexAt(b.vertices, v + 1, 'uv')[0]).toBeCloseTo(len, 3);
        expect(vertexAt(b.vertices, v, 'uv')[1]).toBeCloseTo(0, 5);
      } else expect(pattern).toEqual([0, 0]);
      v += f.ring.length + (f.holes ?? []).reduce((s, h) => s + h.length, 0);
    }
    expect(walls).toBeGreaterThan(0);
  });

  it('draws no windows for massing detail or the fallback prism', () => {
    for (const mesh of [
      meshOf({ detailLevel: 'massing' }),
      fallbackPrismMesh({ footprint: FOOTPRINT, model: model() }),
    ]) {
      const b = buildMeshBuffers(mesh, APPEARANCE);
      for (let i = 0; i < b.vertexCount; i++) expect(vertexAt(b.vertices, i, 'pattern')[0]).toBe(0);
    }
  });

  it('switches to 32-bit indices above 65,535 vertices', () => {
    const ring = (i: number): Vec3[] => [
      [i, 0, 0],
      [i + 1, 0, 0],
      [i + 1, 0, 1],
      [i, 0, 1],
    ];
    const faces: StudioFace[] = [];
    for (let i = 0; i < 16400; i++) {
      const r = ring(i);
      faces.push({ ring: r, normal: faceNormal(r), material: 'wall' });
    }
    const b = buildMeshBuffers({ faces }, APPEARANCE);
    expect(b.vertexCount).toBe(65600);
    expect(b.indices).toBeInstanceOf(Uint32Array);
    expect(Math.max(...b.indices)).toBe(65599);
  });
});

describe('meshContentKey', () => {
  it('ignores the origin, so the same model placed twice shares one GPU buffer', () => {
    const a = meshOf({ anchor: [75.7032, 31.2533] });
    const b = meshOf({ anchor: [75.7051, 31.2549] });
    expect(a.origin).not.toEqual(b.origin);
    expect(meshContentKey(a, APPEARANCE)).toBe(meshContentKey(b, APPEARANCE));
  });

  it('changes with geometry, rotation and appearance', () => {
    const base = meshContentKey(meshOf(), APPEARANCE);
    expect(meshContentKey(meshOf({ heightM: 16 }), APPEARANCE)).not.toBe(base);
    expect(meshContentKey(meshOf({ rotationDeg: 45 }), APPEARANCE)).not.toBe(base);
    expect(meshContentKey(meshOf(), { ...APPEARANCE, wall: '#ffffff' })).not.toBe(base);
    expect(meshContentKey(meshOf(), APPEARANCE)).toBe(base);
  });
});
