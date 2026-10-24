/**
 * Slow-frame watchdog for Realistic 3D (D1 §5.2 item 6, S1). While the user
 * moves the camera it records requestAnimationFrame intervals; when at least
 * `windowMs` of interaction has been sampled and the p95 interval is above
 * `p95BudgetMs`, it reports once and starts a fresh window. The host decides
 * how to degrade (drop the studio custom layer to the extrusion fallback,
 * then suggest the overview) and shows a visible notice. The watchdog never
 * switches view modes itself.
 *
 * Idle frames are not sampled: MapLibre only repaints on change, so idle rAF
 * intervals say nothing about rendering cost.
 */

export interface FrameWatchdogOptions {
  /** p95 frame interval above which frames are "slow", ms (design: 50). */
  p95BudgetMs?: number;
  /** Interaction time to sample before judging, ms (design: 2 s). */
  windowMs?: number;
  /** Fewer frames than this in a window is not judged (a stall is not a frame rate). */
  minFrames?: number;
  /** Intervals longer than this are a pause (tab hidden, debugger), not a frame, ms. */
  maxIntervalMs?: number;
  onSlow(report: SlowFrameReport): void;
  now?(): number;
  requestFrame?(cb: (t: number) => void): number;
  cancelFrame?(handle: number): void;
}

export interface SlowFrameReport {
  p95Ms: number;
  frames: number;
  sampledMs: number;
}

export interface FrameWatchdog {
  /** Interaction started (map movestart). */
  start(): void;
  /** Interaction ended (map moveend); keeps the samples for the next interaction. */
  stop(): void;
  dispose(): void;
  /** Samples in the current window (tests, bake-off). */
  readonly samples: readonly number[];
}

export const WATCHDOG_DEFAULTS = { p95BudgetMs: 50, windowMs: 2000, minFrames: 20, maxIntervalMs: 1000 };

/** Nearest-rank percentile of a list (0 for an empty list). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank]!;
}

export function createFrameWatchdog(opts: FrameWatchdogOptions): FrameWatchdog {
  const budget = opts.p95BudgetMs ?? WATCHDOG_DEFAULTS.p95BudgetMs;
  const windowMs = opts.windowMs ?? WATCHDOG_DEFAULTS.windowMs;
  const minFrames = opts.minFrames ?? WATCHDOG_DEFAULTS.minFrames;
  const maxInterval = opts.maxIntervalMs ?? WATCHDOG_DEFAULTS.maxIntervalMs;
  const now = opts.now ?? (() => performance.now());
  const raf = opts.requestFrame ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
  const caf = opts.cancelFrame ?? ((h: number) => cancelAnimationFrame(h));

  let samples: number[] = [];
  let sampled = 0;
  let last: number | null = null;
  let handle: number | null = null;
  let disposed = false;

  const tick = () => {
    handle = null;
    if (disposed) return;
    const t = now();
    if (last !== null) {
      const dt = t - last;
      if (dt > 0 && dt <= maxInterval) {
        samples.push(dt);
        sampled += dt;
      }
    }
    last = t;
    if (sampled >= windowMs) {
      const report = { p95Ms: percentile(samples, 95), frames: samples.length, sampledMs: sampled };
      samples = [];
      sampled = 0;
      if (report.frames >= minFrames && report.p95Ms > budget) opts.onSlow(report);
    }
    handle = raf(tick);
  };

  return {
    start() {
      if (disposed || handle !== null) return;
      last = null;
      handle = raf(tick);
    },
    stop() {
      if (handle !== null) caf(handle);
      handle = null;
      last = null;
    },
    dispose() {
      disposed = true;
      if (handle !== null) caf(handle);
      handle = null;
    },
    get samples() {
      return samples;
    },
  };
}
