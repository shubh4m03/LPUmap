import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { EmptyState } from '../ui/index.ts';
import { PlaceActions } from './PlaceActions.tsx';
import { PlaceFacts } from './PlaceFacts.tsx';
import { PlaceHours } from './PlaceHours.tsx';
import { PlaceProvenance } from './PlaceProvenance.tsx';
import { PlaceRelated } from './PlaceRelated.tsx';
import { PlaceSummary } from './PlaceSummary.tsx';

const HOURS_KINDS = new Set(['facility', 'organization', 'landmark']);

/**
 * Details for one place; used for search results, map selections, favourites
 * and route destinations. Everything shown comes from the dataset record.
 */
export function PlaceDetails({ placeId }: { placeId: string }) {
  const { getPlace } = useAtlas();
  const listMode = useAppStore((s) => s.listMode);
  const place = getPlace(placeId);
  if (!place) {
    return (
      <EmptyState
        icon="warning"
        title="This place is not in the current dataset"
        description="It may have been removed or renamed in the source data."
      />
    );
  }
  const showHours = place.openingHours !== undefined || HOURS_KINDS.has(place.kind);

  return (
    <article className="flex flex-col gap-4 p-4" aria-label={place.displayName}>
      <PlaceSummary place={place} />
      <PlaceActions place={place} mapAvailable={!listMode} />
      {showHours ? <PlaceHours place={place} /> : null}
      <PlaceFacts place={place} />
      <PlaceRelated key={place.id} placeId={place.id} />
      <PlaceProvenance place={place} />
    </article>
  );
}
