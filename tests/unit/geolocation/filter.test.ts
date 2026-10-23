import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { destinationPoint } from '../../../src/distance/index.ts';
import { classifySample } from '../../../src/geolocation/index.ts';
import type { GeoSample } from '../../../src/geolocation/index.ts';

const NOW = 1_800_000_000_000;
const HOME: LngLat = [75.7032, 31.2533];

function sample(over: Partial<GeoSample> = {}): GeoSample {
  return { lngLat: HOME, accuracyM: 10, timestamp: NOW, speedMps: null, headingDeg: null, ...over };
}

describe('classifySample', () => {
  it('accepts a fresh, accurate first fix', () => {
    expect(classifySample(sample(), null, NOW)).toEqual({ accepted: true });
  });

  it.each([
    ['NaN longitude', { lngLat: [Number.NaN, 31.25] as LngLat }],
    ['latitude out of range', { lngLat: [75.7, 95] as LngLat }],
    ['negative accuracy', { accuracyM: -1 }],
    ['non-finite accuracy', { accuracyM: Infinity }],
    ['non-finite timestamp', { timestamp: Number.NaN }],
  ])('rejects %s as invalid', (_label, over) => {
    expect(classifySample(sample(over), null, NOW)).toEqual({ accepted: false, reason: 'invalid' });
  });

  it('rejects fixes worse than maxAcceptedAccuracyM, accepting the boundary', () => {
    const max = APP_CONFIG.geolocation.maxAcceptedAccuracyM;
    expect(classifySample(sample({ accuracyM: max }), null, NOW).accepted).toBe(true);
    expect(classifySample(sample({ accuracyM: max + 0.1 }), null, NOW)).toEqual({
      accepted: false,
      reason: 'low-accuracy',
    });
  });

  it('rejects fixes older than staleAfterMs', () => {
    const stale = APP_CONFIG.geolocation.staleAfterMs;
    expect(classifySample(sample({ timestamp: NOW - stale }), null, NOW).accepted).toBe(true);
    expect(classifySample(sample({ timestamp: NOW - stale - 1 }), null, NOW)).toEqual({
      accepted: false,
      reason: 'stale',
    });
  });

  it('rejects fixes not newer than the previous accepted one', () => {
    const prev = sample({ timestamp: NOW - 1000 });
    expect(classifySample(sample({ timestamp: NOW - 1000 }), prev, NOW)).toEqual({
      accepted: false,
      reason: 'out-of-order',
    });
    expect(classifySample(sample({ timestamp: NOW - 2000 }), prev, NOW)).toEqual({
      accepted: false,
      reason: 'out-of-order',
    });
  });

  it('rejects implausible jumps after allowing for both accuracy radii', () => {
    const prev = sample({ timestamp: NOW - 1000, accuracyM: 5 });
    const far = destinationPoint(HOME, 90, 500);
    expect(classifySample(sample({ lngLat: far, accuracyM: 5 }), prev, NOW)).toEqual({
      accepted: false,
      reason: 'implausible-jump',
    });
    // 20 m in 1 s is too fast on its own, but 2 × 10 m accuracy explains it.
    const near = destinationPoint(HOME, 90, 20);
    const prevNoisy = sample({ timestamp: NOW - 1000, accuracyM: 10 });
    expect(classifySample(sample({ lngLat: near, accuracyM: 10 }), prevNoisy, NOW).accepted).toBe(true);
  });

  it('accepts a long move when enough time has passed', () => {
    const prev = sample({ timestamp: NOW - 20_000, accuracyM: 5 });
    const walked = destinationPoint(HOME, 0, 30);
    expect(classifySample(sample({ lngLat: walked, accuracyM: 5 }), prev, NOW).accepted).toBe(true);
  });

  it('checks validity before anything else', () => {
    const bad = sample({ lngLat: [Number.NaN, 0], accuracyM: 500, timestamp: 0 });
    expect(classifySample(bad, sample(), NOW)).toEqual({ accepted: false, reason: 'invalid' });
  });
});
