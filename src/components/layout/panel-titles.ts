import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore, type OpenPanelId, type PanelId } from '../../app/store/index.ts';
import { getCategory } from '../../config/categories.ts';

export const STATIC_TITLES: Record<OpenPanelId, string> = {
  results: 'Search results',
  details: 'Place details',
  directions: 'Directions',
  layers: 'Map layers',
  favorites: 'Saved places',
  settings: 'Settings & privacy',
  about: 'About & data sources',
  info: 'Campus information',
  category: 'Category',
};

/** Title of a panel as shown in its header (place / category names when known). */
export function usePanelTitle(panel: PanelId): string {
  const { getPlace } = useAtlas();
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  const categoryId = useAppStore((s) => s.categoryId);
  if (panel === 'none') return '';
  if (panel === 'details' && selectedPlaceId)
    return getPlace(selectedPlaceId)?.displayName ?? STATIC_TITLES.details;
  if (panel === 'category' && categoryId) return getCategory(categoryId).label;
  return STATIC_TITLES[panel];
}
