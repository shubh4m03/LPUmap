/**
 * Deterministic SVG thumbnails of studio meshes (S14: no binary assets).
 * Pure string output: the same mesh and appearance always give the same SVG.
 *
 * Projection: the isometric overview's parallel 2:1 dimetric projection
 * (docs/ISOMETRIC_AND_3D_DESIGN.md §6.3): view rotation θ = 45° + 90°·r,
 * a = e·cosθ − n·sinθ (screen right), b = e·sinθ + n·cosθ (depth, larger is
 * farther), sx = a, sy = −(b·sinα + z·cosα) with elevation α = 30°, heights
 * 1:1. Faces turned away from the viewer are culled; the rest are painted far
 * to near by their mean depth along the view direction (b·cosα − z·sinα).
 * Shading is Lambert with a light fixed relative to north, quantised to three
 * tones (§6.5).
 *
 * Safety: the SVG contains no user text at all (no names, ids or notes; it is
 * aria-hidden — the UI labels it). The only interpolated strings are colours,
 * which must match COLOUR_RE (anything else falls back to a neutral tone) and
 * are escaped anyway; numbers are formatted with toFixed.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import { starterTemplate, modelFromVariant } from './asset-library.ts';
import { generateStudioMeshDetailed } from './mesh/generate.ts';
import type { MaterialSlot, StudioFace, StudioMesh, Vec3 } from './mesh/types.ts';
import { COLOUR_RE, type ModelConfigV1 } from './schema.ts';

export interface ThumbnailAppearance {
  wallColour: string;
  roofColour: string;
}

export interface ThumbnailOptions {
  /** Output width and height in CSS px (the drawing is fitted with a margin). */
  size?: number;
  /** View rotation step r (θ = 45° + 90°·r). */
  rotation?: 0 | 1 | 2 | 3;
  /** Draw synthetic window cells on visible walls (appearance only). */
  windows?: boolean;
}

const ELEVATION = (APP_CONFIG.isometric.elevationDeg * Math.PI) / 180;
const SIN_A = Math.sin(ELEVATION);
const COS_A = Math.cos(ELEVATION);
/** Fixed light (east, north, up), from the north-west and above, relative to north. */
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.45, 0.55, 0.7];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const TONES = [0.7, 0.85, 1] as const;
const GLASS = '#4f6676';
const NEUTRAL = '#b4aea4';
/** Most window cells drawn in one thumbnail (keeps the SVG small). */
export const MAX_THUMBNAIL_WINDOWS = 600;

const escapeAttr = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const safeColour = (c: string) => (COLOUR_RE.test(c) ? c : NEUTRAL);

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const fmt = (v: number) => {
  const s = v.toFixed(2);
  return s === '-0.00' ? '0.00' : s;
};

function baseColour(material: MaterialSlot, a: ThumbnailAppearance): string {
  switch (material) {
    case 'roof':
      return safeColour(a.roofColour);
    case 'glass':
      return GLASS;
    case 'trim':
      return shade(safeColour(a.wallColour), 0.82);
    case 'base':
      return shade(safeColour(a.wallColour), 0.6);
    case 'wall':
      return safeColour(a.wallColour);
  }
}

interface Projector {
  p(v: Vec3): [number, number];
  depth(v: Vec3): number;
  visible(n: Vec3): boolean;
}

function projector(rotation: number): Projector {
  const t = ((45 + 90 * rotation) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return {
    p: (v) => {
      const a = v[0] * c - v[1] * s;
      const b = v[0] * s + v[1] * c;
      return [a, -(b * SIN_A + v[2] * COS_A)];
    },
    depth: (v) => (v[0] * s + v[1] * c) * COS_A - v[2] * SIN_A,
    // Towards the camera: (0, −cosα, sinα) in (a, b, z).
    visible: (n) => -(n[0] * s + n[1] * c) * COS_A + n[2] * SIN_A > 1e-9,
  };
}

/** Window cells of a wall face as 3D quads (bottom edge ring[0] → ring[1], v up). */
function windowCells(f: StudioFace): Vec3[][] {
  const w = f.windows;
  if (!w || f.ring.length < 4) return [];
  const p0 = f.ring[0]!;
  const p1 = f.ring[1]!;
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (len < 1e-6) return [];
  const ux = (p1[0] - p0[0]) / len;
  const uy = (p1[1] - p0[1]) / len;
  const top = Math.min(f.ring[2]![2], f.ring.at(-1)![2]);
  const at = (t: number, z: number): Vec3 => [p0[0] + ux * t, p0[1] + uy * t, z];
  const quad = (t0: number, t1: number, z0: number, z1: number): Vec3[] => [
    at(t0, z0),
    at(t1, z0),
    at(t1, z1),
    at(t0, z1),
  ];
  const fh = w.floorHeightM;
  const base = p0[2] + w.bottomM;
  const cells: Vec3[][] = [];
  if (w.pattern === 'curtain') {
    const z1 = Math.min(top - 0.1, base + w.floors * fh);
    if (z1 > base + 0.2) cells.push(quad(len * 0.03, len * 0.97, base + 0.1, z1));
    return cells;
  }
  const d = w.density;
  for (let k = 0; k < w.floors; k++) {
    const zf = base + k * fh;
    if (zf + fh * 0.25 > top) break;
    if (w.pattern === 'ribbon') {
      const z0 = zf + (fh * (1 - d)) / 2;
      cells.push(quad(len * 0.06, len * 0.94, z0, Math.min(top - 0.05, z0 + fh * d)));
      continue;
    }
    const cw = len / w.columns;
    const ww = cw * (w.pattern === 'grid' ? 0.85 : Math.sqrt(d));
    const wh = fh * (w.pattern === 'grid' ? d : Math.sqrt(d));
    const z0 = zf + (fh - wh) / 2;
    const z1 = Math.min(top - 0.05, z0 + wh);
    if (z1 <= z0) continue;
    for (let col = 0; col < w.columns; col++) {
      const t0 = col * cw + (cw - ww) / 2;
      cells.push(quad(t0, t0 + ww, z0, z1));
    }
  }
  return cells;
}

/** SVG markup of a mesh (see the module comment). */
export function meshThumbnailSvg(
  mesh: StudioMesh,
  appearance: ThumbnailAppearance,
  opts: ThumbnailOptions = {},
): string {
  const size = opts.size ?? 160;
  const proj = projector(opts.rotation ?? 0);
  const drawWindows = opts.windows ?? true;
  const visible = mesh.faces
    .filter((f) => proj.visible(f.normal))
    .map((f, i) => ({ f, i, depth: f.ring.reduce((s, v) => s + proj.depth(v), 0) / f.ring.length }))
    .sort((x, y) => y.depth - x.depth || x.i - y.i);
  const polys: { pts: [number, number][]; fill: string; holes?: [number, number][][] }[] = [];
  let windowBudget = MAX_THUMBNAIL_WINDOWS;
  for (const { f } of visible) {
    const light = Math.max(0, f.normal[0] * LIGHT[0] + f.normal[1] * LIGHT[1] + f.normal[2] * LIGHT[2]);
    const tone = TONES[light > 0.66 ? 2 : light > 0.33 ? 1 : 0];
    const fill = shade(baseColour(f.material, appearance), tone);
    polys.push({
      pts: f.ring.map(proj.p),
      fill,
      ...(f.holes ? { holes: f.holes.map((h) => h.map(proj.p)) } : {}),
    });
    if (drawWindows && f.material === 'wall' && windowBudget > 0)
      for (const cell of windowCells(f)) {
        if (windowBudget-- <= 0) break;
        polys.push({ pts: cell.map(proj.p), fill: shade(GLASS, tone) });
      }
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of polys)
    for (const [x, y] of poly.pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  if (!Number.isFinite(x0)) {
    x0 = y0 = 0;
    x1 = y1 = 1;
  }
  // Square view box around the drawing with a 6 % margin.
  const side = Math.max(x1 - x0, y1 - y0, 1e-6) * 1.12;
  const vx = (x0 + x1) / 2 - side / 2;
  const vy = (y0 + y1) / 2 - side / 2;
  const edge = shade(safeColour(appearance.wallColour), 0.45);
  const strokeW = side / 400;
  const path = (p: { pts: [number, number][]; holes?: [number, number][][] }) =>
    [p.pts, ...(p.holes ?? [])]
      .map((r) => `M${r.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`)
      .join('');
  const body = polys
    .map((p) => `<path d="${path(p)}" fill="${escapeAttr(p.fill)}"${p.holes ? ' fill-rule="evenodd"' : ''}/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vx)} ${fmt(vy)} ${fmt(side)} ${fmt(side)}" ` +
    `width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<g stroke="${escapeAttr(edge)}" stroke-width="${fmt(strokeW)}" stroke-linejoin="round">${body}</g></svg>`
  );
}

/** Thumbnail of a model config (null when the model cannot be generated). */
export function modelThumbnailSvg(model: ModelConfigV1, opts: ThumbnailOptions = {}): string | null {
  const r = generateStudioMeshDetailed(model);
  if (!r.ok) return null;
  return meshThumbnailSvg(
    r.mesh,
    { wallColour: model.facade.wallColour, roofColour: model.roof.colour },
    opts,
  );
}

const THUMB_ANCHOR: LngLat = [APP_CONFIG.map.center[0], APP_CONFIG.map.center[1]];
const templateThumbs = new Map<string, string | null>();

/**
 * Thumbnail of a starter template variant (default: the first variant), at a
 * fixed placement with rotation 0. Memoised per template version + variant.
 */
export function templateThumbnailSvg(
  templateId: string,
  version?: number,
  variantId?: string,
): string | null {
  const entry = starterTemplate(templateId, version);
  if (!entry) return null;
  const variant = variantId
    ? entry.definition.variants.find((v) => v.id === variantId)
    : entry.definition.variants[0];
  if (!variant) return null;
  const key = `${entry.definition.id}@${entry.definition.version}/${variant.id}`;
  if (!templateThumbs.has(key))
    templateThumbs.set(
      key,
      modelThumbnailSvg(modelFromVariant(variant, { anchor: THUMB_ANCHOR, rotationDeg: 0 })),
    );
  return templateThumbs.get(key) ?? null;
}
