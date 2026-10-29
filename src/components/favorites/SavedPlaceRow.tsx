import { useAtlas } from '../../app/data/atlas-context.ts';
import { placeEndpoint, routeBlockReason } from '../../app/place-actions.ts';
import { useAppStore } from '../../app/store/index.ts';
import { getCategory } from '../../config/index.ts';
import type { Place } from '../../data/index.ts';
import { IconButton, ResultRow, iconForCategory } from '../ui/index.ts';
import { placeSubtitle } from './saved-format.ts';

/**
 * A saved or recent place: the row opens the place; a directions shortcut is
 * offered only when the place can actually be routed to.
 */
export function SavedPlaceRow({ place, onRemove }: { place: Place; onRemove?: () => void }) {
  const { directory } = useAtlas();
  const listMode = useAppStore((s) => s.listMode);
  const category = getCategory(place.categoryId);
  const endpoint = routeBlockReason(place, directory) === null ? placeEndpoint(place) : null;

  const open = () =>
    useAppStore.getState().selectPlace(place.id, { focus: place.location !== null && !listMode });

  const directions = () => {
    if (!endpoint) return;
    const s = useAppStore.getState();
    s.setDestination(endpoint);
    s.openPanel('directions');
  };

  return (
    <li className="flex items-center gap-1 pr-2">
      <ResultRow
        title={place.displayName}
        subtitle={placeSubtitle(place)}
        icon={iconForCategory(category.icon)}
        iconColor={category.color}
        onSelect={open}
        className="min-w-0 flex-1 rounded-md pl-4"
      />
      {endpoint ? (
        <IconButton
          icon="route"
          label={`Directions to ${place.displayName}`}
          size="sm"
          onClick={directions}
        />
      ) : null}
      {onRemove ? (
        <IconButton
          icon="close"
          label={`Remove ${place.displayName} from saved places`}
          size="sm"
          onClick={onRemove}
        />
      ) : null}
    </li>
  );
}
