/**
 * What every Studio panel needs: the store, the server actions, the
 * template library and the map context. One instance per StudioSection.
 */
import { createContext, useContext } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StudioActions } from '../../building-studio/ui/index.ts';
import type { StudioLibraryItem } from '../../building-studio/ui/index.ts';
import { useStudio, type StudioStore, type StudioUiState } from '../../building-studio/ui/index.ts';
import type { CampusData, LngLat } from '../../data/index.ts';

export type LibraryState =
  | { status: 'loading'; items: StudioLibraryItem[] }
  | { status: 'ready'; items: StudioLibraryItem[] }
  /** The server library failed: the built-in templates are shown and the reason is stated. */
  | { status: 'fallback'; items: StudioLibraryItem[]; message: string };

export interface StudioServices {
  store: StudioStore;
  actions: StudioActions;
  library: LibraryState;
  reloadLibrary(): void;
  /** Campus data drawn under the editor, or null while it loads. */
  data: CampusData | null;
  isMobile: boolean;
  /** Mapped footprint of a base building, or null. */
  baseFootprint(id: string): LngLat[][] | null;
}

export const StudioContext = createContext<StudioServices | null>(null);

export function useStudioServices(): StudioServices {
  const v = useContext(StudioContext);
  if (!v) throw new Error('Studio components must be inside <StudioContext>');
  return v;
}

/** Subscribes to a slice of the Studio store (shallow-compared, so derived objects are fine). */
export function useStudioState<T>(selector: (s: StudioUiState) => T): T {
  const { store } = useStudioServices();
  return useStudio(store, useShallow(selector));
}
