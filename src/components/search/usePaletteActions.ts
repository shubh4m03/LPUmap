import { useCallback } from 'react';
import { selectDirectoryItem } from '../../app/artwork-selection.ts';
import { isCommandId } from '../../app/commands.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useCommandRunner } from '../../app/hooks/useCommandRunner.ts';
import { placeEndpoint, routeBlockReason } from '../../app/place-actions.ts';
import { useAppStore } from '../../app/store/index.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../config/categories.ts';
import type { PaletteItem } from './palette-model.ts';

const isGroupId = (v: string): v is LayerGroupId => LAYER_GROUPS.some((g) => g.id === v);

export interface PaletteActions {
  /** Enter / click on an option. */
  activate(item: PaletteItem): void;
  /** Tab on a place: plan a route to it. Returns why it cannot, or null on success. */
  routeTo(item: PaletteItem): string | null;
}

export function usePaletteActions(): PaletteActions {
  const { getPlace, directory, buildingDirectory } = useAtlas();
  const runCommand = useCommandRunner();

  const activate = useCallback(
    (item: PaletteItem) => {
      const s = useAppStore.getState();
      s.closePalette();
      switch (item.kind) {
        case 'place': {
          const place = getPlace(item.ref);
          if (place) s.selectPlace(place.id, { focus: place.location !== null && !s.listMode });
          return;
        }
        case 'artwork': {
          const row = buildingDirectory.item(item.ref);
          if (row) selectDirectoryItem(row);
          return;
        }
        case 'category':
          s.openCategory(item.ref);
          return;
        case 'layer':
          if (isGroupId(item.ref)) s.setGroupVisible(item.ref, true);
          s.openPanel('layers');
          return;
        case 'command':
          if (isCommandId(item.ref)) runCommand(item.ref);
          return;
      }
    },
    [getPlace, buildingDirectory, runCommand],
  );

  const routeTo = useCallback(
    (item: PaletteItem) => {
      if (item.kind === 'artwork')
        return (
          buildingDirectory.artwork?.byId.get(item.ref)?.routableNote ??
          'Items of the campus illustration cannot be routed to.'
        );
      const place = item.kind === 'place' ? getPlace(item.ref) : undefined;
      if (!place) return 'Only places can be routed to.';
      const reason = routeBlockReason(place, directory);
      const endpoint = placeEndpoint(place);
      if (reason || !endpoint) return reason ?? 'This place cannot be routed to.';
      const s = useAppStore.getState();
      s.closePalette();
      s.setDestination(endpoint);
      s.openPanel('directions');
      return null;
    },
    [getPlace, directory, buildingDirectory],
  );

  return { activate, routeTo };
}
