import { useEffect, useRef } from 'react';
import { useToast } from '../../components/ui/index.ts';
import { useRecents } from '../../favorites/index.ts';
import { useAtlas } from '../data/atlas-context.ts';
import { parsePlaceParam, writePlaceParam } from '../deep-link.ts';
import { useAppStore } from '../store/index.ts';

/**
 * On load, `?place=<id>` selects and focuses that place. Afterwards the URL
 * mirrors the selection via replaceState (no history entries), and each
 * selection is added to recents (useRecents honours the privacy setting).
 */
export function useDeepLink(): void {
  const { getPlace } = useAtlas();
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
    writePlaceParam(null);
    toast.show({ message: 'The linked place is not in the current campus dataset.', tone: 'warning' });
  }, [getPlace, toast]);

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
