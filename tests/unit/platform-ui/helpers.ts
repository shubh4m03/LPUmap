import { defaultThemeStore } from '../../../src/accessibility/index.ts';
import { useFavorites, useRecents } from '../../../src/favorites/index.ts';
import { useCorrectionDraft } from '../../../src/feedback/index.ts';
import { usePrivacySettings } from '../../../src/privacy/index.ts';
import { resetAppStore } from '../app/render-helpers.tsx';

/** Every store and storage area these panels touch, back to a clean slate. */
export function resetPlatformState(): void {
  resetAppStore();
  usePrivacySettings.getState().setSaveHistory(true);
  useFavorites.getState().clear();
  useRecents.getState().clear();
  useCorrectionDraft.getState().reset();
  defaultThemeStore.setPreference('system');
  localStorage.clear();
  sessionStorage.clear();
}
