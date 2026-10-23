/**
 * Saved places (favourites) and, when search history is on, recent places.
 * Both lists live only in this browser. Ids that no longer resolve against
 * the loaded dataset are reported honestly with a remove action instead of
 * being silently hidden.
 */
import type { JSX } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { resolveIds, useFavorites, useRecents } from '../../favorites/index.ts';
import { usePrivacySettings } from '../../privacy/index.ts';
import { PanelSection } from '../settings/PanelSection.tsx';
import { Button, EmptyState, useToast } from '../ui/index.ts';
import { SavedPlaceRow } from './SavedPlaceRow.tsx';

export function FavoritesPanel(): JSX.Element {
  const { getPlace } = useAtlas();
  const ids = useFavorites((s) => s.ids);
  const toggle = useFavorites((s) => s.toggle);
  const toast = useToast();
  const places = resolveIds(ids, getPlace);
  const staleIds = ids.filter((id) => getPlace(id) === undefined);

  const removeStale = () => {
    for (const id of staleIds) toggle(id);
    toast.show({
      message: `Removed ${staleIds.length} saved ${staleIds.length === 1 ? 'place' : 'places'} that no longer exist in the dataset.`,
    });
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <PanelSection title="Saved on this device" icon="heart" className="px-4">
        {staleIds.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3">
            <p className="text-sm">
              {staleIds.length === 1
                ? '1 saved place is no longer in the dataset.'
                : `${staleIds.length} saved places are no longer in the dataset.`}{' '}
              <span className="text-muted">It may have been removed or renamed upstream.</span>
            </p>
            <Button size="sm" variant="secondary" icon="trash" className="self-start" onClick={removeStale}>
              Remove {staleIds.length === 1 ? 'it' : 'them'}
            </Button>
          </div>
        ) : null}
        {places.length === 0 ? (
          <EmptyState
            icon="heart"
            title="No saved places yet"
            description="Open a place and choose Save. Saved places stay in this browser only."
            className="py-4"
          />
        ) : (
          <ul aria-label="Saved places" className="-mx-4">
            {places.map((p) => (
              <SavedPlaceRow
                key={p.id}
                place={p}
                onRemove={() => {
                  toggle(p.id);
                  toast.show({ message: `Removed ${p.displayName} from saved places.` });
                }}
              />
            ))}
          </ul>
        )}
      </PanelSection>
      <RecentPlaces />
    </div>
  );
}

function RecentPlaces() {
  const { getPlace } = useAtlas();
  const saveHistory = usePrivacySettings((s) => s.saveHistory);
  const recentIds = useRecents((s) => s.ids);
  const clearRecents = useRecents((s) => s.clear);
  const openPanel = useAppStore((s) => s.openPanel);
  const recents = resolveIds(recentIds, getPlace);

  if (!saveHistory) {
    return (
      <PanelSection title="Recent places" icon="history" className="border-t border-border px-4 pt-4">
        <p className="text-sm text-muted">Search history is off, so opened places are not remembered.</p>
        <Button
          size="sm"
          variant="ghost"
          icon="settings"
          className="self-start"
          onClick={() => openPanel('settings')}
        >
          Settings & privacy
        </Button>
      </PanelSection>
    );
  }
  return (
    <PanelSection title="Recent places" icon="history" className="border-t border-border px-4 pt-4">
      {recents.length === 0 ? (
        <p className="text-sm text-muted">
          Places you open will appear here. They are kept in this browser only.
        </p>
      ) : (
        <>
          <ul aria-label="Recent places" className="-mx-4">
            {recents.map((p) => (
              <SavedPlaceRow key={p.id} place={p} />
            ))}
          </ul>
          <Button size="sm" variant="ghost" icon="trash" className="self-start" onClick={clearRecents}>
            Clear recent places
          </Button>
        </>
      )}
    </PanelSection>
  );
}
