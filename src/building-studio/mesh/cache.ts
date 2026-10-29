/**
 * Stable hashing and a small LRU cache for generated meshes. Pure; no DOM.
 *
 * The cache key is a hash of the CANONICAL JSON of the model config (keys
 * sorted at every level) plus the base footprint for 'footprint-prism', so two
 * equal configs share one mesh however their objects were built. Meshes are
 * immutable values: callers must not modify a cached mesh.
 */
import type { LngLat } from '../../data/index.ts';
import { canonicalJson } from '../canonical.ts';
import type { ModelConfigV1 } from '../schema.ts';
import { generateStudioMeshDetailed, type DetailedMeshResult, type GenerateOptions } from './generate.ts';
import type { StudioMesh } from './types.ts';

export { canonicalJson } from '../canonical.ts';

/**
 * 53-bit string hash (cyrb53: two multiplicative 32-bit lanes), as 14 hex
 * digits. Deterministic across runs and platforms; not cryptographic.
 */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

/** Cache key of a model + options (the base footprint matters only for 'footprint-prism'). */
export function meshCacheKey(config: ModelConfigV1, opts: GenerateOptions = {}): string {
  const base: readonly (readonly LngLat[])[] | null =
    config.generatorId === 'footprint-prism' ? (opts.baseFootprint ?? null) : null;
  return hashString(canonicalJson({ config, base }));
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0; // `+ 0` turns -0 into 0

/** Content hash of a mesh (coordinates rounded to 1 µm): equal meshes ⇔ equal hashes, across runs. */
export function meshHash(m: StudioMesh): string {
  const r3 = (v: readonly number[]) => v.map(round6);
  return hashString(
    canonicalJson({
      origin: m.origin,
      closed: m.closed,
      footprint: m.footprint.map((ring) => ring.map(r3)),
      faces: m.faces.map((f) => ({
        ring: f.ring.map(r3),
        holes: f.holes?.map((h) => h.map(r3)),
        normal: r3(f.normal),
        material: f.material,
        windows: f.windows,
      })),
    }),
  );
}

export interface MeshCache {
  /** The cached result for this config, generating it on a miss. */
  get(config: ModelConfigV1, opts?: GenerateOptions): DetailedMeshResult;
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  clear(): void;
}

/** LRU cache of generateStudioMeshDetailed results, keyed by meshCacheKey. */
export function createMeshCache(maxEntries = 256): MeshCache {
  const entries = new Map<string, DetailedMeshResult>();
  let hits = 0;
  let misses = 0;
  return {
    get(config, opts = {}) {
      const key = meshCacheKey(config, opts);
      const hit = entries.get(key);
      if (hit) {
        hits++;
        entries.delete(key);
        entries.set(key, hit); // most recently used last
        return hit;
      }
      misses++;
      const result = generateStudioMeshDetailed(config, opts);
      entries.set(key, result);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return result;
    },
    get size() {
      return entries.size;
    },
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
    clear() {
      entries.clear();
      hits = 0;
      misses = 0;
    },
  };
}
