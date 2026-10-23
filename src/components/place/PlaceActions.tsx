import { useId } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { placeEndpoint, routeBlockReason, shareUrlFor } from '../../app/place-actions.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { Place } from '../../data/index.ts';
import { useFavorites } from '../../favorites/index.ts';
import { copyText } from '../../feedback/index.ts';
import { Button, useToast } from '../ui/index.ts';

async function share(place: Place, toast: ReturnType<typeof useToast>) {
  const url = shareUrlFor(place.id);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: place.displayName, url });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  const ok = await copyText(url);
  toast.show(
    ok
      ? { message: 'Link to this place copied.', tone: 'success' }
      : { message: 'Could not copy the link. Copy it from the address bar instead.', tone: 'warning' },
  );
}

/** Directions, favourite, share, report and zoom actions for one place. */
export function PlaceActions({ place, mapAvailable }: { place: Place; mapAvailable: boolean }) {
  const { directory } = useAtlas();
  const toast = useToast();
  const reasonId = useId();
  const favorite = useFavorites((s) => s.ids.includes(place.id));
  const toggleFavorite = useFavorites((s) => s.toggle);
  const blocked = routeBlockReason(place, directory);
  const endpoint = placeEndpoint(place);

  const routeWith = (role: 'origin' | 'destination') => {
    if (!endpoint || blocked) return;
    const s = useAppStore.getState();
    if (role === 'destination') s.setDestination(endpoint);
    else s.setOrigin(endpoint);
    s.openPanel('directions');
  };

  const onFavorite = () => {
    const now = toggleFavorite(place.id);
    const full = !now && !favorite;
    toast.show({
      message: full
        ? 'Saved places are full. Remove one to add another.'
        : now
          ? 'Added to saved places on this device.'
          : 'Removed from saved places.',
      tone: full ? 'warning' : 'neutral',
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1.4fr_1fr] gap-2 whitespace-nowrap">
        <Button
          variant="primary"
          icon="route"
          disabled={blocked !== null}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => routeWith('destination')}
        >
          Directions to here
        </Button>
        <Button
          variant="secondary"
          icon="navigation"
          disabled={blocked !== null}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => routeWith('origin')}
        >
          From here
        </Button>
      </div>
      {blocked ? (
        <p id={reasonId} className="text-sm text-muted">
          Directions unavailable: {blocked}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={favorite ? 'heart-filled' : 'heart'}
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          {favorite ? 'Saved' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" icon="share" onClick={() => void share(place, toast)}>
          Share
        </Button>
        {mapAvailable && place.location ? (
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onClick={() => useAppStore.getState().requestFocus({ kind: 'place', placeId: place.id })}
          >
            Zoom to
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon="flag"
          onClick={() =>
            useAppStore.getState().openReport({ placeId: place.id, placeName: place.displayName })
          }
        >
          Report a correction
        </Button>
      </div>
    </div>
  );
}
