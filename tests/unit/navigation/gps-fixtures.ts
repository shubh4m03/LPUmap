/**
 * Deterministic synthetic GPS tracks for tracker accuracy tests.
 *
 * These are invented noise models, not recordings: every track is generated
 * from a fixed seed, so a test run always sees the same samples. The true
 * travelled distance of each track is known exactly, so the tracker's total
 * can be compared with it.
 *
 * Noise models (metres, applied east/north around the true position):
 * - `uniform`: independent, uniform in a disk of `radiusM` (the case recorded
 *   in docs/modules/geolocation-navigation.md: ±5 m at 10 m accuracy).
 * - `gauss`: independent isotropic Gaussian whose 95 % radius equals the
 *   reported accuracy (the W3C definition of `accuracy`), the harshest
 *   honest case.
 * - `ar1`: Gaussian with the same spread but correlated over time
 *   (AR(1), ρ = 0.9 per second), closer to how receiver error behaves.
 */
import type { LngLat } from '../../../src/data/schema.ts';
import { destinationPoint, haversineM } from '../../../src/distance/index.ts';
import type { GeoSample } from '../../../src/geolocation/index.ts';

export const FIXTURE_T0 = 1_800_000_000_000;
export const FIXTURE_HOME: LngLat = [75.7032, 31.2533];
/** 95 % radius = σ × √(2 ln 20) for an isotropic 2-D Gaussian. */
const R95_PER_SIGMA = Math.sqrt(2 * Math.log(20));

export type NoiseModel =
  | { kind: 'none' }
  | { kind: 'uniform'; radiusM: number }
  | { kind: 'gauss'; r95M: number }
  | { kind: 'ar1'; r95M: number; rho: number };

export interface Track {
  samples: GeoSample[];
  /** Exact length of the true path, metres. */
  trueDistanceM: number;
}

/** mulberry32: small seeded PRNG so tracks are reproducible. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPair(r: () => number): [number, number] {
  // Box–Muller; 1 − r() keeps the log argument in (0, 1].
  const u = 1 - r();
  const v = r();
  const m = Math.sqrt(-2 * Math.log(u));
  return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
}

function createNoise(model: NoiseModel, r: () => number): () => [number, number] {
  switch (model.kind) {
    case 'none':
      return () => [0, 0];
    case 'uniform':
      return () => {
        const d = Math.sqrt(r()) * model.radiusM;
        const a = r() * 2 * Math.PI;
        return [d * Math.cos(a), d * Math.sin(a)];
      };
    case 'gauss': {
      const sigma = model.r95M / R95_PER_SIGMA;
      return () => {
        const [x, y] = gaussianPair(r);
        return [x * sigma, y * sigma];
      };
    }
    case 'ar1': {
      const sigma = model.r95M / R95_PER_SIGMA;
      const innovation = sigma * Math.sqrt(1 - model.rho * model.rho);
      let [x, y] = gaussianPair(r).map((v) => v * sigma) as [number, number];
      return () => {
        const out: [number, number] = [x, y];
        const [ex, ey] = gaussianPair(r);
        x = model.rho * x + innovation * ex;
        y = model.rho * y + innovation * ey;
        return out;
      };
    }
  }
}

function offset(p: LngLat, [east, north]: [number, number]): LngLat {
  const d = Math.hypot(east, north);
  if (d === 0) return p;
  return destinationPoint(p, (Math.atan2(east, north) * 180) / Math.PI, d);
}

/**
 * A path of straight legs walked at `speeds[i]` m/s (0 = standing for
 * `durationsS[i]`), sampled every `intervalS` seconds with the given noise.
 */
export interface Leg {
  bearingDeg: number;
  speedMps: number;
  durationS: number;
}

export function generateTrack(opts: {
  seed: number;
  legs: Leg[];
  noise: NoiseModel;
  accuracyM: number;
  intervalS?: number;
  start?: LngLat;
}): Track {
  const r = seeded(opts.seed);
  const noise = createNoise(opts.noise, r);
  const interval = opts.intervalS ?? 1;
  const samples: GeoSample[] = [];
  let truth = opts.start ?? FIXTURE_HOME;
  let trueDistanceM = 0;
  let t = 0;
  const emit = () => {
    samples.push({
      lngLat: offset(truth, noise()),
      accuracyM: opts.accuracyM,
      timestamp: FIXTURE_T0 + Math.round(t * 1000),
      speedMps: null,
      headingDeg: null,
    });
  };
  emit();
  for (const leg of opts.legs) {
    const steps = Math.round(leg.durationS / interval);
    for (let i = 0; i < steps; i++) {
      const step = leg.speedMps * interval;
      if (step > 0) {
        const next = destinationPoint(truth, leg.bearingDeg, step);
        trueDistanceM += haversineM(truth, next);
        truth = next;
      }
      t += interval;
      emit();
    }
  }
  return { samples, trueDistanceM };
}

export const stand = (durationS: number): Leg => ({ bearingDeg: 0, speedMps: 0, durationS });
export const walk = (bearingDeg: number, speedMps: number, durationS: number): Leg => ({
  bearingDeg,
  speedMps,
  durationS,
});
