import { describe, expect, it, vi } from 'vitest';
import { createFrameWatchdog, percentile, WATCHDOG_DEFAULTS } from '../../../src/buildings3d/watchdog.ts';

function harness(opts: { p95BudgetMs?: number; windowMs?: number; minFrames?: number } = {}) {
  let t = 0;
  let pending: ((t: number) => void) | null = null;
  const onSlow = vi.fn();
  const cancel = vi.fn(() => {
    pending = null;
  });
  const w = createFrameWatchdog({
    ...opts,
    onSlow,
    now: () => t,
    requestFrame: (cb) => {
      pending = cb;
      return 7;
    },
    cancelFrame: cancel,
  });
  const frames = (intervals: readonly number[]) => {
    for (const dt of intervals) {
      t += dt;
      const cb = pending;
      pending = null;
      cb?.(t);
    }
  };
  return { w, onSlow, frames, cancel, idle: (ms: number) => (t += ms), hasPending: () => pending !== null };
}

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 50)).toBe(50);
  });
});

describe('frame watchdog', () => {
  it('defaults to the design budget: p95 above 50 ms over 2 s', () => {
    expect(WATCHDOG_DEFAULTS).toMatchObject({ p95BudgetMs: 50, windowMs: 2000 });
  });

  it('reports once a 2 s window of interaction has a p95 above the budget, then starts a new window', () => {
    const { w, onSlow, frames } = harness();
    w.start();
    frames([0, ...Array<number>(30).fill(70)]); // 2.1 s of 70 ms frames
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSlow.mock.calls[0]![0]).toMatchObject({ p95Ms: 70, frames: 29 });
    expect(w.samples).toHaveLength(1);
  });

  it('does not report smooth interaction, nor a few long frames among many fast ones', () => {
    const { w, onSlow, frames } = harness();
    w.start();
    frames([0, ...Array<number>(130).fill(16)]);
    const mixed = Array.from({ length: 130 }, (_, i) => (i % 25 === 0 ? 120 : 16));
    frames(mixed);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('only samples while the camera moves: idle time and pauses between gestures are not frames', () => {
    const { w, onSlow, frames, idle, hasPending, cancel } = harness();
    w.start();
    frames([0, ...Array<number>(10).fill(70)]);
    w.stop();
    expect(cancel).toHaveBeenCalled();
    expect(hasPending()).toBe(false);
    idle(30_000);
    w.start();
    frames([0, ...Array<number>(10).fill(70)]);
    expect(onSlow).not.toHaveBeenCalled(); // 1.4 s sampled so far
    frames(Array<number>(10).fill(70));
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it('ignores pauses longer than a second (hidden tab) and windows with too few frames', () => {
    const { w, onSlow, frames } = harness({ minFrames: 20 });
    w.start();
    frames([0, 5000, 700, 700, 700]); // the 5 s pause is dropped; 3 frames over 2.1 s are too few
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('stops for good on dispose', () => {
    const { w, frames, hasPending } = harness();
    w.start();
    w.dispose();
    frames([0, 16]);
    expect(hasPending()).toBe(false);
    w.start();
    expect(hasPending()).toBe(false);
  });
});
