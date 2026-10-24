import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, adminHref, isAdminPath, parseAdminRoute } from '../../../src/admin/routes.ts';
import {
  clearAllRecovery,
  loadRecovery,
  saveRecovery,
  type EnumerableRecoveryStorage,
} from '../../../src/building-studio/local-recovery.ts';
import { draft } from '../building-studio/fixtures.ts';

describe('/admin routes', () => {
  it('recognises only /admin and below', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin/studio/stu:x')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/api/admin/session')).toBe(false);
  });

  it('parses sections, encoded ids and filters; /admin is the queue', () => {
    expect(parseAdminRoute('/admin')).toEqual({ section: 'queue', id: null, query: {} });
    expect(parseAdminRoute('/admin/overrides/osm%3Away%2F123', '?hidden=1&q=')).toEqual({
      section: 'overrides',
      id: 'osm:way/123',
      query: { hidden: '1' },
    });
    expect(parseAdminRoute('/admin/nope')).toBeNull();
    expect(parseAdminRoute('/admin/queue/a/b')).toBeNull();
    expect(parseAdminRoute('/admin/queue/%E0%A4%A')).toBeNull();
    expect(parseAdminRoute('/elsewhere')).toBeNull();
  });

  it('round-trips every section through adminHref', () => {
    for (const section of ADMIN_SECTIONS) {
      const href = adminHref({ section, id: 'cur:main-gate', query: { status: 'pending' } });
      const [path, search] = href.split('?');
      expect(parseAdminRoute(path!, `?${search}`)).toEqual({
        section,
        id: 'cur:main-gate',
        query: { status: 'pending' },
      });
    }
    expect(adminHref({ section: 'audit' })).toBe('/admin/audit');
  });
});

class MemoryStorage implements EnumerableRecoveryStorage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('clearAllRecovery (admin logout)', () => {
  it('removes every Studio recovery entry and nothing else', () => {
    const storage = new MemoryStorage();
    storage.setItem('lpu-atlas:favorites', '[]');
    expect(saveRecovery('stu:abc', draft(), { storage })).toBe(true);
    expect(saveRecovery('new', draft(), { storage })).toBe(true);
    expect(clearAllRecovery({ storage })).toBe(2);
    expect(loadRecovery('stu:abc', { storage })).toBeNull();
    expect(loadRecovery('new', { storage })).toBeNull();
    expect(storage.getItem('lpu-atlas:favorites')).toBe('[]');
  });

  it('reports 0 when storage is missing or throws', () => {
    expect(clearAllRecovery({ storage: null })).toBe(0);
    const broken = {
      get length(): number {
        throw new Error('SecurityError');
      },
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(clearAllRecovery({ storage: broken })).toBe(0);
  });
});
