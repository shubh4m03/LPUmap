/**
 * Robust wall-clock measurement for performance-budget tests. The full suite runs
 * many test files in parallel, so a single timing can include time the CPU spent on
 * other workers (or a GC pause). Repeating each measurement and taking the median
 * keeps the budget about the algorithm, not about scheduler contention; the budget
 * itself is never relaxed.
 */

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank percentile (0 < p ≤ 1). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank]!;
}

/** Times `fn` once, in milliseconds. */
export function timeOnce(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/**
 * Median of `repetitions` timings of `fn`. `setup` runs before each repetition and
 * is not timed (e.g. building a fresh, cold router).
 */
export function medianTime<S>(repetitions: number, setup: () => S, fn: (s: S) => void): number {
  const timings: number[] = [];
  for (let i = 0; i < repetitions; i++) {
    const state = setup();
    timings.push(timeOnce(() => fn(state)));
  }
  return median(timings);
}
