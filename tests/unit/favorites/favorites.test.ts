import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';

import type * as FavoritesModule from '../../../src/favorites/index.ts';
import type * as PrivacyModule from '../../../src/privacy/index.ts';

let fav: typeof FavoritesModule;
let privacy: typeof PrivacyModule;

/** Stores are module singletons that read storage at import, so re-import per test. */
async function load(): Promise<void> {
  vi.resetModules();
  privacy = await import('../../../src/privacy/index.ts');
  fav = await import('../../../src/favorites/index.ts');
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await load();
});

const stored = (key: string): unknown => JSON.parse(localStorage.getItem(`lpu-atlas:v1:${key}`) ?? 'null');

describe('useFavorites', () => {
  it('toggles, persists and reports favourites, newest first', () => {
    const s = fav.useFavorites.getState();
    expect(s.toggle('osm:way/1')).toBe(true);
    expect(fav.useFavorites.getState().toggle('osm:way/2')).toBe(true);
    expect(fav.useFavorites.getState().ids).toEqual(['osm:way/2', 'osm:way/1']);
    expect(fav.useFavorites.getState().isFavorite('osm:way/1')).toBe(true);
    expect(stored('favorites')).toEqual(['osm:way/2', 'osm:way/1']);

    expect(fav.useFavorites.getState().toggle('osm:way/1')).toBe(false);
    expect(fav.useFavorites.getState().isFavorite('osm:way/1')).toBe(false);
    expect(stored('favorites')).toEqual(['osm:way/2']);
  });

  it('ignores empty ids', () => {
    expect(fav.useFavorites.getState().toggle('')).toBe(false);
    expect(fav.useFavorites.getState().ids).toEqual([]);
  });

  it('restores favourites on reload, dropping non-strings and duplicates', async () => {
    localStorage.setItem('lpu-atlas:v1:favorites', JSON.stringify(['a', 42, 'b', 'a', null, '', { x: 1 }]));
    await load();
    expect(fav.useFavorites.getState().ids).toEqual(['a', 'b']);
  });

  it('falls back to an empty list on corrupt storage', async () => {
    localStorage.setItem('lpu-atlas:v1:favorites', '"not an array"');
    await load();
    expect(fav.useFavorites.getState().ids).toEqual([]);
    expect(localStorage.getItem('lpu-atlas:v1:favorites')).toBeNull();
  });

  it(`refuses to add beyond ${200} favourites but still allows removal`, () => {
    const ids = Array.from({ length: fav.FAVORITES_MAX }, (_, i) => `cur:p${i}`);
    for (const id of ids) fav.useFavorites.getState().toggle(id);
    const state = fav.useFavorites.getState();
    expect(state.ids).toHaveLength(200);
    expect(state.isFull).toBe(true);
    expect(state.toggle('cur:extra')).toBe(false);
    expect(fav.useFavorites.getState().ids).toHaveLength(200);
    expect(fav.useFavorites.getState().isFavorite('cur:extra')).toBe(false);
    fav.useFavorites.getState().toggle('cur:p0');
    expect(fav.useFavorites.getState().isFull).toBe(false);
  });

  it('caps an oversized stored list on load', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `id${i}`);
    localStorage.setItem('lpu-atlas:v1:favorites', JSON.stringify(many));
    await load();
    expect(fav.useFavorites.getState().ids).toHaveLength(200);
    expect(fav.useFavorites.getState().isFull).toBe(true);
  });

  it('clear() empties memory and storage', () => {
    fav.useFavorites.getState().toggle('x');
    fav.useFavorites.getState().clear();
    expect(fav.useFavorites.getState().ids).toEqual([]);
    expect(localStorage.getItem('lpu-atlas:v1:favorites')).toBeNull();
  });
});

describe('useRecents', () => {
  it('moves pushed ids to the front without duplicates', () => {
    const r = () => fav.useRecents.getState();
    r().push('a');
    r().push('b');
    r().push('a');
    expect(r().ids).toEqual(['a', 'b']);
    expect(stored('recents')).toEqual(['a', 'b']);
  });

  it(`keeps at most APP_CONFIG.search.maxRecent (${APP_CONFIG.search.maxRecent}) entries`, () => {
    for (let i = 0; i < APP_CONFIG.search.maxRecent + 5; i++) fav.useRecents.getState().push(`p${i}`);
    const ids = fav.useRecents.getState().ids;
    expect(ids).toHaveLength(APP_CONFIG.search.maxRecent);
    expect(ids[0]).toBe(`p${APP_CONFIG.search.maxRecent + 4}`);
  });

  it('does nothing while saveHistory is false', () => {
    privacy.usePrivacySettings.getState().setSaveHistory(false);
    fav.useRecents.getState().push('a');
    expect(fav.useRecents.getState().ids).toEqual([]);
    expect(localStorage.getItem('lpu-atlas:v1:recents')).toBeNull();
  });

  it('clears existing recents immediately when saveHistory is turned off', () => {
    fav.useRecents.getState().push('a');
    fav.useRecents.getState().push('b');
    privacy.usePrivacySettings.getState().setSaveHistory(false);
    expect(fav.useRecents.getState().ids).toEqual([]);
    expect(localStorage.getItem('lpu-atlas:v1:recents')).toBeNull();
    privacy.usePrivacySettings.getState().setSaveHistory(true);
    fav.useRecents.getState().push('c');
    expect(fav.useRecents.getState().ids).toEqual(['c']);
  });

  it('ignores leftover stored recents when history is disabled at load', async () => {
    localStorage.setItem('lpu-atlas:v1:privacy', JSON.stringify({ saveHistory: false }));
    localStorage.setItem('lpu-atlas:v1:recents', JSON.stringify(['a']));
    await load();
    expect(fav.useRecents.getState().ids).toEqual([]);
    expect(localStorage.getItem('lpu-atlas:v1:recents')).toBeNull();
  });
});

describe('resolveIds', () => {
  it('drops stale ids and preserves order', () => {
    const data = new Map([
      ['a', { id: 'a' }],
      ['c', { id: 'c' }],
    ]);
    expect(fav.resolveIds(['c', 'b', 'a'], (id) => data.get(id))).toEqual([{ id: 'c' }, { id: 'a' }]);
    expect(fav.resolveIds(['x'], () => null)).toEqual([]);
  });
});
