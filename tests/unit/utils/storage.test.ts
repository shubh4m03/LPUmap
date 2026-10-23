import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  STORAGE_NAMESPACE,
  clearAll,
  createStorage,
  listKeys,
  namespacedKey,
} from '../../../src/utils/storage.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';

const schema = z.object({ count: z.number().int() });
const fallback = { count: 0 };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createStorage', () => {
  it('namespaces keys with prefix and storage version', () => {
    const s = createStorage('counter', schema, fallback);
    expect(s.fullKey).toBe(`${APP_CONFIG.storage.prefix}:v${APP_CONFIG.storage.version}:counter`);
    expect(STORAGE_NAMESPACE).toBe('lpu-atlas:v1:');
    s.set({ count: 3 });
    expect(localStorage.getItem('lpu-atlas:v1:counter')).toBe('{"count":3}');
    expect(localStorage.getItem('counter')).toBeNull();
  });

  it('round-trips a valid value and returns the fallback when absent', () => {
    const s = createStorage('counter', schema, fallback);
    expect(s.get()).toEqual(fallback);
    expect(s.set({ count: 7 })).toBe(true);
    expect(s.get()).toEqual({ count: 7 });
    s.clear();
    expect(s.get()).toEqual(fallback);
    expect(localStorage.getItem(s.fullKey)).toBeNull();
  });

  it('returns the fallback and removes the entry on corrupt JSON', () => {
    localStorage.setItem(namespacedKey('counter'), '{not json');
    const s = createStorage('counter', schema, fallback);
    expect(s.get()).toEqual(fallback);
    expect(localStorage.getItem(namespacedKey('counter'))).toBeNull();
  });

  it('returns the fallback and removes the entry on schema mismatch', () => {
    localStorage.setItem(namespacedKey('counter'), JSON.stringify({ count: 'three' }));
    const s = createStorage('counter', schema, fallback);
    expect(s.get()).toEqual(fallback);
    expect(localStorage.getItem(namespacedKey('counter'))).toBeNull();
  });

  it('applies schema transforms on read', () => {
    const trimmed = createStorage(
      'names',
      z.array(z.string()).transform((a) => a.slice(0, 2)),
      [],
    );
    localStorage.setItem(trimmed.fullKey, JSON.stringify(['a', 'b', 'c']));
    expect(trimmed.get()).toEqual(['a', 'b']);
  });

  it('survives a localStorage that throws on every access', () => {
    const boom = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    const s = createStorage('counter', schema, fallback);
    expect(s.get()).toEqual(fallback);
    expect(s.set({ count: 1 })).toBe(false);
    expect(() => s.clear()).not.toThrow();
  });

  it('reports a failed write when quota is exceeded', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const s = createStorage('counter', schema, fallback);
    expect(s.set({ count: 1 })).toBe(false);
    expect(s.get()).toEqual(fallback);
  });

  it('survives the storage property itself throwing', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const s = createStorage('counter', schema, fallback);
    expect(s.get()).toEqual(fallback);
    expect(s.set({ count: 2 })).toBe(false);
    expect(listKeys()).toEqual([]);
    expect(clearAll()).toBe(0);
  });

  it('can use session storage', () => {
    const s = createStorage('draft', schema, fallback, { area: 'session' });
    s.set({ count: 5 });
    expect(sessionStorage.getItem(s.fullKey)).toBe('{"count":5}');
    expect(localStorage.getItem(s.fullKey)).toBeNull();
  });

  it('rejects empty or colon-containing keys', () => {
    expect(() => createStorage('', schema, fallback)).toThrow();
    expect(() => createStorage('a:b', schema, fallback)).toThrow();
  });
});

describe('listKeys / clearAll', () => {
  it('lists only keys in the current namespace', () => {
    createStorage('b', schema, fallback).set({ count: 1 });
    createStorage('a', schema, fallback).set({ count: 1 });
    localStorage.setItem('lpu-atlas:v0:old', '1');
    localStorage.setItem('other-app:v1:a', '1');
    expect(listKeys()).toEqual(['a', 'b']);
  });

  it('removes every lpu-atlas key (all versions, both areas) and nothing else', () => {
    createStorage('favorites', schema, fallback).set({ count: 1 });
    createStorage('draft', schema, fallback, { area: 'session' }).set({ count: 1 });
    localStorage.setItem('lpu-atlas:v0:legacy', '1');
    localStorage.setItem('other-app', 'keep');
    localStorage.setItem('lpu-atlasX', 'keep');
    sessionStorage.setItem('session-other', 'keep');

    expect(clearAll()).toBe(3);
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem('other-app')).toBe('keep');
    expect(localStorage.getItem('lpu-atlasX')).toBe('keep');
    expect(sessionStorage.getItem('session-other')).toBe('keep');
    expect(sessionStorage.length).toBe(1);
  });
});
