import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PrivacyModule from '../../../src/privacy/index.ts';
import type * as FavoritesModule from '../../../src/favorites/index.ts';
import type * as FeedbackModule from '../../../src/feedback/index.ts';

let privacy: typeof PrivacyModule;
let fav: typeof FavoritesModule;
let feedback: typeof FeedbackModule;

async function load(): Promise<void> {
  vi.resetModules();
  privacy = await import('../../../src/privacy/index.ts');
  fav = await import('../../../src/favorites/index.ts');
  feedback = await import('../../../src/feedback/index.ts');
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await load();
});

describe('usePrivacySettings', () => {
  it('defaults saveHistory to true and persists changes', async () => {
    expect(privacy.usePrivacySettings.getState().saveHistory).toBe(true);
    privacy.usePrivacySettings.getState().setSaveHistory(false);
    expect(JSON.parse(localStorage.getItem('lpu-atlas:v1:privacy') ?? '{}')).toEqual({ saveHistory: false });
    await load();
    expect(privacy.usePrivacySettings.getState().saveHistory).toBe(false);
  });

  it('falls back to defaults on an invalid stored setting', async () => {
    localStorage.setItem('lpu-atlas:v1:privacy', JSON.stringify({ saveHistory: 'no' }));
    await load();
    expect(privacy.usePrivacySettings.getState().saveHistory).toBe(true);
  });

  it('clearAllLocalData removes every app key and resets in-memory stores', () => {
    fav.useFavorites.getState().toggle('osm:way/1');
    fav.useRecents.getState().push('osm:way/2');
    feedback.useCorrectionDraft.getState().update({ details: 'half written' });
    privacy.usePrivacySettings.getState().setSaveHistory(false);
    localStorage.setItem('lpu-atlas:v1:theme', '"dark"');
    localStorage.setItem('lpu-atlas:v0:legacy', '1');
    localStorage.setItem('unrelated', 'keep');

    privacy.usePrivacySettings.getState().clearAllLocalData();

    const ours = (s: Storage) =>
      Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k) => k?.startsWith('lpu-atlas:'));
    expect(ours(localStorage)).toEqual([]);
    expect(ours(sessionStorage)).toEqual([]);
    expect(localStorage.getItem('unrelated')).toBe('keep');

    expect(fav.useFavorites.getState().ids).toEqual([]);
    expect(fav.useRecents.getState().ids).toEqual([]);
    expect(feedback.useCorrectionDraft.getState().draft).toEqual(feedback.EMPTY_DRAFT);
    expect(privacy.usePrivacySettings.getState().saveHistory).toBe(true);
  });

  it('runs registered reset handlers and supports unregistering', () => {
    const handler = vi.fn();
    const off = privacy.registerLocalDataReset(handler);
    privacy.usePrivacySettings.getState().clearAllLocalData();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    privacy.usePrivacySettings.getState().clearAllLocalData();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => privacy.usePrivacySettings.getState().setSaveHistory(false)).not.toThrow();
    expect(privacy.usePrivacySettings.getState().saveHistory).toBe(false);
    expect(() => privacy.usePrivacySettings.getState().clearAllLocalData()).not.toThrow();
  });
});

describe('PRIVACY_FACTS', () => {
  it('has unique ids and non-empty text', () => {
    const ids = privacy.PRIVACY_FACTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of privacy.PRIVACY_FACTS) {
      expect(f.title.trim()).not.toBe('');
      expect(f.detail.trim()).not.toBe('');
    }
  });

  it('states that location is processed on-device and never sent, and lists stored data', () => {
    const text = privacy.PRIVACY_FACTS.map((f) => `${f.title} ${f.detail}`)
      .join(' ')
      .toLowerCase();
    expect(text).toContain('never stored or sent anywhere');
    expect(text).toContain('no analytics');
    for (const word of ['favourites', 'recent', 'settings', 'session storage']) expect(text).toContain(word);
  });
});
