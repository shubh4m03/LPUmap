import { describe, expect, it } from 'vitest';
import type { BuildingsFile } from '../../../src/data/schema.ts';
import { hitTest } from '../../../src/isometric/hit-test.ts';
import { layoutLabel } from '../../../src/isometric/labels.ts';
import { createLocalFrame } from '../../../src/isometric/projection.ts';
import { buildIsoScene } from '../../../src/isometric/scene.ts';

const frame = createLocalFrame();
/** A square footprint (metres, local frame) as a building feature. */
function feature(id: string, e0: number, n0: number, size: number, heightM: number) {
  const ring = [
    [e0, n0],
    [e0 + size, n0],
    [e0 + size, n0 + size],
    [e0, n0 + size],
    [e0, n0],
  ].map(([e, n]) => frame.toLngLat(e!, n!));
  const anchor = frame.toLngLat(e0 + size / 2, n0 + size / 2);
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      id,
      name: null,
      displayName: 'Unnamed building · 3 floors',
      inCampusInventory: true,
      anchorLon: anchor[0],
      anchorLat: anchor[1],
      areaM2: size * size,
      directoryKey: null,
      renderHeightM: heightM,
      renderMinHeightM: 0,
      renderHeightSource: 'osm-levels-estimate',
    },
  };
}
const empty = { type: 'FeatureCollection' as const, features: [] };
// Rotation 0 shows north-east at the top: 'back' is north-east of 'front'.
const buildings = {
  type: 'FeatureCollection',
  features: [
    feature('back', 20, 20, 10, 10),
    feature('front', 0, 0, 10, 40),
    feature('east', 20, -5, 10, 10),
  ],
} as unknown as BuildingsFile;
const scene = buildIsoScene({ buildings, basemap: empty, boundary: empty }, 0, frame);
const t = { k: 1, tx: 0, ty: 0 };

const proj = scene.projection;
const at = (e: number, n: number, z: number) => proj.project(e, n, z);

describe('hitTest', () => {
  it('orders back before front', () => {
    const ids = scene.buildings.map((b) => b.id);
    expect(ids.indexOf('back')).toBeLessThan(ids.indexOf('front'));
  });

  it('hits the roof of a building', () => {
    const [x, y] = at(25, 0, 10);
    expect(hitTest(scene, t, [], x, y)).toEqual({ kind: 'building', id: 'east' });
  });

  it('a tall building in front wins where it covers the one behind (reverse draw order)', () => {
    // The back building's roof centre lies behind the 40 m tower on screen.
    const [x, y] = at(25, 25, 10);
    const hit = hitTest(scene, t, [], x, y);
    expect(hit).toEqual({ kind: 'building', id: 'front' });
  });

  it('hits a visible wall, not only the roof', () => {
    // South wall of 'front', half-way up.
    const [x, y] = at(5, 0, 20);
    expect(hitTest(scene, t, [], x, y)).toEqual({ kind: 'building', id: 'front' });
  });

  it('inverts empty space exactly onto the ground', () => {
    const [x, y] = at(-50, 80, 0);
    const hit = hitTest(scene, t, [], x, y);
    expect(hit.kind).toBe('ground');
    if (hit.kind !== 'ground') return;
    const [e, n] = frame.toLocal(hit.lngLat);
    expect(e).toBeCloseTo(-50, 6);
    expect(n).toBeCloseTo(80, 6);
  });

  it('tests markers first, with their enlarged hit box; endpoint labels are not selectable', () => {
    const [x, y] = at(-50, 80, 0);
    const marker = layoutLabel(
      { id: 'back', kind: 'key', text: 'C4-07', x: x + 5, y, diamond: true, area: 1 },
      (s) => s.length * 7,
    );
    expect(hitTest(scene, t, [marker], x, y)).toEqual({ kind: 'marker', id: 'back' });
    const endpoint = { ...marker, id: 'endpoint:start' };
    expect(hitTest(scene, t, [endpoint], x, y).kind).toBe('ground');
  });
});
