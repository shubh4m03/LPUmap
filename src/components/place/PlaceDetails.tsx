import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { EmptyState } from '../ui/index.ts';
import { ArtworkDetails } from './ArtworkDetails.tsx';
import { PlaceActions } from './PlaceActions.tsx';
import { PlaceArtwork, PlaceIdentity } from './PlaceArtwork.tsx';
import { PlaceFacts } from './PlaceFacts.tsx';
import { PlaceHours } from './PlaceHours.tsx';
import { PlaceProvenance } from './PlaceProvenance.tsx';
import { PlaceRelated } from './PlaceRelated.tsx';
import { PlaceSummary } from './PlaceSummary.tsx';

const HOURS_KINDS = new Set(['facility', 'organization', 'landmark']);

/**
 * Details for one place; used for search results, map selections, favourites
 * and route destinations. Everything shown comes from the dataset record. An
 * item of the campus illustration that is not linked to a verified building
 * is selected by its `art:` id and shown by ArtworkDetails; a verified item
 * is part of its building's details (PlaceArtwork).
 */
export function PlaceDetails({ placeId }: { placeId: string }) {
  const { getPlace, buildingDirectory } = useAtlas();
  const listMode = useAppStore((s) => s.listMode);
  const place = getPlace(placeId);
  if (!place) {
    const art = buildingDirectory.artwork?.byId.get(placeId);
    if (art) return <ArtworkDetails entry={art} />;
    return (
      <EmptyState
        icon="warning"
        title="This place is not in the current dataset"
        description="It may have been removed or renamed in the source data."
      />
    );
  }
  const showHours = place.openingHours !== undefined || HOURS_KINDS.has(place.kind);
  const entry = buildingDirectory.byId.get(place.id);

  return (
    <article className="flex flex-col gap-4 p-4" aria-label={place.displayName}>
      <PlaceSummary place={place} />
      <PlaceActions place={place} mapAvailable={!listMode} />
      {showHours ? <PlaceHours place={place} /> : null}
      <PlaceFacts place={place} />
      <PlaceRelated key={place.id} placeId={place.id} />
      {entry ? <PlaceArtwork entry={entry} /> : null}
      {place.kind === 'building' ? <PlaceIdentity place={place} entry={entry} /> : null}
      <PlaceProvenance place={place} />
    </article>
  );
}
