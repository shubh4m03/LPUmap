import { describe, expect, it } from 'vitest';
import { APP_CONFIG, validateConfig } from '../../../src/config/index.ts';
import { MAX_PITCH } from '../../../src/map/providers/camera.ts';

const withMap = (over: Partial<Record<string, unknown>>) => ({
  ...APP_CONFIG,
  map: { ...APP_CONFIG.map, ...over },
});

describe('APP_CONFIG.map 3D pitch (G-13)', () => {
  it('phones tilt less than larger screens, both within the camera limit', () => {
    expect(APP_CONFIG.map.pitch3dCompact).toBeLessThan(APP_CONFIG.map.pitch3d);
    expect(APP_CONFIG.map.pitch3d).toBeLessThanOrEqual(MAX_PITCH);
    expect(() => validateConfig()).not.toThrow();
  });

  it('validateConfig refuses a compact pitch steeper than the desktop one, or a missing one', () => {
    expect(() => validateConfig(withMap({ pitch3dCompact: 60 }))).toThrow(/pitch3dCompact/);
    expect(() => validateConfig(withMap({ pitch3dCompact: undefined }))).toThrow();
  });
});
