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
  directory: 'Building directory',
  suggest: 'Suggest a missing place',
};

/**
 * Visible header text of a panel. The details panel shows its kind ("Place details"):
 * the place name is the panel's own first heading, so repeating it in the header
 * would show the same name twice.
 */
export function usePanelTitle(panel: PanelId): string {
  const categoryId = useAppStore((s) => s.categoryId);
  if (panel === 'none') return '';
  if (panel === 'category' && categoryId) return getCategory(categoryId).label;
  return STATIC_TITLES[panel];
}

/**
 * Accessible name of the panel landmark / sheet: the place name for details (so
 * screen-reader users hear which place the region is about), else the header text.
 */
export function usePanelLabel(panel: PanelId): string {
  const { getPlace, buildingDirectory } = useAtlas();
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  const title = usePanelTitle(panel);
  if (panel === 'details' && selectedPlaceId) {
    const name = getPlace(selectedPlaceId)?.displayName;
    if (name) return `${name}, ${STATIC_TITLES.details.toLowerCase()}`;
    // An item of the campus illustration (`art:` id): its exact printed title.
    const art = buildingDirectory.artwork?.byId.get(selectedPlaceId);
    if (art) return `${art.title}, ${ILLUSTRATION_DETAILS_LABEL}`;
  }
  return title;
}

/** Landmark name suffix of the details panel for an item of the campus illustration. */
export const ILLUSTRATION_DETAILS_LABEL = 'campus illustration item details';
