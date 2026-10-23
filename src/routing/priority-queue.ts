/**
 * Binary min-heap of search labels stored in growable typed arrays.
 *
 * Ordering is total and deterministic: by f, then g, then node id. Entries
 * are never decreased in place; the search pushes a new label and skips stale
 * ones when popped (lazy deletion).
 */
function labelLess(f1: number, g1: number, n1: number, f2: number, g2: number, n2: number): boolean {
  if (f1 !== f2) return f1 < f2;
  if (g1 !== g2) return g1 < g2;
  return n1 < n2;
}

export class SearchHeap {
  private f: Float64Array;
  private g: Float64Array;
  private node: Int32Array;
  private length = 0;

  constructor(initialCapacity = 64) {
    const cap = Math.max(4, initialCapacity);
    this.f = new Float64Array(cap);
    this.g = new Float64Array(cap);
    this.node = new Int32Array(cap);
  }

  get size(): number {
    return this.length;
  }

  clear(): void {
    this.length = 0;
  }

  push(node: number, f: number, g: number): void {
    if (this.length === this.node.length) this.grow();
    let i = this.length++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!labelLess(f, g, node, this.f[p]!, this.g[p]!, this.node[p]!)) break;
      this.move(p, i);
      i = p;
    }
    this.set(i, f, g, node);
  }

  /** Removes the minimum label and returns its node id, or -1 when empty. */
  pop(): number {
    if (this.length === 0) return -1;
    const top = this.node[0]!;
    const last = --this.length;
    if (last === 0) return top;
    const f = this.f[last]!;
    const g = this.g[last]!;
    const node = this.node[last]!;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= last) break;
      const r = l + 1;
      const c =
        r < last && labelLess(this.f[r]!, this.g[r]!, this.node[r]!, this.f[l]!, this.g[l]!, this.node[l]!)
          ? r
          : l;
      if (!labelLess(this.f[c]!, this.g[c]!, this.node[c]!, f, g, node)) break;
      this.move(c, i);
      i = c;
    }
    this.set(i, f, g, node);
    return top;
  }

  private set(i: number, f: number, g: number, node: number): void {
    this.f[i] = f;
    this.g[i] = g;
    this.node[i] = node;
  }

  private move(from: number, to: number): void {
    this.set(to, this.f[from]!, this.g[from]!, this.node[from]!);
  }

  private grow(): void {
    const cap = this.node.length * 2;
    const f = new Float64Array(cap);
    const g = new Float64Array(cap);
    const node = new Int32Array(cap);
    f.set(this.f);
    g.set(this.g);
    node.set(this.node);
    this.f = f;
    this.g = g;
    this.node = node;
  }
}
