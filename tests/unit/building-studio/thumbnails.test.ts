/**
 * Deterministic SVG thumbnails (S14): §6.3 projection, culling, no user
 * text, escaped/validated colours, deterministic output.
 */
import { describe, expect, it } from 'vitest';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import {
  meshThumbnailSvg,
  modelThumbnailSvg,
  templateThumbnailSvg,
} from '../../../src/building-studio/thumbnails.ts';
import { model } from './fixtures.ts';

const boxMesh = () => {
  const r = generateStudioMesh(model({ rotationDeg: 0, detailLevel: 'massing' }));
  if (!r.ok) throw new Error(r.message);
  return r.mesh;
};

describe('thumbnails', () => {
  it('every starter template variant has a deterministic SVG', () => {
    for (const e of starterLibrary())
      for (const v of e.definition.variants) {
        const a = templateThumbnailSvg(e.definition.id, e.definition.version, v.id);
        expect(a, `${e.definition.id}/${v.id}`).toMatch(
          /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="[-\d. ]+"/,
        );
        expect(a).toMatch(/<\/svg>$/);
        expect(templateThumbnailSvg(e.definition.id, e.definition.version, v.id)).toBe(a);
      }
    expect(templateThumbnailSvg('academic-block')).toBe(templateThumbnailSvg('academic-block', 1, 'plain'));
    expect(templateThumbnailSvg('nope')).toBeNull();
    expect(templateThumbnailSvg('academic-block', 1, 'nope')).toBeNull();
  });

  it('variants of a type look different', () => {
    const e = starterLibrary().find((x) => x.definition.id === 'hostel-multistorey')!;
    const svgs = e.definition.variants.map((v) => templateThumbnailSvg(e.definition.id, 1, v.id));
    expect(new Set(svgs).size).toBe(svgs.length);
  });

  it('a box at 45°: roof + two walls are visible (back faces culled)', () => {
    const svg = meshThumbnailSvg(
      boxMesh(),
      { wallColour: '#e8dcc8', roofColour: '#b0a99f' },
      { windows: false },
    );
    expect(svg.match(/<path /g)).toHaveLength(3);
    // The four view rotations show different wall pairs → different drawings.
    const rots = ([0, 1, 2, 3] as const).map((r) =>
      meshThumbnailSvg(
        boxMesh(),
        { wallColour: '#e8dcc8', roofColour: '#b0a99f' },
        { rotation: r, windows: false },
      ),
    );
    expect(new Set(rots).size).toBe(4);
  });

  it('contains no user text and never interpolates an unvalidated colour', () => {
    const evil = '"/><script>alert(1)</script><x a="';
    const svg = meshThumbnailSvg(boxMesh(), { wallColour: evil, roofColour: evil });
    expect(svg).not.toMatch(/script|alert|<text|<title|href/i);
    expect(svg).toMatch(/fill="#[0-9a-f]{6}"/);
    // Only path/g/svg elements.
    expect(new Set([...svg.matchAll(/<([a-z]+)/g)].map((m) => m[1]))).toEqual(new Set(['svg', 'g', 'path']));
  });

  it('draws window cells from the facade level and stays compact', () => {
    const plain = modelThumbnailSvg(model({ rotationDeg: 0, detailLevel: 'roof' }))!;
    const windows = modelThumbnailSvg(model({ rotationDeg: 0, detailLevel: 'facade' }))!;
    expect(windows.match(/<path /g)!.length).toBeGreaterThan(plain.match(/<path /g)!.length);
    expect(windows.length).toBeLessThan(60_000);
  });
});
