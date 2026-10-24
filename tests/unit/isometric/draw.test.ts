import { describe, expect, it } from 'vitest';
import {
  cappedDpr,
  drawDynamic,
  drawStatic,
  groundMatrix,
  WINDOW_MIN_PX_PER_M,
  type DrawView,
} from '../../../src/isometric/draw.ts';
import { ISO_THEME_COLORS } from '../../../src/isometric/iso-theme.ts';
import { buildGround, buildIsoScene } from '../../../src/isometric/scene.ts';
import { realData, recordingCtx } from './helpers.ts';

const data = realData();
const ground = buildGround(data);
const scene = buildIsoScene(data, 0, ground.frame, ground.campusPoints);
const c = ISO_THEME_COLORS.light;
const fitView = (k: number, dpr = 1): DrawView => {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2;
  const cy = (scene.bounds.minY + scene.bounds.maxY) / 2;
  return { t: { k, tx: 640 - k * cx, ty: 400 - k * cy }, dpr, width: 1280, height: 800 };
};

describe('drawStatic', () => {
  it('paints ground in true metres through a transform that agrees with the building projection', () => {
    const v = fitView(1.3, 2);
    const [a, b, cc, d, e, f] = groundMatrix(scene, v);
    const p: [number, number] = [123.4, -56.7];
    const [x, y] = scene.projection.project(p[0], p[1], 0);
    expect(a * p[0] + cc * p[1] + e).toBeCloseTo(v.dpr * (v.t.k * x + v.t.tx), 6);
    expect(b * p[0] + d * p[1] + f).toBeCloseTo(v.dpr * (v.t.k * y + v.t.ty), 6);
  });

  it('draws every face of every on-screen building, back to front, with theme tones', () => {
    const ctx = recordingCtx();
    const counts = drawStatic(ctx, ground, scene, fitView(0.6), c, { route: null, showGrid: true });
    expect(counts.buildingsDrawn).toBe(scene.buildings.length);
    expect(counts.facesDrawn).toBe(scene.stats.faces);
    const tones = new Set<unknown>(Object.values(c.building).concat(Object.values(c.placeholder)));
    const faceFills = ctx.calls.filter((k) => k.op === 'fill' && tones.has(k.fillStyle));
    expect(faceFills.length).toBe(scene.stats.faces);
    // The first call clears to the surroundings tone.
    expect(ctx.calls.find((k) => k.op === 'fillRect')!.fillStyle).toBe(c.surroundings);
  });

  it('marks placeholder heights with a dashed roof outline', () => {
    const ctx = recordingCtx();
    drawStatic(ctx, ground, scene, fitView(0.6), c, { route: null, showGrid: false });
    const placeholders = scene.buildings.filter((b) => b.placeholder).length;
    expect(placeholders).toBeGreaterThan(0);
    const dashedEdges = ctx.calls.filter((k) => k.op === 'stroke' && k.strokeStyle === c.placeholder.edge);
    // One face-edge stroke per placeholder face plus one dashed roof outline per placeholder building.
    const placeholderFaces = scene.buildings
      .filter((b) => b.placeholder)
      .reduce((n, b) => n + b.faces.length, 0);
    expect(dashedEdges.length).toBe(placeholderFaces + placeholders);
  });

  it('culls buildings outside the viewport', () => {
    const ctx = recordingCtx();
    const v = fitView(6);
    const counts = drawStatic(ctx, ground, scene, v, c, { route: null, showGrid: false });
    expect(counts.buildingsDrawn).toBeGreaterThan(0);
    expect(counts.buildingsDrawn).toBeLessThan(scene.buildings.length);
  });

  it('draws the route on the ground (cased) when one is planned', () => {
    const ctx = recordingCtx();
    const route = { coordinates: [scene.buildings[0]!.anchorLngLat, scene.buildings[5]!.anchorLngLat] };
    drawStatic(ctx, ground, scene, fitView(1), c, { route, showGrid: false });
    const strokes = ctx.calls.filter((k) => k.op === 'stroke').map((k) => k.strokeStyle);
    expect(strokes).toContain(c.route);
    expect(strokes).toContain(c.routeCasing);
  });

  it('caps the device-pixel ratio at APP_CONFIG.isometric.dprCap', () => {
    expect(cappedDpr(3)).toBe(2);
    expect(cappedDpr(1.5)).toBe(1.5);
    expect(cappedDpr(undefined)).toBe(1);
    expect(WINDOW_MIN_PX_PER_M).toBeGreaterThan(1);
  });
});

describe('drawDynamic', () => {
  it('outlines the selection with a halo and a thick stroke (colour is not the only cue)', () => {
    const ctx = recordingCtx();
    const sel = scene.buildings.find((b) => b.key)!;
    drawDynamic(ctx, scene, fitView(1), c, {
      selectedId: sel.id,
      selectedPoint: null,
      route: null,
      showLabels: true,
    });
    const strokes = ctx.calls.filter((k) => k.op === 'stroke').map((k) => k.strokeStyle);
    expect(strokes).toContain(c.selected);
    expect(strokes).toContain(c.selectedHalo);
    const texts = ctx.calls.filter((k) => k.op === 'fillText').map((k) => k.args[0]);
    expect(texts).toContain(sel.name ?? sel.key);
  });

  it('draws route endpoints and a pin for a selected non-building place', () => {
    const ctx = recordingCtx();
    // Two buildings far apart on screen, so the two endpoint labels cannot collide.
    const byX = [...scene.buildings].sort((p, q) => p.labelAnchor[0] - q.labelAnchor[0]);
    const a = byX[0]!.anchorLngLat;
    const b = byX.at(-1)!.anchorLngLat;
    const placed = drawDynamic(ctx, scene, fitView(0.6), c, {
      selectedId: null,
      selectedPoint: a,
      route: { coordinates: [a, b], alternatives: [[a, b]] },
      showLabels: false,
    });
    expect(placed.map((l) => l.id).sort()).toEqual(['endpoint:end', 'endpoint:start']);
    expect(ctx.calls.filter((k) => k.op === 'arc').length).toBeGreaterThanOrEqual(6);
  });
});
