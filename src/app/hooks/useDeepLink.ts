import { useEffect, useRef } from 'react';
import { useToast } from '../../components/ui/index.ts';
import { useRecents } from '../../favorites/index.ts';
import { useAtlas } from '../data/atlas-context.ts';
import { selectDirectoryItem } from '../artwork-selection.ts';
import { isArtworkId, parsePlaceParam, writePlaceParam } from '../deep-link.ts';
import { useAppStore } from '../store/index.ts';

/**
 * On load, `?place=<id>` selects and focuses that place. Afterwards the URL
 * mirrors the selection via replaceState (no history entries), and each
 * selection is added to recents (useRecents honours the privacy setting).
 */
export function useDeepLink(): void {
  const { getPlace, buildingDirectory } = useAtlas();
  const toast = useToast();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const raw = new URLSearchParams(window.location.search).get('place');
    if (raw === null) return;
    const id = parsePlaceParam(window.location.search);
    if (id && getPlace(id)) {
      useAppStore.getState().selectPlace(id, { focus: true });
      return;
    }
    // An item of the campus illustration: a verified one opens its building, any other its own details.
    const art = id && isArtworkId(id) ? buildingDirectory.item(id) : undefined;
    if (art) {
      selectDirectoryItem(art, { focus: true });
      // A verified item IS its building: the address bar names the building from now on.
      if (art.id !== id) writePlaceParam(art.id);
      return;
    }
    writePlaceParam(null);
    toast.show({ message: 'The linked place is not in the current campus dataset.', tone: 'warning' });
  }, [getPlace, buildingDirectory, toast]);

  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.selectedPlaceId === prev.selectedPlaceId) return;
        writePlaceParam(s.selectedPlaceId);
        if (s.selectedPlaceId) useRecents.getState().push(s.selectedPlaceId);
      }),
    [],
  );
}
