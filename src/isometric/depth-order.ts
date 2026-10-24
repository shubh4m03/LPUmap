/**
 * Draw order between prisms (docs/ISOMETRIC_AND_3D_DESIGN.md §6.4, normative).
 *
 * In this parallel view a vertical prism standing on the ground can only hide
 * prisms whose footprint lies behind it in the same screen column (same view
 * abscissa a), so the order follows ground depth column by column:
 *
 *  - For each pair whose a-intervals overlap, compare the footprints column by
 *    column. Between two consecutive vertex abscissas the crossing edges are
 *    fixed and (for disjoint footprints) cannot cross, so sampling one column
 *    per strip is exact. In a column the nearer of two ground-disjoint
 *    intervals is drawn last wherever the two prisms overlap on screen
 *    (within SLIVER_M, so neighbours sharing a wall stay ordered).
 *  - Footprints that truly overlap (≥ 1 m² shared area) are ordered by height:
 *    lower renderHeightM first, then lower renderMinHeightM (a raised canopy or
 *    building part is drawn after the prism it covers), then id. They share a
 *    draw unit, so this rule cannot conflict with column order elsewhere.
 *  - A pair that must be both in front and behind on screen (a tall building
 *    in the courtyard of a U) has no building-level order: both join one draw
 *    unit whose faces are painter-sorted together (scene.ts). Counted.
 *  - A cycle among units (A behind B behind C behind A) is merged the same way
 *    (strongly connected components), then units are ordered with Kahn's
 *    algorithm. Merges are counted for the debug hook.
 *  - Ties break by farthest b (farther first), then id.
 */
import { crossingsAt, type Pt } from './geometry.ts';

export interface DepthNode {
  id: string;
  /** Footprint rings in the view frame: [a, b] (b larger = farther). Outer ring first. */
  rings: readonly (readonly Pt[])[];
  heightM: number;
  minHeightM: number;
}

export interface DepthOrderResult {
  /** Indices into the input, back to front (`units` flattened). */
  order: number[];
  /**
   * Draw units, back to front: usually one building each. Buildings that are
   * interleaved (each in front of the other somewhere on screen) form one unit
   * whose faces the scene sorts together, so no building-level order is forced.
   */
  units: number[][];
  /** True-overlap pairs as [drawn first, drawn second] by the height rule. */
  overlaps: [back: number, front: number][];
  /**
   * Times Kahn's sort had to break a cycle between units. Always 0, because
   * cycles are merged into units first; kept as a guard (tested on real data).
   */
  cycles: number;
  /** Building-level cycles found and resolved by sorting their faces together. */
  cycleMerges: number;
  /** Ids of the units released to break each cycle (debugging). */
  cycleBreaks: string[][];
  /** Pairs that are in front of each other on screen in different columns (merged into one unit). */
  interleavedPairs: number;
  /** Pairs ordered by the true-overlap rule. */
  overlapPairs: number;
  /** Behind-edges in the graph. */
  edges: number;
}

/** Shared area (m², from strip sampling) at or above which two footprints "truly overlap". */
export const TRUE_OVERLAP_MIN_M2 = 1;
/** Shared length per column (m) treated as digitisation noise between neighbours that share a wall. */
export const SLIVER_M = 0.1;
const EPS = 1e-6;

interface Extent {
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
  abscissas: number[];
}

function extentOf(n: DepthNode): Extent {
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  const abscissas: number[] = [];
  for (const ring of n.rings)
    for (const [a, b] of ring) {
      abscissas.push(a);
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    }
  return { minA, maxA, minB, maxB, abscissas };
}

/** Pairs [start, end] of b-intervals inside the footprint at one column. */
function intervals(c: number, rings: readonly (readonly Pt[])[]): [number, number][] {
  const xs = crossingsAt(c, rings);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

export type PairRelation =
  | { kind: 'none' }
  | { kind: 'behind'; back: 0 | 1 }
  | { kind: 'overlap'; areaM2: number }
  /** Each is in front of the other in different columns; `back` is the majority (by strip width). */
  | { kind: 'interleaved'; back: 0 | 1 };

/** sin/cos of the camera elevation (2:1 dimetric: 30°). */
export interface Elevation {
  sinA: number;
  cosA: number;
}
const ELEVATION_30: Elevation = { sinA: 0.5, cosA: Math.sqrt(3) / 2 };

/**
 * Relation between two footprints. `back` is 0 when the first is behind (drawn
 * first), 1 when the second is.
 *
 * Within a column each footprint may cross in several b-intervals (concave
 * outlines). Every pair of intervals that is disjoint on the ground needs the
 * nearer one drawn last, but only where the two prisms overlap ON SCREEN in
 * that column (screen height u = b·sinα + z·cosα, so heights matter here). A
 * low building in the notch of a tall L or U therefore orders cleanly; only a
 * pair that must be both in front and behind on screen is "interleaved".
 */
export function comparePair(
  p: DepthNode,
  q: DepthNode,
  ep = extentOf(p),
  eq = extentOf(q),
  elev: Elevation = ELEVATION_30,
): PairRelation {
  const lo = Math.max(ep.minA, eq.minA);
  const hi = Math.min(ep.maxA, eq.maxA);
  if (hi - lo <= EPS) return { kind: 'none' };
  if (ep.minB >= eq.maxB - EPS) return { kind: 'behind', back: 0 };
  if (eq.minB >= ep.maxB - EPS) return { kind: 'behind', back: 1 };

  const cuts = [lo, hi];
  for (const a of ep.abscissas) if (a > lo && a < hi) cuts.push(a);
  for (const a of eq.abscissas) if (a > lo && a < hi) cuts.push(a);
  cuts.sort((x, y) => x - y);

  const { sinA, cosA } = elev;
  let pBehind = 0; // width of strips where p must be drawn before q
  let qBehind = 0;
  let overlapArea = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const w = cuts[i + 1]! - cuts[i]!;
    if (w <= EPS) continue;
    const c = (cuts[i]! + cuts[i + 1]!) / 2;
    const ip = intervals(c, p.rings);
    const iq = intervals(c, q.rings);
    if (ip.length === 0 || iq.length === 0) continue;
    let pb = false;
    let qb = false;
    for (const [s0, s1] of ip)
      for (const [t0, t1] of iq) {
        const len = Math.min(s1, t1) - Math.max(s0, t0);
        if (len > EPS) overlapArea += len * w;
        if (len > SLIVER_M) continue; // true overlap in this column: the height rule decides
        // Screen extents of the two prisms in this column.
        const up0 = s0 * sinA + p.minHeightM * cosA;
        const up1 = s1 * sinA + p.heightM * cosA;
        const uq0 = t0 * sinA + q.minHeightM * cosA;
        const uq1 = t1 * sinA + q.heightM * cosA;
        if (Math.min(up1, uq1) - Math.max(up0, uq0) <= EPS) continue; // no overlap on screen
        if (s0 + s1 < t0 + t1)
          qb = true; // p is nearer: q drawn first
        else pb = true;
      }
    if (pb) pBehind += w;
    if (qb) qBehind += w;
  }
  if (overlapArea >= TRUE_OVERLAP_MIN_M2) return { kind: 'overlap', areaM2: overlapArea };
  if (pBehind > 0 && qBehind > 0) return { kind: 'interleaved', back: pBehind >= qBehind ? 0 : 1 };
  if (pBehind > 0) return { kind: 'behind', back: 0 };
  if (qBehind > 0) return { kind: 'behind', back: 1 };
  // Only a sliver overlap (< 1 m²) and no other constraint: order by height like a true overlap.
  if (overlapArea > 0) return { kind: 'overlap', areaM2: overlapArea };
  return { kind: 'none' };
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** True-overlap rule: which of two overlapping prisms is drawn first (0 or 1). */
export function overlapBack(p: DepthNode, q: DepthNode): 0 | 1 {
  if (p.heightM !== q.heightM) return p.heightM < q.heightM ? 0 : 1;
  if (p.minHeightM !== q.minHeightM) return p.minHeightM < q.minHeightM ? 0 : 1;
  return byId(p.id, q.id) <= 0 ? 0 : 1;
}

export function depthOrder(nodes: readonly DepthNode[], elev: Elevation = ELEVATION_30): DepthOrderResult {
  const n = nodes.length;
  const ext = nodes.map(extentOf);
  let interleavedPairs = 0;
  let overlapPairs = 0;

  // 1. Pair relations. Sweep over a-intervals so only pairs that share a column are compared.
  const rels: { from: number; to: number }[] = [];
  const overlaps: [back: number, front: number][] = [];
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const byMinA = nodes.map((_, i) => i).sort((i, j) => ext[i]!.minA - ext[j]!.minA);
  for (let x = 0; x < byMinA.length; x++) {
    const i = byMinA[x]!;
    for (let y = x + 1; y < byMinA.length; y++) {
      const j = byMinA[y]!;
      if (ext[j]!.minA >= ext[i]!.maxA - EPS) break;
      const rel = comparePair(nodes[i]!, nodes[j]!, ext[i], ext[j], elev);
      if (rel.kind === 'none') continue;
      if (rel.kind === 'interleaved') {
        // No building-level order exists: both go into one unit whose faces are sorted together.
        interleavedPairs++;
        parent[find(i)] = find(j);
        continue;
      }
      if (rel.kind === 'overlap') {
        // Truly overlapping prisms: one unit; the height rule orders their faces (scene.ts).
        overlapPairs++;
        overlaps.push(overlapBack(nodes[i]!, nodes[j]!) === 0 ? [i, j] : [j, i]);
        parent[find(i)] = find(j);
        continue;
      }
      rels.push(rel.back === 0 ? { from: i, to: j } : { from: j, to: i });
    }
  }

  // 2. Graph over units (a unit = one building, or a cluster drawn face by face).
  //    A cycle between units has no building-level painter order: its units are
  //    merged (strongly connected components) and the scene sorts their faces
  //    together, so the order between units is always a DAG.
  const unitGraph = () => {
    const g = new Map<number, Set<number>>();
    for (let i = 0; i < n; i++) if (find(i) === i) g.set(i, new Set());
    for (const { from, to } of rels) {
      const a = find(from);
      const b = find(to);
      if (a !== b) g.get(a)!.add(b);
    }
    return g;
  };
  let cycleMerges = 0;
  for (;;) {
    const sccs = stronglyConnected(unitGraph()).filter((c) => c.length > 1);
    if (sccs.length === 0) break;
    for (const c of sccs) {
      cycleMerges++;
      for (const r of c) parent[find(r)] = find(c[0]!);
    }
  }
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = members.get(r);
    if (list) list.push(i);
    else members.set(r, [i]);
  }
  const unitMaxB = new Map<number, number>();
  const unitId = new Map<number, string>();
  for (const [r, list] of members) {
    unitMaxB.set(r, Math.max(...list.map((i) => ext[i]!.maxB)));
    unitId.set(r, list.map((i) => nodes[i]!.id).sort(byId)[0]!);
  }
  const succ = unitGraph();
  const indeg = new Map<number, number>();
  for (const r of members.keys()) indeg.set(r, 0);
  let edges = 0;
  for (const set of succ.values())
    for (const b of set) {
      indeg.set(b, indeg.get(b)! + 1);
      edges++;
    }

  // 3. Kahn; the ready queue is ordered by farthest b (descending), then id.
  const better = (i: number, j: number): boolean => {
    const bi = unitMaxB.get(i)!;
    const bj = unitMaxB.get(j)!;
    if (bi !== bj) return bi > bj;
    return byId(unitId.get(i)!, unitId.get(j)!) < 0;
  };
  const ready: number[] = [];
  const push = (i: number) => {
    ready.push(i);
    // Insertion keeps the best candidate at the end (pop is O(1)); n is small.
    for (let k = ready.length - 1; k > 0 && better(ready[k - 1]!, ready[k]!); k--) {
      [ready[k - 1], ready[k]] = [ready[k]!, ready[k - 1]!];
    }
  };
  const done = new Set<number>();
  for (const r of members.keys()) if (indeg.get(r) === 0) push(r);
  const units: number[][] = [];
  const cycleBreaks: string[][] = [];
  let cycles = 0;
  while (done.size < members.size) {
    let next = ready.pop();
    if (next === undefined) {
      // A cycle: release the remaining unit that is farthest back.
      cycles++;
      let pick = -1;
      for (const r of members.keys()) if (!done.has(r) && (pick < 0 || better(r, pick))) pick = r;
      next = pick;
      cycleBreaks.push(members.get(pick)!.map((i) => nodes[i]!.id));
    }
    if (done.has(next)) continue;
    done.add(next);
    units.push([...members.get(next)!].sort((i, j) => byId(nodes[i]!.id, nodes[j]!.id)));
    for (const to of succ.get(next)!) {
      indeg.set(to, indeg.get(to)! - 1);
      if (indeg.get(to) === 0 && !done.has(to)) push(to);
    }
  }
  return {
    order: units.flat(),
    units,
    overlaps,
    cycles,
    cycleMerges,
    cycleBreaks,
    interleavedPairs,
    overlapPairs,
    edges,
  };
}

/** Tarjan's strongly connected components (n is small; recursion depth ≤ n). */
function stronglyConnected(g: ReadonlyMap<number, ReadonlySet<number>>): number[][] {
  let counter = 0;
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const out: number[][] = [];
  const visit = (v: number) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const v of g.keys()) if (!index.has(v)) visit(v);
  return out;
}
