/**
 * The ONE transform of the illustrated overview (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md
 * §3.1, owner gate 2). Pure maths, no DOM.
 *
 *   screen = translate + scale × source            (CSS px of the stage)
 *   source = normalized × [sourceWidth, sourceHeight]
 *
 * The renderer applies this transform ONCE, as the CSS transform of a single
 * layer that holds both the artwork image(s) and the hotspot outlines (drawn
 * in source pixels). There is no second transform and no per-layer offset, so
 * an outline can never drift from the pixels it was traced on. The scale is
 * uniform (one number): the artwork is never stretched.
 *
 * devicePixelRatio: the browser rasterises the layer at the device scale; the
 * translation is snapped to whole device pixels (snapToDevicePixels) so the
 * image stays crisp. The snap moves image and outlines together.
 */

export interface ArtSize {
  width: number;
  height: number;
}

/** Stage size in CSS px. */
export type ArtViewportSize = ArtSize;

/** Source-image size in px (the manifest's coordinateSpace). */
export type ArtSourceSpace = ArtSize;

export interface ArtTransform {
  /** CSS px per source px (uniform). */
  scale: number;
  /** CSS px. */
  tx: number;
  ty: number;
}

/** App chrome over the stage (search bar, panels, sheets), CSS px. Same shape as MapPadding. */
export interface ArtInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ArtPoint {
  x: number;
  y: number;
}

export interface ArtRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScaleLimits {
  min: number;
  max: number;
}

export const NO_INSETS: ArtInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Most magnification: 4 CSS px per source px (pinch-zoom on phones; beyond it only blur). */
export const MAX_SCALE = 4;
/**
 * Opening scale when the whole traced campus does not fit legibly (phones,
 * portrait tablets): pin numbers (about 18 source px tall) are about 9 CSS px
 * and the index text stays readable. The centre of the campus is shown; the
 * user may zoom out further, but it never OPENS shrunk to illegibility.
 */
export const LEGIBLE_SCALE = 0.5;
/**
 * The smallest scale at which the whole traced campus may be shown on opening
 * (pin numbers about 6.5 CSS px, still readable on a desktop screen). Below it
 * the overview opens at LEGIBLE_SCALE instead.
 */
export const OVERVIEW_MIN_SCALE = 0.36;
/** Margin (CSS px) kept around a focused rectangle when framing it. */
export const FRAME_MARGIN = 16;

// ---------------------------------------------------------------------------
// Point mapping (the single transform)
// ---------------------------------------------------------------------------

export function sourceToScreen(t: ArtTransform, x: number, y: number): ArtPoint {
  return { x: t.tx + t.scale * x, y: t.ty + t.scale * y };
}

export function screenToSource(t: ArtTransform, x: number, y: number): ArtPoint {
  return { x: (x - t.tx) / t.scale, y: (y - t.ty) / t.scale };
}

export function normalizedToSource(space: ArtSourceSpace, nx: number, ny: number): ArtPoint {
  return { x: nx * space.width, y: ny * space.height };
}

export function normalizedToScreen(t: ArtTransform, space: ArtSourceSpace, nx: number, ny: number): ArtPoint {
  const p = normalizedToSource(space, nx, ny);
  return sourceToScreen(t, p.x, p.y);
}

export function screenToNormalized(t: ArtTransform, space: ArtSourceSpace, x: number, y: number): ArtPoint {
  const p = screenToSource(t, x, y);
  return { x: p.x / space.width, y: p.y / space.height };
}

/** The CSS `transform` of the shared image + outline layer (transform-origin 0 0). */
export function transformCss(t: ArtTransform): string {
  return `matrix(${t.scale}, 0, 0, ${t.scale}, ${t.tx}, ${t.ty})`;
}

/** Parses `matrix(a, b, c, d, e, f)` (computed style) back into a transform; null when not uniform. */
export function parseTransformCss(css: string): ArtTransform | null {
  const m = /^matrix\(([^)]+)\)$/.exec(css.trim());
  if (!m?.[1]) return null;
  const v = m[1].split(',').map((s) => Number(s.trim()));
  if (v.length !== 6 || v.some((n) => !Number.isFinite(n))) return null;
  const [a, b, c, d, e, f] = v as [number, number, number, number, number, number];
  if (b !== 0 || c !== 0 || Math.abs(a - d) > 1e-9) return null;
  return { scale: a, tx: e, ty: f };
}

/** Rounds the translation to whole device pixels (image and outlines move together). */
export function snapToDevicePixels(t: ArtTransform, dpr: number): ArtTransform {
  const r = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return { scale: t.scale, tx: Math.round(t.tx * r) / r, ty: Math.round(t.ty * r) / r };
}

// ---------------------------------------------------------------------------
// Limits and clamping
// ---------------------------------------------------------------------------

/** The part of the stage not covered by app chrome (never smaller than 1×1). */
export function innerRect(vp: ArtViewportSize, insets: ArtInsets = NO_INSETS): ArtRect {
  const width = Math.max(1, vp.width - insets.left - insets.right);
  const height = Math.max(1, vp.height - insets.top - insets.bottom);
  return { x: insets.left, y: insets.top, width, height };
}

/** Scale at which `rect` (source px) fits inside `box` (CSS px). */
export function fitScale(box: ArtSize, rect: ArtSize): number {
  return Math.min(box.width / rect.width, box.height / rect.height);
}

/**
 * min: the whole artwork fits the uncovered stage (never smaller); max:
 * MAX_SCALE. When the stage is so large that the whole artwork fits above
 * MAX_SCALE, both are that fit scale.
 */
export function scaleLimits(
  vp: ArtViewportSize,
  space: ArtSourceSpace,
  insets: ArtInsets = NO_INSETS,
): ScaleLimits {
  const inner = innerRect(vp, insets);
  const whole = fitScale(inner, space);
  return { min: Math.min(whole, MAX_SCALE), max: Math.max(MAX_SCALE, whole) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Keeps the artwork on screen: the scale stays within limits; along an axis
 * where the scaled artwork is smaller than the uncovered stage it is centred,
 * otherwise it must cover the uncovered stage edge to edge (no empty band can
 * be dragged in).
 */
export function clampTransform(
  t: ArtTransform,
  vp: ArtViewportSize,
  space: ArtSourceSpace,
  insets: ArtInsets = NO_INSETS,
  limits: ScaleLimits = scaleLimits(vp, space, insets),
): ArtTransform {
  const scale = clamp(t.scale, limits.min, limits.max);
  const inner = innerRect(vp, insets);
  const axis = (pos: number, size: number, start: number, length: number) => {
    const scaled = size * scale;
    if (scaled <= length) return start + (length - scaled) / 2;
    return clamp(pos, start + length - scaled, start);
  };
  // Re-anchor the translation on the stage centre when the scale was clamped.
  let { tx, ty } = t;
  if (scale !== t.scale) {
    const cx = inner.x + inner.width / 2;
    const cy = inner.y + inner.height / 2;
    const c = screenToSource(t, cx, cy);
    tx = cx - scale * c.x;
    ty = cy - scale * c.y;
  }
  return {
    scale,
    tx: axis(tx, space.width, inner.x, inner.width),
    ty: axis(ty, space.height, inner.y, inner.height),
  };
}

// ---------------------------------------------------------------------------
// Camera moves
// ---------------------------------------------------------------------------

/** The transform that puts source point (sx, sy) at the centre of the uncovered stage at `scale`. */
export function centreOn(
  vp: ArtViewportSize,
  insets: ArtInsets,
  sx: number,
  sy: number,
  scale: number,
): ArtTransform {
  const inner = innerRect(vp, insets);
  return {
    scale,
    tx: inner.x + inner.width / 2 - scale * sx,
    ty: inner.y + inner.height / 2 - scale * sy,
  };
}

/** Source point at the centre of the uncovered stage. */
export function centreOf(t: ArtTransform, vp: ArtViewportSize, insets: ArtInsets = NO_INSETS): ArtPoint {
  const inner = innerRect(vp, insets);
  return screenToSource(t, inner.x + inner.width / 2, inner.y + inner.height / 2);
}

/** Zooms by `factor` about the screen point (px, py): that point keeps showing the same source pixel. */
export function zoomAbout(
  t: ArtTransform,
  factor: number,
  px: number,
  py: number,
  limits: ScaleLimits,
): ArtTransform {
  const scale = clamp(t.scale * factor, limits.min, limits.max);
  const k = scale / t.scale;
  return { scale, tx: px - (px - t.tx) * k, ty: py - (py - t.ty) * k };
}

export function panBy(t: ArtTransform, dx: number, dy: number): ArtTransform {
  return { scale: t.scale, tx: t.tx + dx, ty: t.ty + dy };
}

/**
 * Drag (one pointer) or pinch (two or more: centroid and mean spread) from
 * `start` to `now`, relative to the transform at gesture start. The source
 * pixel under the start centroid stays under the current centroid.
 */
export function gestureTransform(
  base: ArtTransform,
  start: readonly ArtPoint[],
  now: readonly ArtPoint[],
  limits: ScaleLimits,
): ArtTransform {
  if (start.length === 0 || start.length !== now.length) return base;
  const centroid = (pts: readonly ArtPoint[]) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  });
  const spread = (pts: readonly ArtPoint[], c: ArtPoint) =>
    pts.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0) / pts.length;
  const c0 = centroid(start);
  const c1 = centroid(now);
  let scale = base.scale;
  if (start.length > 1) {
    const s0 = spread(start, c0);
    const s1 = spread(now, c1);
    if (s0 > 1e-6 && s1 > 1e-6) scale = clamp(base.scale * (s1 / s0), limits.min, limits.max);
  }
  const anchor = screenToSource(base, c0.x, c0.y);
  return { scale, tx: c1.x - scale * anchor.x, ty: c1.y - scale * anchor.y };
}

/**
 * After a stage resize: the source point that was at the centre of the old
 * uncovered stage is at the centre of the new one, at the same scale (then
 * clamped). Image and outlines follow because they share the transform.
 */
export function resizeTransform(
  t: ArtTransform,
  oldVp: ArtViewportSize,
  oldInsets: ArtInsets,
  newVp: ArtViewportSize,
  newInsets: ArtInsets,
  space: ArtSourceSpace,
): ArtTransform {
  const c = centreOf(t, oldVp, oldInsets);
  return clampTransform(centreOn(newVp, newInsets, c.x, c.y, t.scale), newVp, space, newInsets);
}

/**
 * The opening view: `focus` (source px; the traced campus area) framed in the
 * uncovered stage when that is at least OVERVIEW_MIN_SCALE (desktops), else
 * the centre of the campus at LEGIBLE_SCALE (phones, portrait tablets) instead
 * of the whole artwork shrunk to illegibility.
 */
export function initialTransform(
  vp: ArtViewportSize,
  space: ArtSourceSpace,
  insets: ArtInsets,
  focus: ArtRect,
): ArtTransform {
  const inner = innerRect(vp, insets);
  const box = {
    width: Math.max(1, inner.width - 2 * FRAME_MARGIN),
    height: Math.max(1, inner.height - 2 * FRAME_MARGIN),
  };
  const limits = scaleLimits(vp, space, insets);
  const fit = fitScale(box, focus);
  const scale = clamp(fit >= OVERVIEW_MIN_SCALE ? fit : LEGIBLE_SCALE, limits.min, limits.max);
  const t = centreOn(vp, insets, focus.x + focus.width / 2, focus.y + focus.height / 2, scale);
  return clampTransform(t, vp, space, insets, limits);
}

/**
 * The transform that frames `rect` (source px) in the uncovered stage: zooms
 * in to at least `minScale` (so a small building is readable) and out only
 * when the rect does not fit at the current scale.
 */
export function frameRect(
  t: ArtTransform,
  vp: ArtViewportSize,
  space: ArtSourceSpace,
  insets: ArtInsets,
  rect: ArtRect,
  minScale = 1,
): ArtTransform {
  const inner = innerRect(vp, insets);
  const box = {
    width: Math.max(1, inner.width - 2 * FRAME_MARGIN),
    height: Math.max(1, inner.height - 2 * FRAME_MARGIN),
  };
  const fit = fitScale(box, { width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
  const scale = Math.min(fit, Math.max(t.scale, minScale));
  return clampTransform(
    centreOn(vp, insets, rect.x + rect.width / 2, rect.y + rect.height / 2, scale),
    vp,
    space,
    insets,
  );
}

/** True when `rect` (source px) lies entirely inside the uncovered stage under `t`. */
export function isRectVisible(
  t: ArtTransform,
  vp: ArtViewportSize,
  insets: ArtInsets,
  rect: ArtRect,
): boolean {
  const inner = innerRect(vp, insets);
  const a = sourceToScreen(t, rect.x, rect.y);
  const b = sourceToScreen(t, rect.x + rect.width, rect.y + rect.height);
  return a.x >= inner.x && a.y >= inner.y && b.x <= inner.x + inner.width && b.y <= inner.y + inner.height;
}

/** The source rectangle visible in the whole stage (for choosing image tiles). */
export function visibleSourceRect(t: ArtTransform, vp: ArtViewportSize, space: ArtSourceSpace): ArtRect {
  const a = screenToSource(t, 0, 0);
  const b = screenToSource(t, vp.width, vp.height);
  const x0 = clamp(Math.min(a.x, b.x), 0, space.width);
  const y0 = clamp(Math.min(a.y, b.y), 0, space.height);
  const x1 = clamp(Math.max(a.x, b.x), 0, space.width);
  const y1 = clamp(Math.max(a.y, b.y), 0, space.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Animation step between two transforms (k in [0, 1]): the scale moves
 * geometrically and the source point at the stage centre moves linearly, so a
 * fly-to neither overshoots nor swings sideways.
 */
export function interpolateTransform(
  a: ArtTransform,
  b: ArtTransform,
  k: number,
  vp: ArtViewportSize,
  insets: ArtInsets = NO_INSETS,
): ArtTransform {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const ca = centreOf(a, vp, insets);
  const cb = centreOf(b, vp, insets);
  const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * k);
  return centreOn(vp, insets, ca.x + (cb.x - ca.x) * k, ca.y + (cb.y - ca.y) * k, scale);
}

export const sameTransform = (a: ArtTransform, b: ArtTransform, eps = 1e-6): boolean =>
  Math.abs(a.scale - b.scale) < eps && Math.abs(a.tx - b.tx) < eps && Math.abs(a.ty - b.ty) < eps;
