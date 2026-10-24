/**
 * Mesh cache keyed by a stable config hash; canonical JSON; mesh hashes that
 * are stable across runs.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createMeshCache,
  hashString,
  meshCacheKey,
  meshHash,
} from '../../../src/building-studio/mesh/cache.ts';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import { FOOTPRINT, model } from './fixtures.ts';

describe('canonical JSON and hashes', () => {
  it('ignores key order and undefined members, normalises -0', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: undefined, c: -0 }] })).toBe('{"a":[1,{"c":0}],"b":1}');
    expect(hashString('abc')).toMatch(/^[0-9a-f]{14}$/);
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });

  it('cache keys are equal for equal configs however they were built', () => {
    const a = model();
    const b = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(model()).reverse())));
    expect(meshCacheKey(a)).toBe(meshCacheKey(b));
    expect(meshCacheKey(a)).not.toBe(meshCacheKey(model({ widthM: 21 })));
    // The base footprint only matters for footprint-prism.
    expect(meshCacheKey(a, { baseFootprint: FOOTPRINT.coordinates })).toBe(meshCacheKey(a));
    const prism = model({ generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } });
    expect(meshCacheKey(prism, { baseFootprint: FOOTPRINT.coordinates })).not.toBe(meshCacheKey(prism));
  });

  it('mesh hash of the reference box is stable across runs (golden value)', () => {
    const r = generateStudioMesh(model({ rotationDeg: 30 }));
    if (!r.ok) throw new Error(r.message);
    // Golden: changes only when the box generator's output changes (which needs a new generator version).
    expect(meshHash(r.mesh)).toBe(GOLDEN_BOX_HASH);
  });
});

describe('LRU mesh cache', () => {
  it('hits for equal configs, evicts the least recently used, clears', () => {
    const cache = createMeshCache(2);
    const a = cache.get(model({ widthM: 10 }));
    expect(cache.get(model({ widthM: 10 }))).toBe(a);
    cache.get(model({ widthM: 11 }));
    cache.get(model({ widthM: 10 })); // touch a
    cache.get(model({ widthM: 12 })); // evicts 11
    expect(cache.size).toBe(2);
    expect(cache.get(model({ widthM: 10 }))).toBe(a);
    expect(cache.hits).toBe(3);
    expect(cache.misses).toBe(3);
    cache.get(model({ widthM: 11 }));
    expect(cache.misses).toBe(4);
    cache.clear();
    expect([cache.size, cache.hits, cache.misses]).toEqual([0, 0, 0]);
  });
});

const GOLDEN_BOX_HASH = '0f870e8555ccff';
