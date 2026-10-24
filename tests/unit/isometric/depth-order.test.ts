/**
 * Draw order between prisms (§6.4) on tricky footprints. Rings are given
 * directly in the view frame [a, b] (b larger = farther from the viewer).
 */
import { describe, expect, it } from 'vitest';
import { comparePair, depthOrder, type DepthNode } from '../../../src/isometric/depth-order.ts';

const rect = (a0: number, b0: number, a1: number, b1: number): [number, number][] => [
  [a0, b0],
  [a1, b0],
  [a1, b1],
  [a0, b1],
];
const node = (id: string, ring: [number, number][], heightM = 10, minHeightM = 0): DepthNode => ({
  id,
  rings: [ring],
  heightM,
  minHeightM,
});
const ids = (nodes: DepthNode[], order: number[]) => order.map((i) => nodes[i]!.id);

// An L: a long bar in front (b 0–2) and an arm going back on the left (a 0–2, b 0–10).
const L_FRONT_BAR: [number, number][] = [
  [0, 0],
  [10, 0],
  [10, 2],
  [2, 2],
  [2, 10],
  [0, 10],
];
// The same L mirrored in depth: the bar at the back, the arm coming forward.
const L_BACK_BAR: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 8],
  [10, 8],
  [10, 10],
  [0, 10],
];

describe('depthOrder', () => {
  it('draws the farther of two stacked boxes first', () => {
    const nodes = [node('near', rect(0, 0, 10, 5)), node('far', rect(2, 8, 8, 12))];
    expect(ids(nodes, depthOrder(nodes).order)).toEqual(['far', 'near']);
  });

  it('adds no constraint between boxes that share no column; ties break by farthest b, then id', () => {
    const nodes = [node('b', rect(0, 0, 4, 4)), node('a', rect(10, 0, 14, 4)), node('c', rect(20, 0, 24, 9))];
    const r = depthOrder(nodes);
    expect(r.edges).toBe(0);
    expect(ids(nodes, r.order)).toEqual(['c', 'a', 'b']);
  });

  it('an L whose bounding box contains a box in its notch is not a true overlap (box behind the bar)', () => {
    const nodes = [node('L', L_FRONT_BAR), node('box', rect(4, 4, 6, 6))];
    expect(comparePair(nodes[0]!, nodes[1]!)).toEqual({ kind: 'behind', back: 1 });
    expect(ids(nodes, depthOrder(nodes).order)).toEqual(['box', 'L']);
  });

  it('a box in front of an L whose bar is at the back is drawn after it', () => {
    const nodes = [node('box', rect(4, 3, 6, 5)), node('L', L_BACK_BAR)];
    expect(ids(nodes, depthOrder(nodes).order)).toEqual(['L', 'box']);
  });

  it('neighbours sharing a digitised wall (a few cm of overlap) stay ordered by depth', () => {
    const nodes = [node('front', rect(0, 0, 10, 5.02)), node('back', rect(0, 5, 10, 10))];
    expect(comparePair(nodes[0]!, nodes[1]!).kind).toBe('behind');
    expect(ids(nodes, depthOrder(nodes).order)).toEqual(['back', 'front']);
  });

  it('true overlaps (≥ 1 m²): lower heightM first, then the higher minHeightM', () => {
    const big = node('big', rect(0, 0, 10, 10), 10);
    const tallInner = node('inner', rect(3, 3, 5, 5), 20);
    const r1 = depthOrder([big, tallInner]);
    expect(r1.overlapPairs).toBe(1);
    expect(r1.overlaps).toEqual([[0, 1]]);
    const lowInner = node('inner', rect(3, 3, 5, 5), 5);
    expect(depthOrder([big, lowInner]).overlaps).toEqual([[1, 0]]);
    // Same height: a raised canopy (higher minHeightM) is drawn after the prism it covers.
    const canopy = node('canopy', rect(2, 2, 8, 8), 10, 6);
    expect(depthOrder([canopy, big]).overlaps).toEqual([[1, 0]]);
    // Overlapping prisms share one draw unit (their faces are ordered together).
    expect(depthOrder([big, tallInner]).units).toEqual([[0, 1]]);
  });

  it('a low building in the courtyard of a U is ordered (it never shows above the back arm)', () => {
    const U: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 8],
      [10, 8],
      [10, 10],
      [0, 10],
    ];
    const low = node('low', rect(4, 4, 6, 6), 0.6);
    const nodes = [node('U', U, 30), low];
    const rel = comparePair(nodes[0]!, nodes[1]!);
    expect(rel).toEqual({ kind: 'behind', back: 1 });
    expect(depthOrder(nodes).interleavedPairs).toBe(0);
  });

  it('a tall building in the courtyard of a U is interleaved: both join one unit, counted', () => {
    const U: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 8],
      [10, 8],
      [10, 10],
      [0, 10],
    ];
    const nodes = [node('U', U, 30), node('tower', rect(4, 4, 6, 6), 40), node('far', rect(0, 20, 10, 25))];
    expect(comparePair(nodes[0]!, nodes[1]!).kind).toBe('interleaved');
    const r = depthOrder(nodes);
    expect(r.interleavedPairs).toBe(1);
    expect(r.units).toEqual([[2], [0, 1]]);
    expect(r.cycles).toBe(0);
  });

  it('merges a three-way cycle into one unit instead of breaking it arbitrarily', () => {
    // Three bars around a centre, each partly in front of the next (the classic painter cycle).
    const a = node('a', [
      [0, 0],
      [6, 0],
      [6, 2],
      [0, 2],
    ]);
    const nodes = [
      a,
      node('b', [
        [5, 1],
        [7, 1],
        [7, 9],
        [5, 9],
      ]),
      node('c', [
        [-1, 3],
        [6.5, 3],
        [6.5, 4],
        [-1, 4],
      ]),
    ];
    const r = depthOrder(nodes);
    expect(r.cycles).toBe(0);
    expect(r.order).toHaveLength(3);
    expect(new Set(r.order)).toEqual(new Set([0, 1, 2]));
  });

  it('is deterministic for shuffled input', () => {
    const base = [
      node('a', rect(0, 0, 4, 4)),
      node('b', rect(2, 6, 8, 9)),
      node('c', rect(6, 1, 9, 3)),
      node('d', rect(1, 12, 3, 14)),
    ];
    const ref = ids(base, depthOrder(base).order);
    const shuffled = [base[2]!, base[0]!, base[3]!, base[1]!];
    expect(ids(shuffled, depthOrder(shuffled).order)).toEqual(ref);
  });
});
