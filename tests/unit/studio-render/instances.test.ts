import { beforeEach, describe, expect, it } from 'vitest';
import { FALLBACK_APPEARANCE } from '../../../src/building-studio/render/maplibre/buffers.ts';
import {
  clearStudioInstanceMemo,
  studioInstanceFor,
  type StudioRenderSource,
} from '../../../src/building-studio/render/maplibre/instances.ts';
import { FOOTPRINT, model } from '../building-studio/fixtures.ts';

const source = (over: Partial<StudioRenderSource> = {}): StudioRenderSource => ({
  publicId: 'stu:abcdefghijklmnopqrstuvwxyz',
  recordId: 'stu:abcdefghijklmnopqrstuvwxyz',
  version: 1,
  footprint: FOOTPRINT,
  model: model(),
  ...over,
});

beforeEach(() => clearStudioInstanceMemo());

describe('studioInstanceFor', () => {
  it('generates the model mesh with the owner appearance under the public id', () => {
    const r = studioInstanceFor(source());
    expect(r.modelAvailable).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.instance.id).toBe('stu:abcdefghijklmnopqrstuvwxyz');
    expect(r.instance.appearance).toEqual({ wall: '#e8dcc8', roof: '#b0a99f' });
    expect(r.instance.mesh.origin).toEqual(model().anchor);
    expect(r.instance.preview).toBeUndefined();
  });

  it('a base-building model is drawn under the base id', () => {
    const r = studioInstanceFor(source({ publicId: 'osm:way/123' }));
    expect(r.instance.id).toBe('osm:way/123');
  });

  it.each([
    ['an unknown model config version', { ...model(), modelConfigVersion: 9 }],
    ['an unknown generator', { ...model(), generatorId: 'dome' }],
    ['an unknown generator version', { ...model(), generatorVersion: 7 }],
  ])('never drops a record with %s: footprint × body height in a neutral colour', (_label, m) => {
    const r = studioInstanceFor(source({ model: m as StudioRenderSource['model'] }));
    expect(r.modelAvailable).toBe(false);
    expect(r.reason).toEqual(expect.any(String));
    expect(r.instance.appearance).toEqual(FALLBACK_APPEARANCE);
    const zs = r.instance.mesh.faces.flatMap((f) => f.ring.map((v) => v[2]));
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBeCloseTo(model().heightM, 9);
    // The fallback footprint is the stored one (4 corners).
    expect(r.instance.mesh.footprint[0]).toHaveLength(4);
  });

  it('memoises published versions and never memoises previews', () => {
    const a = studioInstanceFor(source());
    const b = studioInstanceFor(source());
    expect(b.instance.mesh).toBe(a.instance.mesh);
    const next = studioInstanceFor(source({ version: 2, model: model({ heightM: 20 }) }));
    expect(next.instance.mesh).not.toBe(a.instance.mesh);
    const p1 = studioInstanceFor(source({ recordId: 'preview', version: 0, preview: true }));
    const p2 = studioInstanceFor(
      source({ recordId: 'preview', version: 0, preview: true, model: model({ heightM: 30 }) }),
    );
    expect(p1.instance.preview).toBe(true);
    expect(p2.instance.mesh).not.toBe(p1.instance.mesh);
    expect(p2.instance.mesh.bbox.max[2]).toBeGreaterThanOrEqual(29.99);
  });
});
