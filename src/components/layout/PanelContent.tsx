import type { ReactNode } from 'react';
import { useAppStore, type PanelId } from '../../app/store/index.ts';
import { AboutPanel } from '../about/AboutPanel.tsx';
import { CategoryPanel } from '../categories/CategoryPanel.tsx';
import { DirectionsPanel } from '../directions/DirectionsPanel.tsx';
import { FavoritesPanel } from '../favorites/FavoritesPanel.tsx';
import { CampusInfoPanel } from '../info/CampusInfoPanel.tsx';
import { LayersPanel } from '../layers/LayersPanel.tsx';
import { PlaceDetails } from '../place/PlaceDetails.tsx';
import { SearchResultsPanel } from '../search/SearchResultsPanel.tsx';
import { SettingsPanel } from '../settings/SettingsPanel.tsx';
import { IconButton } from '../ui/index.ts';
import { STATIC_TITLES } from './panel-titles.ts';

export function PanelBody({ panel }: { panel: PanelId }): ReactNode {
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  switch (panel) {
    case 'details':
      return selectedPlaceId ? <PlaceDetails key={selectedPlaceId} placeId={selectedPlaceId} /> : null;
    case 'results':
      return <SearchResultsPanel />;
    case 'directions':
      return <DirectionsPanel />;
    case 'layers':
      return <LayersPanel />;
    case 'favorites':
      return <FavoritesPanel />;
    case 'settings':
      return <SettingsPanel />;
    case 'about':
      return <AboutPanel />;
    case 'info':
      return <CampusInfoPanel />;
    case 'category':
      return <CategoryPanel />;
    case 'none':
      return null;
  }
}

/** "Back" to the panel underneath, when there is one. */
export function PanelBackButton() {
  const below = useAppStore((s) => s.panelStack[s.panelStack.length - 2]);
  const closePanel = useAppStore((s) => s.closePanel);
  if (!below) return null;
  return (
    <IconButton
      icon="chevron-left"
      label={`Back to ${STATIC_TITLES[below].toLowerCase()}`}
      size="sm"
      onClick={closePanel}
    />
  );
}
