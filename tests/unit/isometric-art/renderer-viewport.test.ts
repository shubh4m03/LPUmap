// @vitest-environment node
/**
 * The ONE transform of the illustrated overview (owner gate 2): maths of
 * zoom, pan, pinch, resize and devicePixelRatio snapping, and the alignment
 * gate in unit form — at the five gate viewports and after zoom in/out, pan,
 * pinch and resize, the outline centroid of real hotspots lands on the same
 * source pixel of EVERY image file (preview, tiles, full image) the renderer
 * shows, because outlines and images are placed in source px inside one layer
 * with one CSS transform. (tests/e2e/isometric-art.spec.ts checks real pixels.)
 */
import { describe, expect, it } from 'vitest';
import { svgPoints } from '../../../src/isometric-art/hotspot-geometry.ts';
import { artImageSources, planArtImages, type ArtImageLayer } from '../../../src/isometric-art/image-plan.ts';
import {
  centreOf,
  clampTransform,
  frameRect,
  gestureTransform,
  initialTransform,
  interpolateTransform,
  isRectVisible,
  LEGIBLE_SCALE,
  MAX_SCALE,
  NO_INSETS,
  OVERVIEW_MIN_SCALE,
  parseTransformCss,
  resizeTransform,
  scaleLimits,
  screenToSource,
  snapToDevicePixels,
  sourceToScreen,
  transformCss,
  visibleSourceRect,
  zoomAbout,
  type ArtInsets,
  type ArtTransform,
} from '../../../src/isometric-art/viewport.ts';
import { loadManifest, modelOf, VIEWPORTS } from './renderer-fixtures.ts';

const space = { width: 3371, height: 2384 };
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('point mapping', () => {
  it('source → screen → source is the identity, for any uniform transform', () => {
    const t: ArtTransform = { scale: 0.37, tx: -120.5, ty: 33.25 };
    for (const [x, y] of [
      [0, 0],
      [3371, 2384],
      [1234.5, 987.25],
    ] as const) {
      const s = sourceToScreen(t, x, y);
      const back = screenToSource(t, s.x, s.y);
      close(back.x, x);
      close(back.y, y);
    }
  });

  it('writes one uniform CSS matrix and reads it back; a non-uniform matrix is rejected', () => {
    const t: ArtTransform = { scale: 0.5, tx: 10.5, ty: -3 };
    expect(transformCss(t)).toBe('matrix(0.5, 0, 0, 0.5, 10.5, -3)');
    expect(parseTransformCss(transformCss(t))).toEqual(t);
    expect(parseTransformCss('matrix(0.5, 0, 0, 0.6, 0, 0)')).toBeNull();
    expect(parseTransformCss('none')).toBeNull();
  });

  it('snaps the translation to whole device pixels and leaves the scale alone', () => {
    const t = snapToDevicePixels({ scale: 0.7, tx: 10.26, ty: -3.74 }, 2);
    expect(t).toEqual({ scale: 0.7, tx: 10.5, ty: -3.5 });
    expect(snapToDevicePixels({ scale: 1, tx: 1.4, ty: 1.6 }, 1)).toEqual({ scale: 1, tx: 1, ty: 2 });
    expect(snapToDevicePixels({ scale: 1, tx: 1.4, ty: 1.6 }, Number.NaN)).toEqual({
      scale: 1,
      tx: 1,
      ty: 2,
    });
  });
});

describe('camera moves', () => {
  const vp = { width: 1000, height: 700 };
  const limits = scaleLimits(vp, space);

  it('zooms about a screen point: the source pixel under it stays under it', () => {
    const t: ArtTransform = { scale: 0.4, tx: -50, ty: 20 };
    const p = { x: 321, y: 456 };
    const before = screenToSource(t, p.x, p.y);
    const z = zoomAbout(t, 2.5, p.x, p.y, limits);
    expect(z.scale).toBeCloseTo(1, 9);
    const after = screenToSource(z, p.x, p.y);
    close(after.x, before.x);
    close(after.y, before.y);
  });

  it('clamps zoom to [whole artwork fits, MAX_SCALE]', () => {
    const t: ArtTransform = { scale: 0.4, tx: 0, ty: 0 };
    expect(zoomAbout(t, 1000, 0, 0, limits).scale).toBe(MAX_SCALE);
    expect(zoomAbout(t, 0.001, 0, 0, limits).scale).toBeCloseTo(Math.min(1000 / 3371, 700 / 2384), 12);
  });

  it('drag pans; a two-finger pinch scales by the spread and keeps the pinched pixel under the fingers', () => {
    const base: ArtTransform = { scale: 0.5, tx: 0, ty: 0 };
    const drag = gestureTransform(base, [{ x: 100, y: 100 }], [{ x: 130, y: 80 }], limits);
    expect(drag).toEqual({ scale: 0.5, tx: 30, ty: -20 });

    const start = [
      { x: 400, y: 300 },
      { x: 500, y: 300 },
    ];
    const now = [
      { x: 380, y: 320 },
      { x: 580, y: 320 },
    ];
    const pinched = gestureTransform(base, start, now, limits);
    expect(pinched.scale).toBeCloseTo(1, 12);
    const anchor = screenToSource(base, 450, 300);
    const under = screenToSource(pinched, 480, 320);
    close(under.x, anchor.x);
    close(under.y, anchor.y);
    expect(gestureTransform(base, start, [{ x: 1, y: 1 }], limits)).toBe(base);
  });

  it('clamping centres an artwork smaller than the stage and never lets an empty band be dragged in', () => {
    const small = clampTransform({ scale: 0.1, tx: 999, ty: -999 }, vp, space);
    // 0.1 is below the whole-artwork fit, so the scale is raised to it and the artwork centred.
    const fit = Math.min(1000 / 3371, 700 / 2384);
    expect(small.scale).toBeCloseTo(fit, 12);
    close(small.tx, (1000 - 3371 * fit) / 2);
    const big = clampTransform({ scale: 1, tx: 500, ty: 500 }, vp, space);
    expect(big).toEqual({ scale: 1, tx: 0, ty: 0 });
    const far = clampTransform({ scale: 1, tx: -99999, ty: -99999 }, vp, space);
    expect(far).toEqual({ scale: 1, tx: 1000 - 3371, ty: 700 - 2384 });
  });

  it('a resize keeps the source point at the centre of the uncovered stage, at the same scale', () => {
    const insets: ArtInsets = { top: 80, right: 60, bottom: 20, left: 0 };
    const t: ArtTransform = { scale: 0.8, tx: -900, ty: -700 };
    const c0 = centreOf(t, vp, insets);
    const vp2 = { width: 700, height: 1000 };
    const r = resizeTransform(t, vp, insets, vp2, NO_INSETS, space);
    expect(r.scale).toBe(0.8);
    const c1 = centreOf(r, vp2, NO_INSETS);
    close(c1.x, c0.x);
    close(c1.y, c0.y);
  });

  it('interpolates geometrically in scale and linearly in centre', () => {
    const a: ArtTransform = { scale: 0.25, tx: 0, ty: 0 };
    const b: ArtTransform = { scale: 1, tx: -500, ty: -300 };
    expect(interpolateTransform(a, b, 0, vp)).toBe(a);
    expect(interpolateTransform(a, b, 1, vp)).toBe(b);
    expect(interpolateTransform(a, b, 0.5, vp).scale).toBeCloseTo(0.5, 12);
  });

  it('frames a rectangle: keeps the scale when it fits, zooms out only when it does not', () => {
    const t: ArtTransform = { scale: 1, tx: 0, ty: 0 };
    const rect = { x: 2000, y: 1500, width: 100, height: 80 };
    const f = frameRect(t, vp, space, NO_INSETS, rect, 1);
    expect(f.scale).toBe(1);
    expect(isRectVisible(f, vp, NO_INSETS, rect)).toBe(true);
    const wide = { x: 100, y: 100, width: 2000, height: 1000 };
    expect(frameRect(t, vp, space, NO_INSETS, wide, 1).scale).toBeLessThan(1);
  });
});

describe('opening view', () => {
  const model = modelOf(loadManifest());
  for (const v of VIEWPORTS) {
    it(`${v.name} ${v.width}×${v.height}: legible, centred on the traced campus`, () => {
      const t = initialTransform(v, space, NO_INSETS, model.focusRect);
      // Never opens shrunk to illegibility.
      expect(t.scale).toBeGreaterThanOrEqual(OVERVIEW_MIN_SCALE);
      if (v.width < 800) expect(t.scale).toBeGreaterThanOrEqual(LEGIBLE_SCALE);
      const c = centreOf(t, v);
      const fx = model.focusRect.x + model.focusRect.width / 2;
      const fy = model.focusRect.y + model.focusRect.height / 2;
      // Centred on the campus unless clamping at the artwork's edge moved it.
      expect(Math.hypot(c.x - fx, c.y - fy)).toBeLessThan(Math.max(v.width, v.height) / t.scale);
    });
  }

  it('desktop shows the whole traced campus', () => {
    const t = initialTransform({ width: 1440, height: 900 }, space, NO_INSETS, model.focusRect);
    expect(isRectVisible(t, { width: 1440, height: 900 }, NO_INSETS, model.focusRect)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Alignment gate (unit form)
// ---------------------------------------------------------------------------

/** What the browser does: layer = parse(transform CSS); an element at (x, y) in the layer → screen. */
function layerToScreen(css: string, x: number, y: number) {
  const m = parseTransformCss(css);
  if (!m) throw new Error(`bad transform ${css}`);
  return { x: m.tx + m.scale * x, y: m.ty + m.scale * y };
}
function screenToLayer(css: string, x: number, y: number) {
  const m = parseTransformCss(css)!;
  return { x: (x - m.tx) / m.scale, y: (y - m.ty) / m.scale };
}
/** File pixel of an <img> placed at (l.x, l.y, l.width, l.height) in the layer, for a layer point. */
function filePixel(l: ArtImageLayer, p: { x: number; y: number }) {
  return {
    x: ((p.x - l.x) * l.pixelWidth) / l.width,
    y: ((p.y - l.y) * l.pixelHeight) / l.height,
  };
}
/** Polygon centroid as the SVG draws it: parse the `points` attribute the renderer writes. */
function drawnCentroid(points: string) {
  const pts = points.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    const f = x0 * y1 - x1 * y0;
    a2 += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

describe('alignment gate: outline centroid ↔ image pixel', () => {
  const manifest = loadManifest();
  const model = modelOf(manifest);
  const sources = artImageSources(model.master, model.space);
  const sample = ['hs-pin-1', 'hs-pin-15', 'hs-pin-25', 'hs-pin-58', 'hs-grp-48-49', 'hs-scene-pavilion'].map(
    (id) => model.byHotspot.get(id)!,
  );

  it('uses real hotspots and real image files', () => {
    expect(sample.every(Boolean)).toBe(true);
    expect(sources.full).not.toBeNull();
  });

  for (const v of VIEWPORTS) {
    it(`${v.name}: after open, zoom in/out, pan, pinch and resize every image file agrees with every outline`, () => {
      const vp = { width: v.width, height: v.height };
      const insets: ArtInsets = { top: 72, right: 0, bottom: 64, left: 0 };
      const limits = scaleLimits(vp, space, insets);
      const states: [string, ArtTransform, { width: number; height: number }][] = [];
      let t = initialTransform(vp, space, insets, model.focusRect);
      states.push(['open', t, vp]);
      t = clampTransform(zoomAbout(t, 3.1, vp.width * 0.3, vp.height * 0.6, limits), vp, space, insets);
      states.push(['zoom in', t, vp]);
      t = clampTransform(zoomAbout(t, 0.45, vp.width * 0.8, vp.height * 0.2, limits), vp, space, insets);
      states.push(['zoom out', t, vp]);
      t = clampTransform({ ...t, tx: t.tx - 137.3, ty: t.ty + 59.9 }, vp, space, insets);
      states.push(['pan', t, vp]);
      t = clampTransform(
        gestureTransform(
          t,
          [
            { x: 100, y: 200 },
            { x: 160, y: 260 },
          ],
          [
            { x: 90, y: 190 },
            { x: 230, y: 330 },
          ],
          limits,
        ),
        vp,
        space,
        insets,
      );
      states.push(['pinch', t, vp]);
      const vp2 = { width: v.height, height: v.width }; // rotate the device / resize the window
      t = resizeTransform(t, vp, insets, vp2, insets, space);
      states.push(['resize', t, vp2]);

      for (const [step, state, size] of states) {
        const css = transformCss(snapToDevicePixels(state, v.dpr));
        const plan = planArtImages(sources, state.scale * v.dpr, visibleSourceRect(state, size, space));
        expect(plan, step).not.toBeNull();
        const layers = [plan!.base, ...plan!.detail, sources.full!];
        for (const h of sample) {
          // The outline as drawn (SVG points in source px inside the layer) → screen.
          const c = drawnCentroid(svgPoints(h.geometry.ring));
          const screen = layerToScreen(css, c.x, c.y);
          // The image pixel under that screen point, in every image file shown.
          const inLayer = screenToLayer(css, screen.x, screen.y);
          for (const l of layers) {
            const fp = filePixel(l, inLayer);
            // Back to source px through the file's own placement: the same source pixel (±0.01 px).
            const sx = l.x + (fp.x * l.width) / l.pixelWidth;
            const sy = l.y + (fp.y * l.height) / l.pixelHeight;
            expect(
              Math.abs(sx - h.geometry.centroid.x),
              `${step} ${h.hotspot.hotspotId} ${l.key}`,
            ).toBeLessThan(0.01);
            expect(
              Math.abs(sy - h.geometry.centroid.y),
              `${step} ${h.hotspot.hotspotId} ${l.key}`,
            ).toBeLessThan(0.01);
          }
          // And the stored normalized centroid is the same point (x/width, y/height).
          expect(Math.abs(c.x - h.geometry.centroid.x)).toBeLessThan(0.01);
        }
      }
    });
  }

  it('every image file covers the whole source space in the same coordinates (uniform scale, no crop)', () => {
    const files = [sources.full!, ...sources.previews];
    for (const f of files) {
      expect([f.x, f.y, f.width, f.height]).toEqual([0, 0, space.width, space.height]);
      // Uniform: the x and y densities differ by less than one file pixel over the whole image.
      expect(Math.abs(f.pixelWidth / f.width - f.pixelHeight / f.height) * space.height).toBeLessThan(1);
    }
    for (const [level, tiles] of sources.tiles) {
      const area = tiles.reduce((s, t) => s + t.width * t.height, 0);
      expect(area / (space.width * space.height), `level ${level}`).toBeCloseTo(1, 6);
    }
  });
});
