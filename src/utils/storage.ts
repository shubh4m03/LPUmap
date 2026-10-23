/**
 * Versioned, validated wrapper around Web Storage.
 *
 * Every key is namespaced as `lpu-atlas:v<version>:<key>`. Reads are validated
 * with Zod: corrupt JSON or a payload that no longer matches the schema yields
 * the fallback and the bad entry is removed. Every access is wrapped in
 * try/catch because storage can throw (Safari private mode, quota exceeded,
 * SecurityError when cookies are blocked) — persistence is a convenience, so a
 * failure degrades to in-memory behaviour instead of breaking the app.
 */
import type { ZodType } from 'zod';
import { APP_CONFIG } from '../config/index.ts';

export type StorageArea = 'local' | 'session';

export interface TypedStorage<T> {
  /** The validated stored value, or the fallback. */
  get(): T;
  /** Returns false when the write failed (quota, private mode, blocked storage). */
  set(value: T): boolean;
  clear(): void;
  /** Fully namespaced key, e.g. `lpu-atlas:v1:favorites`. */
  readonly fullKey: string;
}

const ROOT_PREFIX = `${APP_CONFIG.storage.prefix}:`;

/** `lpu-atlas:v1:` — the namespace for the current storage version. */
export const STORAGE_NAMESPACE = `${ROOT_PREFIX}v${APP_CONFIG.storage.version}:`;

export function namespacedKey(key: string): string {
  return `${STORAGE_NAMESPACE}${key}`;
}

function resolveArea(area: StorageArea): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return area === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    // Accessing the property itself throws a SecurityError when storage is blocked.
    return null;
  }
}

function safeRemove(store: Storage, fullKey: string): void {
  try {
    store.removeItem(fullKey);
  } catch {
    // Nothing more can be done; the next read validates again.
  }
}

export function createStorage<T>(
  key: string,
  schema: ZodType<T>,
  fallback: T,
  opts: { area?: StorageArea } = {},
): TypedStorage<T> {
  if (!key || key.includes(':')) throw new Error(`Invalid storage key "${key}"`);
  const fullKey = namespacedKey(key);
  const area = opts.area ?? 'local';

  return {
    fullKey,
    get(): T {
      const store = resolveArea(area);
      if (!store) return fallback;
      let raw: string | null;
      try {
        raw = store.getItem(fullKey);
      } catch {
        return fallback;
      }
      if (raw === null) return fallback;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        safeRemove(store, fullKey);
        return fallback;
      }
      const result = schema.safeParse(parsed);
      if (!result.success) {
        safeRemove(store, fullKey);
        return fallback;
      }
      return result.data;
    },
    set(value: T): boolean {
      const store = resolveArea(area);
      if (!store) return false;
      try {
        store.setItem(fullKey, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    clear(): void {
      const store = resolveArea(area);
      if (store) safeRemove(store, fullKey);
    },
  };
}

function keysWithPrefix(store: Storage, prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k !== null && k.startsWith(prefix)) keys.push(k);
    }
  } catch {
    return keys;
  }
  return keys;
}

/** Unprefixed keys stored under the current namespace in the given area. */
export function listKeys(area: StorageArea = 'local'): string[] {
  const store = resolveArea(area);
  if (!store) return [];
  return keysWithPrefix(store, STORAGE_NAMESPACE)
    .map((k) => k.slice(STORAGE_NAMESPACE.length))
    .sort();
}

/**
 * Removes every key this app ever wrote — all storage versions, in both local
 * and session storage — and nothing else. Returns the number of keys removed.
 */
export function clearAll(): number {
  let removed = 0;
  for (const area of ['local', 'session'] as const) {
    const store = resolveArea(area);
    if (!store) continue;
    for (const k of keysWithPrefix(store, ROOT_PREFIX)) {
      safeRemove(store, k);
      removed++;
    }
  }
  return removed;
}
