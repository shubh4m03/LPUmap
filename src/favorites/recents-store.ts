import { create } from 'zustand';
import { APP_CONFIG } from '../config/index.ts';
import { createStorage } from '../utils/storage.ts';
import { registerLocalDataReset, usePrivacySettings } from '../privacy/index.ts';
import { idListSchema } from './id-list.ts';

export interface RecentsState {
  /** Recently opened place ids, newest first. */
  ids: string[];
  /** Moves the id to the front. No-op while the "save history" setting is off. */
  push(id: string): void;
  clear(): void;
}

const MAX = APP_CONFIG.search.maxRecent;

export const recentsStorage = createStorage('recents', idListSchema(MAX), []);

function initialRecents(): string[] {
  if (!usePrivacySettings.getState().saveHistory) {
    // Defensive: history was disabled but an older entry survived; honour the setting.
    recentsStorage.clear();
    return [];
  }
  return recentsStorage.get();
}

export const useRecents = create<RecentsState>()((set, get) => ({
  ids: initialRecents(),
  push(id) {
    if (!id || !usePrivacySettings.getState().saveHistory) return;
    const ids = [id, ...get().ids.filter((x) => x !== id)].slice(0, MAX);
    set({ ids });
    recentsStorage.set(ids);
  },
  clear() {
    set({ ids: [] });
    recentsStorage.clear();
  },
}));

// Turning history off deletes the existing list immediately, not on next load.
usePrivacySettings.subscribe((state, prev) => {
  if (prev.saveHistory && !state.saveHistory) useRecents.getState().clear();
});

registerLocalDataReset(() => useRecents.setState({ ids: [] }));
