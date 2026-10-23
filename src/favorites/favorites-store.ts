import { create } from 'zustand';
import { createStorage } from '../utils/storage.ts';
import { registerLocalDataReset } from '../privacy/index.ts';
import { idListSchema } from './id-list.ts';

export const FAVORITES_MAX = 200;

export interface FavoritesState {
  /** Favourite place ids, most recently added first. */
  ids: string[];
  isFavorite(id: string): boolean;
  /**
   * Adds or removes a favourite and returns the resulting state for that id.
   * Adding when the list is full is refused (returns false); see `isFull`.
   */
  toggle(id: string): boolean;
  readonly isFull: boolean;
  clear(): void;
}

export const favoritesStorage = createStorage('favorites', idListSchema(FAVORITES_MAX), []);

export const useFavorites = create<FavoritesState>()((set, get) => {
  const initial = favoritesStorage.get();
  const commit = (ids: string[]): void => {
    set({ ids, isFull: ids.length >= FAVORITES_MAX });
    favoritesStorage.set(ids);
  };
  return {
    ids: initial,
    isFull: initial.length >= FAVORITES_MAX,
    isFavorite: (id) => get().ids.includes(id),
    toggle(id) {
      if (!id) return false;
      const { ids } = get();
      if (ids.includes(id)) {
        commit(ids.filter((x) => x !== id));
        return false;
      }
      if (ids.length >= FAVORITES_MAX) return false;
      commit([id, ...ids]);
      return true;
    },
    clear() {
      set({ ids: [], isFull: false });
      favoritesStorage.clear();
    },
  };
});

registerLocalDataReset(() => useFavorites.setState({ ids: [], isFull: false }));
