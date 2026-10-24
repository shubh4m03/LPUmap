/** Shared helpers for the isometric tests: the real dataset, a recording canvas and a painter checker. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BasemapFile, BoundaryFile, BuildingsFile } from '../../../src/data/schema.ts';
import type { IsoCtx } from '../../../src/isometric/draw.ts';
import { nearnessAt, type IsoFace } from '../../../src/isometric/faces.ts';
import { pointInRings, type Pt } from '../../../src/isometric/geometry.ts';
import type { IsoScene } from '../../../src/isometric/scene.ts';

// Tests run from the repository root (vitest.config.ts).
const DATA = resolve(process.cwd(), 'public/data');
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(DATA, f), 'utf8')) as T;

let cached: { buildings: BuildingsFile; basemap: BasemapFile; boundary: BoundaryFile } | null = null;
/** The committed campus dataset (public/data), read once. */
export function realData() {
  cached ??= {
    buildings: read<BuildingsFile>('buildings.geojson'),
    basemap: read<BasemapFile>('basemap.geojson'),
    boundary: read<BoundaryFile>('boundary.geojson'),
  };
  return cached;
}

export interface Call {
  op: string;
  args: unknown[];
  fillStyle?: unknown;
  strokeStyle?: unknown;
}

/** A canvas context that records calls (fill/stroke/text carry the current style). */
export function recordingCtx(charWidth = 7): IsoCtx & { calls: Call[] } {
  const calls: Call[] = [];
  const ctx = {
    calls,
    fillStyle: '#000000' as IsoCtx['fillStyle'],
    strokeStyle: '#000000' as IsoCtx['strokeStyle'],
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    textAlign: 'start' as CanvasTextAlign,
    lineJoin: 'miter' as CanvasLineJoin,
    lineCap: 'butt' as CanvasLineCap,
    measureText: (t: string) => ({ width: t.length * charWidth }) as TextMetrics,
  } as unknown as IsoCtx & { calls: Call[] };
  for (const op of [
    'save',
    'restore',
    'setTransform',
    'beginPath',
    'moveTo',
    'lineTo',
    'closePath',
    'fill',
    'stroke',
    'fillRect',
    'clearRect',
    'setLineDash',
    'arc',
    'fillText',
    'strokeText',
  ]) {
    (ctx as unknown as Record<string, unknown>)[op] = (...args: unknown[]) => {
      calls.push({ op, args, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle });
    };
  }
  return ctx;
}

const rings = (f: IsoFace): Pt[][] => [f.ring, ...f.holes];

function samplesIn(f: IsoFace, count: number, seed: number): Pt[] {
  const out: Pt[] = [];
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const { minX, minY, maxX, maxY } = f.box;
  for (let tries = 0; tries < count * 20 && out.length < count; tries++) {
    const p: Pt = [minX + rnd() * (maxX - minX), minY + rnd() * (maxY - minY)];
    if (pointInRings(p[0], p[1], rings(f))) out.push(p);
  }
  return out;
}

/**
 * Checks the painter order: at sample points inside drawn faces, the LAST face
 * painted there must be the one nearest to the viewer (exact ray depth).
 * Returns the number of samples checked and the samples where it is not.
 */
export function painterErrors(scene: IsoScene, perFace = 6, toleranceM = 0.05) {
  const drawn: { f: IsoFace; at: number }[] = [];
  let at = 0;
  for (const item of scene.draw) for (const f of item.faces) drawn.push({ f, at: at++ });
  const CELL = 20;
  const grid = new Map<string, { f: IsoFace; at: number }[]>();
  for (const d of drawn) {
    for (let cx = Math.floor(d.f.box.minX / CELL); cx <= Math.floor(d.f.box.maxX / CELL); cx++)
      for (let cy = Math.floor(d.f.box.minY / CELL); cy <= Math.floor(d.f.box.maxY / CELL); cy++) {
        const k = `${cx},${cy}`;
        const list = grid.get(k);
        if (list) list.push(d);
        else grid.set(k, [d]);
      }
  }
  let checked = 0;
  const errors: { p: Pt; top: IsoFace; nearest: IsoFace; gapM: number }[] = [];
  drawn.forEach((d, i) => {
    for (const p of samplesIn(d.f, perFace, i + 1)) {
      const cands = (grid.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? []).filter((c) =>
        pointInRings(p[0], p[1], rings(c.f)),
      );
      if (cands.length < 2) continue;
      checked++;
      const top = cands.reduce((a, b) => (b.at > a.at ? b : a));
      const near = (c: { f: IsoFace }) => nearnessAt(c.f.plane, p, scene.projection);
      const nearest = cands.reduce((a, b) => (near(b) > near(a) ? b : a));
      const gapM = near(nearest) - near(top);
      if (gapM > toleranceM) errors.push({ p, top: top.f, nearest: nearest.f, gapM });
    }
  });
  return { checked, errors };
}
