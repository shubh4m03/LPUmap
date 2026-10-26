/**
 * Hotspot geometry and hit-testing of the illustrated overview, in SOURCE
 * IMAGE PIXELS of the master (the manifest's coordinateSpace). Pure.
 *
 * Hotspots are stored normalized (x / width, y / height); they are converted
 * to source pixels once here, and a screen point is mapped into source pixels
 * with the same transform the renderer applies to the image (viewport.ts
 * screenToSource). Nothing is computed in screen space, so hit-testing cannot
 * disagree with what is drawn.
 */
import type { ManifestHotspot } from './schema.ts';
import type { ArtPoint, ArtRect, ArtSourceSpace } from './viewport.ts';

export interface PreparedHotspot {
  hotspotId: string;
  subjectId: string;
  /** Outline in source px (open ring, as traced). */
  ring: readonly ArtPoint[];
  bbox: ArtRect;
  /** Absolute area in source px². */
  area: number;
  /** Area centroid in source px. */
  centroid: ArtPoint;
  /** labelAnchor of the manifest (interior point), in source px. */
  anchor: ArtPoint;
  /**
   * The printed numbered pin disc of a pin-structure hotspot (centre and radii
   * in source px, as recorded in hotspots.json), else null. The disc is drawn
   * ON TOP of the illustration, so a click on the printed number always means
   * that pin, even where the disc overlaps a neighbouring outline.
   */
  pin?: { x: number; y: number; rx: number; ry: number } | null;
}

/** Shoelace: signed area ×2 (positive = clockwise on screen, y down). */
function signedArea2(ring: readonly ArtPoint[]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** Area centroid of a simple polygon (falls back to the vertex mean for a degenerate ring). */
export function polygonCentroid(ring: readonly ArtPoint[]): ArtPoint {
  const a2 = signedArea2(ring);
  if (Math.abs(a2) < 1e-12) {
    const n = Math.max(1, ring.length);
    return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/** Even-odd ray cast; a point exactly on an edge may fall either way. */
export function pointInRing(ring: readonly ArtPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Shortest distance from (x, y) to the ring's edges, source px. */
export function distanceToRing(ring: readonly ArtPoint[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + k * dx), y - (a.y + k * dy)));
  }
  return best;
}

export function prepareHotspot(h: ManifestHotspot, space: ArtSourceSpace): PreparedHotspot {
  const ring = h.polygon.map(([nx, ny]) => ({ x: nx * space.width, y: ny * space.height }));
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return {
    hotspotId: h.hotspotId,
    subjectId: h.subjectId,
    ring,
    bbox: { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 },
    area: Math.abs(signedArea2(ring)) / 2,
    centroid: polygonCentroid(ring),
    anchor: { x: h.labelAnchor[0] * space.width, y: h.labelAnchor[1] * space.height },
    pin: h.pin
      ? {
          x: h.pin.x * space.width,
          y: h.pin.y * space.height,
          rx: h.pin.rx * space.width,
          ry: h.pin.ry * space.height,
        }
      : null,
  };
}

/** (x, y) inside the pin disc: its normalized ellipse distance (≤ 1), else null. */
function pinDistance(h: PreparedHotspot, x: number, y: number): number | null {
  const p = h.pin;
  if (!p) return null;
  const d = ((x - p.x) / p.rx) ** 2 + ((y - p.y) / p.ry) ** 2;
  return d <= 1 ? d : null;
}

export function prepareHotspots(
  hotspots: readonly ManifestHotspot[],
  space: ArtSourceSpace,
): PreparedHotspot[] {
  return hotspots.map((h) => prepareHotspot(h, space));
}

/** The SVG `points` attribute of a prepared ring (source px, the layer's own units). */
export function svgPoints(ring: readonly ArtPoint[]): string {
  return ring.map((p) => `${round3(p.x)},${round3(p.y)}`).join(' ');
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The hotspot under source point (x, y): first a printed pin disc containing it
 * (the disc is drawn on top, so clicking the number "33" selects pin 33 even
 * where pin 36's outline runs under that disc; discs do not overlap each other
 * today, the nearest centre wins if they ever do); else the smallest-area
 * outline containing it (the rule makes any nesting pick the inner one). When
 * none contains it and `tolerance` > 0 (touch: a fingertip in source px), the
 * outline whose edge is nearest within the tolerance.
 */
export function hitTestHotspots(
  hotspots: readonly PreparedHotspot[],
  x: number,
  y: number,
  tolerance = 0,
): PreparedHotspot | null {
  let onPin: PreparedHotspot | null = null;
  let onPinD = Infinity;
  for (const h of hotspots) {
    const d = pinDistance(h, x, y);
    if (d !== null && d < onPinD) {
      onPinD = d;
      onPin = h;
    }
  }
  if (onPin) return onPin;
  let best: PreparedHotspot | null = null;
  for (const h of hotspots) {
    const b = h.bbox;
    if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) continue;
    if (pointInRing(h.ring, x, y) && (best === null || h.area < best.area)) best = h;
  }
  if (best || tolerance <= 0) return best;
  let nearest: PreparedHotspot | null = null;
  let nearestD = tolerance;
  for (const h of hotspots) {
    const b = h.bbox;
    if (x < b.x - tolerance || y < b.y - tolerance) continue;
    if (x > b.x + b.width + tolerance || y > b.y + b.height + tolerance) continue;
    const d = distanceToRing(h.ring, x, y);
    if (d <= nearestD) {
      nearestD = d;
      nearest = h;
    }
  }
  return nearest;
}

/** Union bounding box of prepared hotspots (source px); null for none. */
export function unionBBox(hotspots: readonly PreparedHotspot[]): ArtRect | null {
  if (hotspots.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const h of hotspots) {
    x0 = Math.min(x0, h.bbox.x);
    y0 = Math.min(y0, h.bbox.y);
    x1 = Math.max(x1, h.bbox.x + h.bbox.width);
    y1 = Math.max(y1, h.bbox.y + h.bbox.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
