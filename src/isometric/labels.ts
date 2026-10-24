/**
 * Labels and map-key markers of the overview (docs/ISOMETRIC_AND_3D_DESIGN.md
 * §6.5, Decision D6).
 *
 *  - Named buildings show their name; unnamed buildings show ONLY their map
 *    key, in a diamond glyph (never a circle, never an official block number).
 *    "Unnamed building" is never drawn on the map.
 *  - Priority: selected > named > route endpoints > keyed buildings by
 *    descending footprint area; ties by id.
 *  - Collision: axis-aligned boxes in a uniform screen grid.
 *  - Text ≥ 12 CSS px; every marker's hit target is at least 24 × 24 CSS px
 *    (WCAG 2.2, 2.5.8).
 *
 * Pure: text width comes from a caller-supplied measure function.
 */
import { boxesOverlap, type Box } from './geometry.ts';

export type LabelKind = 'selected' | 'named' | 'endpoint' | 'key';

export interface LabelCandidate {
  /** Building id, or 'endpoint:start' / 'endpoint:end'. */
  id: string;
  kind: LabelKind;
  text: string;
  /** Anchor in CSS px. */
  x: number;
  y: number;
  /** Draw the map-key diamond at the anchor (buildings with a key). */
  diamond: boolean;
  /** Footprint area (m²): orders keyed buildings. */
  area: number;
}

export interface PlacedLabel extends LabelCandidate {
  /** Drawn extent (text + diamond + halo), CSS px. */
  box: Box;
  /** Pointer target, at least MIN_HIT_PX square and containing `box`. */
  hitBox: Box;
  /** Left edge and vertical centre of the text. */
  textX: number;
  textY: number;
}

export const LABEL_FONT_PX = 12;
export const MIN_HIT_PX = 24;
/** Half-diagonal of the diamond glyph, CSS px. */
export const DIAMOND_R = 7;
const HALO = 3;
const GAP = 4;
const CELL = 64;

const KIND_RANK: Readonly<Record<LabelKind, number>> = { selected: 0, named: 1, endpoint: 2, key: 3 };

export function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.kind === 'key' || a.kind === 'selected' || a.kind === 'named' ? b.area - a.area : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Extent of one label laid out at its anchor (diamond centred on the anchor, text to its right). */
export function layoutLabel(c: LabelCandidate, measure: (text: string) => number): PlacedLabel {
  const textW = c.text === '' ? 0 : measure(c.text);
  const h = LABEL_FONT_PX + 2 * HALO;
  const left = c.diamond ? c.x - DIAMOND_R - 1 : c.x - textW / 2 - HALO;
  const textX = c.diamond ? c.x + DIAMOND_R + GAP : c.x - textW / 2;
  const right = textW > 0 ? textX + textW + HALO : c.x + DIAMOND_R + 1;
  const top = Math.min(c.y - h / 2, c.diamond ? c.y - DIAMOND_R - 1 : Infinity);
  const bottom = Math.max(c.y + h / 2, c.diamond ? c.y + DIAMOND_R + 1 : -Infinity);
  const box: Box = { minX: left, minY: top, maxX: right, maxY: bottom };
  const grow = (lo: number, hi: number): [number, number] => {
    const missing = MIN_HIT_PX - (hi - lo);
    return missing > 0 ? [lo - missing / 2, hi + missing / 2] : [lo, hi];
  };
  const [hx0, hx1] = grow(left, right);
  const [hy0, hy1] = grow(top, bottom);
  return { ...c, box, hitBox: { minX: hx0, minY: hy0, maxX: hx1, maxY: hy1 }, textX, textY: c.y };
}

/**
 * Greedy placement in priority order. A label is dropped when its box
 * collides with an already placed one or leaves the viewport. Selected labels
 * are always placed (they may overlap others).
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  measure: (text: string) => number,
  viewport: { width: number; height: number },
): PlacedLabel[] {
  const grid = new Map<number, Box[]>();
  const keyOf = (cx: number, cy: number) => cx * 100003 + cy;
  const cells = (b: Box): number[] => {
    const out: number[] = [];
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
      for (let cy = Math.floor(b.minY / CELL); cy <= Math.floor(b.maxY / CELL); cy++) out.push(keyOf(cx, cy));
    return out;
  };
  const placed: PlacedLabel[] = [];
  for (const c of [...candidates].sort(compareCandidates)) {
    const l = layoutLabel(c, measure);
    const b = l.box;
    if (b.maxX < 0 || b.maxY < 0 || b.minX > viewport.width || b.minY > viewport.height) continue;
    const keys = cells(b);
    if (c.kind !== 'selected') {
      const hit = keys.some((k) => grid.get(k)?.some((o) => boxesOverlap(o, b)));
      if (hit) continue;
      if (b.minX < 0 || b.minY < 0 || b.maxX > viewport.width || b.maxY > viewport.height) continue;
    }
    for (const k of keys) {
      const list = grid.get(k);
      if (list) list.push(b);
      else grid.set(k, [b]);
    }
    placed.push(l);
  }
  return placed;
}

/** How a screen reader should say a map key: 'C4-07' → "Map key C 4, 7". */
export function spokenMapKey(key: string): string {
  const m = /^([A-Z])(\d{1,2})-(\d{2})$/.exec(key);
  if (!m) return `Map key ${key}`;
  return `Map key ${m[1]} ${Number(m[2])}, ${Number(m[3])}`;
}
