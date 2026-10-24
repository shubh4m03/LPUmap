import type { ReactNode } from 'react';
import { useAppStore, type PanelId } from '../../app/store/index.ts';
import { CategoryPanel } from '../categories/CategoryPanel.tsx';
import { DirectoryPanel } from '../directory/DirectoryPanel.tsx';
import { LayersPanel } from '../layers/LayersPanel.tsx';
import { PlaceDetails } from '../place/PlaceDetails.tsx';
import { SearchResultsPanel } from '../search/SearchResultsPanel.tsx';
import { IconButton } from '../ui/index.ts';
import {
  LazyAboutPanel,
  LazyCampusInfoPanel,
  LazyDirectionsPanel,
  LazyFavoritesPanel,
  LazySettingsPanel,
  LazySuggestPanel,
} from './deferred-panels.ts';
import { PanelSuspense } from './PanelSuspense.tsx';
import { STATIC_TITLES } from './panel-titles.ts';

export function PanelBody({ panel }: { panel: PanelId }): ReactNode {
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  switch (panel) {
    case 'details':
      return selectedPlaceId ? <PlaceDetails key={selectedPlaceId} placeId={selectedPlaceId} /> : null;
    case 'results':
      return <SearchResultsPanel />;
    case 'directions':
      return (
        <PanelSuspense label="Loading directions…">
          <LazyDirectionsPanel />
        </PanelSuspense>
      );
    case 'layers':
      return <LayersPanel />;
    case 'favorites':
      return (
        <PanelSuspense label="Loading saved places…">
          <LazyFavoritesPanel />
        </PanelSuspense>
      );
    case 'settings':
      return (
        <PanelSuspense label="Loading settings…">
          <LazySettingsPanel />
        </PanelSuspense>
      );
    case 'about':
      return (
        <PanelSuspense label="Loading data sources…">
          <LazyAboutPanel />
        </PanelSuspense>
      );
    case 'info':
      return (
        <PanelSuspense label="Loading campus information…">
          <LazyCampusInfoPanel />
        </PanelSuspense>
      );
    case 'category':
      return <CategoryPanel />;
    case 'directory':
      return <DirectoryPanel />;
    case 'suggest':
      return (
        <PanelSuspense label="Loading the suggestion form…">
          <LazySuggestPanel />
        </PanelSuspense>
      );
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
