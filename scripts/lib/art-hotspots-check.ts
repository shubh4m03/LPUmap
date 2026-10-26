/**
 * Integrity checks for the master-overview hotspots
 * (data/curated/isometric-art/hotspots.json): hit areas traced on the owner-supplied
 * master isometric overview and stored in NORMALIZED source-image coordinates.
 *
 * Pure functions: callers pass the parsed JSON, the parsed inventory and the master
 * image bytes, and get back a list of human-readable problems (empty = OK).
 * Reuses the inventory contract in ./art-inventory-check.ts; no Chromium needed.
 */
import { sha256Hex, type ArtInventory } from './art-inventory-check.ts';

export const ART_HOTSPOTS_PATH = 'data/curated/isometric-art/hotspots.json';

export const HOTSPOT_KINDS = [
  'pin-structure',
  'unassigned-structure',
  'unpinned-structure',
  'scene',
  'printed-text',
] as const;
export type HotspotKind = (typeof HOTSPOT_KINDS)[number];

/** [x, y] with x = pixelX / sourceWidth and y = pixelY / sourceHeight. */
export type NPoint = [number, number];

export interface ArtHotspot {
  hotspotId: string;
  kind: HotspotKind;
  artworkLabel: { text: string; source: 'overview-pin' | 'overview-printed-text'; exact: true } | null;
  pin?: { x: number; y: number; rx: number; ry: number; anchor: string; style: string };
  links: {
    indexRows: { labelId: string; section: string; labelAsPrinted: string; numbersAsPrinted: string }[];
    vignettes: {
      assetId: string;
      number?: string;
      relation: string;
      captionHeadingLabelId?: string | null;
    }[];
  };
  candidatePinNumbers?: string[];
  vignettePinNumbers?: string[];
  legendLabelIds?: string[];
  polygon: NPoint[];
  labelAnchor: NPoint;
  confidence: 'high' | 'medium' | 'low';
  reviewStatus: 'traced' | 'needs-manual-verification';
  notes: string;
}

export interface ArtHotspots {
  schemaVersion: number;
  kind: string;
  source: { assetId: string; path: string; sha256: string; sourceWidth: number; sourceHeight: number };
  hotspots: ArtHotspot[];
  overviewIndexNumbersWithoutOverviewPin: string[];
}

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const REVIEW = new Set(['traced', 'needs-manual-verification']);
const VIGNETTE_RELATIONS = new Set([
  'caption-heading',
  'caption-heading-and-pin',
  'pin-drawn-in-scene',
  'caption-covers-candidate-number',
  'vignette-pin-visual-correspondence',
  'scene-visual-correspondence',
]);
/** Max distance (source px) between a hotspot pin disc (measured by an automated disc scan) and the inventory pin centre (measured by eye, up to ~3.6 px off). */
const PIN_TOLERANCE_PX = 5;

type P = readonly [number, number];

/** Twice the signed area; > 0 = clockwise on screen (y down). */
export function signedArea2(p: readonly P[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i] as P;
    const [x2, y2] = p[(i + 1) % p.length] as P;
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

function orient(a: P, b: P, c: P): number {
  return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
}

/** Proper or touching intersection of two closed segments. */
export function segmentsIntersect(a: P, b: P, c: P, d: P): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  const on = (p: P, q: P, r: P) =>
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1]);
  return (
    (o1 === 0 && on(a, c, b)) ||
    (o2 === 0 && on(a, d, b)) ||
    (o3 === 0 && on(c, a, d)) ||
    (o4 === 0 && on(c, b, d))
  );
}

/** True when no two non-adjacent edges touch and no vertex repeats. */
export function isSimplePolygon(p: readonly P[]): boolean {
  const n = p.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(p[i] as P, p[(i + 1) % n] as P, p[j] as P, p[(j + 1) % n] as P)) return false;
    }
  }
  return true;
}

export function pointInPolygon(pt: P, p: readonly P[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i] as P;
    const [xj, yj] = p[j] as P;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function bbox(p: readonly P[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of p) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** True when the interiors or boundaries of two simple polygons meet. */
export function polygonsOverlap(a: readonly P[], b: readonly P[]): boolean {
  const [ax0, ay0, ax1, ay1] = bbox(a);
  const [bx0, by0, bx1, by1] = bbox(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (segmentsIntersect(a[i] as P, a[(i + 1) % a.length] as P, b[j] as P, b[(j + 1) % b.length] as P))
        return true;
  return pointInPolygon(a[0] as P, b) || pointInPolygon(b[0] as P, a);
}

/**
 * @param master bytes of the original master overview (lpu-isometric-map-design/1-…-3371.jpg).
 */
export function validateArtHotspots(doc: ArtHotspots, inventory: ArtInventory, master: Uint8Array): string[] {
  const problems: string[] = [];
  const masterAsset = inventory.assets.find((a) => a.id === doc.source.assetId);
  if (!masterAsset || masterAsset.role !== 'master-overview') {
    problems.push(`source.assetId ${doc.source.assetId} is not the master overview in the inventory`);
    return problems;
  }
  const W = doc.source.sourceWidth;
  const H = doc.source.sourceHeight;
  if (W !== masterAsset.width || H !== masterAsset.height)
    problems.push(
      `source size ${W}x${H} differs from the inventory ${masterAsset.width}x${masterAsset.height}`,
    );
  if (doc.source.path !== masterAsset.path)
    problems.push(`source.path ${doc.source.path} is not ${masterAsset.path}`);
  if (doc.source.sha256 !== masterAsset.sha256) problems.push('source.sha256 differs from the inventory');
  if (sha256Hex(master) !== doc.source.sha256)
    problems.push('source.sha256 does not match the master image bytes');

  const labelIds = new Set(inventory.assets.flatMap((a) => a.labels.map((l) => l.id)));
  const assetIds = new Set(inventory.assets.map((a) => a.id));
  const ids = new Set<string>();
  const px = (p: NPoint): P => [p[0] * W, p[1] * H];

  for (const h of doc.hotspots) {
    const where = h.hotspotId;
    if (ids.has(h.hotspotId)) problems.push(`${where}: duplicate hotspotId`);
    ids.add(h.hotspotId);
    if (!(HOTSPOT_KINDS as readonly string[]).includes(h.kind))
      problems.push(`${where}: unknown kind ${h.kind}`);
    if (!CONFIDENCE.has(h.confidence)) problems.push(`${where}: bad confidence`);
    if (!REVIEW.has(h.reviewStatus)) problems.push(`${where}: bad reviewStatus`);
    if (!h.notes) problems.push(`${where}: missing notes`);
    const coords = [...h.polygon, h.labelAnchor];
    if (coords.some((c) => c.length !== 2 || c.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) {
      problems.push(`${where}: coordinate outside [0, 1] or not a number`);
      continue;
    }
    const poly = h.polygon.map(px);
    if (poly.length < 3) problems.push(`${where}: fewer than 3 vertices`);
    else if (!isSimplePolygon(poly)) problems.push(`${where}: polygon is not simple`);
    else if (signedArea2(poly) <= 0) problems.push(`${where}: polygon is not clockwise on screen`);
    if (!pointInPolygon(px(h.labelAnchor), poly)) problems.push(`${where}: labelAnchor outside the polygon`);

    for (const r of h.links.indexRows)
      if (!labelIds.has(r.labelId)) problems.push(`${where}: unknown index labelId ${r.labelId}`);
    for (const v of h.links.vignettes) {
      if (!assetIds.has(v.assetId)) problems.push(`${where}: unknown vignette ${v.assetId}`);
      if (!VIGNETTE_RELATIONS.has(v.relation))
        problems.push(`${where}: unknown vignette relation ${v.relation}`);
      if (v.captionHeadingLabelId && !labelIds.has(v.captionHeadingLabelId))
        problems.push(`${where}: unknown caption labelId ${v.captionHeadingLabelId}`);
    }
    for (const l of h.legendLabelIds ?? [])
      if (!labelIds.has(l)) problems.push(`${where}: unknown legend labelId ${l}`);

    if (h.kind === 'pin-structure') {
      const text = h.artworkLabel?.source === 'overview-pin' ? h.artworkLabel.text : null;
      const invPin = masterAsset.pins.find((p) => p.label === text);
      if (!text || !invPin) problems.push(`${where}: artworkLabel is not an overview pin in the inventory`);
      else if (!h.pin) problems.push(`${where}: missing pin disc`);
      else {
        const d = Math.hypot(h.pin.x * W - invPin.x, h.pin.y * H - invPin.y);
        if (d > PIN_TOLERANCE_PX)
          problems.push(`${where}: pin disc ${d.toFixed(1)} px from the inventory pin`);
        if (Math.abs(h.pin.rx * W - h.pin.ry * H) > 0.01)
          problems.push(`${where}: pin radii are not one circle`);
      }
    } else if (h.kind === 'printed-text') {
      if (h.artworkLabel?.source !== 'overview-printed-text')
        problems.push(`${where}: printed-text needs its text`);
    } else {
      if (h.artworkLabel !== null) problems.push(`${where}: ${h.kind} must not carry an artwork label`);
      if (h.reviewStatus !== 'needs-manual-verification')
        problems.push(`${where}: ${h.kind} must be flagged needs-manual-verification`);
    }
  }

  // Every overview pin has exactly one pin-structure hotspot.
  for (const p of masterAsset.pins) {
    const n = doc.hotspots.filter(
      (h) => h.kind === 'pin-structure' && h.artworkLabel?.text === p.label,
    ).length;
    if (n !== 1) problems.push(`overview pin ${p.label}: ${n} pin-structure hotspots (expected 1)`);
  }
  // Every index entry whose number has an overview pin has a hotspot linking that index row.
  const index = (
    masterAsset as unknown as {
      informationIndex?: { sections: { rows: { labelId: string; artworkNumbers: string[] }[] }[] };
    }
  ).informationIndex;
  const pinLabels = new Set(masterAsset.pins.map((p) => p.label));
  for (const row of index?.sections.flatMap((s) => s.rows) ?? []) {
    for (const num of row.artworkNumbers) {
      if (!pinLabels.has(num)) continue;
      const linked = doc.hotspots.some(
        (h) =>
          h.kind === 'pin-structure' &&
          h.artworkLabel?.text === num &&
          h.links.indexRows.some((r) => r.labelId === row.labelId),
      );
      if (!linked) problems.push(`index ${row.labelId} number ${num}: no hotspot links it`);
    }
  }

  // No two hit areas overlap.
  const polys = doc.hotspots.map((h) => ({ id: h.hotspotId, p: h.polygon.map(px) }));
  for (let i = 0; i < polys.length; i++)
    for (let j = i + 1; j < polys.length; j++) {
      const a = polys[i];
      const b = polys[j];
      if (a && b && polygonsOverlap(a.p, b.p)) problems.push(`${a.id} overlaps ${b.id}`);
    }
  return problems;
}
