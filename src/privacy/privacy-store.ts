import { create } from 'zustand';
import { z } from 'zod';
import { clearAll, createStorage } from '../utils/storage.ts';

export interface PrivacySettingsState {
  /** Whether recently opened places are remembered. Defaults to true. */
  saveHistory: boolean;
  setSaveHistory(value: boolean): void;
  /** Deletes every key this app stored and resets in-memory stores to defaults. */
  clearAllLocalData(): void;
}

const settingsSchema = z.object({ saveHistory: z.boolean() });
type PersistedSettings = z.infer<typeof settingsSchema>;

const DEFAULTS: PersistedSettings = { saveHistory: true };

export const privacySettingsStorage = createStorage('privacy', settingsSchema, DEFAULTS);

type ResetHandler = () => void;
const resetHandlers = new Set<ResetHandler>();

/**
 * Lets other modules (favourites, theme, drafts) reset their in-memory state
 * when the user clears local data. Privacy cannot import them directly without
 * creating an import cycle. Returns an unregister function.
 */
export function registerLocalDataReset(handler: ResetHandler): () => void {
  resetHandlers.add(handler);
  return () => resetHandlers.delete(handler);
}

export const usePrivacySettings = create<PrivacySettingsState>()((set) => ({
  saveHistory: privacySettingsStorage.get().saveHistory,
  setSaveHistory(value) {
    // Recents subscribe to this store and clear themselves when history is turned off.
    set({ saveHistory: value });
    privacySettingsStorage.set({ saveHistory: value });
  },
  clearAllLocalData() {
    clearAll();
    set({ saveHistory: DEFAULTS.saveHistory });
    for (const handler of resetHandlers) handler();
    // A handler may have persisted its defaults while resetting; storage must end up empty.
    clearAll();
  },
}));
