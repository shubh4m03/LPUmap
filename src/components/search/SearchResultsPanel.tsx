import { useMemo } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { highlightSegments } from '../../search/index.ts';
import { Button, EmptyState, ResultRow } from '../ui/index.ts';
import { placeItem } from './palette-model.ts';

const LIMIT = 50;

/** Place results for the last palette query, kept open beside the map. */
export function SearchResultsPanel() {
  const { searchIndex, getPlace } = useAtlas();
  const query = useAppStore((s) => s.resultsQuery);
  const selectPlace = useAppStore((s) => s.selectPlace);
  const listMode = useAppStore((s) => s.listMode);
  const openPalette = useAppStore((s) => s.openPalette);
  const items = useMemo(
    () =>
      searchIndex.search(query, { limit: LIMIT, kinds: ['place'] }).flatMap((hit) => {
        const place = getPlace(hit.doc.ref);
        if (!place) return [];
        const segments = highlightSegments(hit.doc.title, hit.highlights);
        return [
          { ...placeItem(place, hit.doc.id, hit.doc.qualifier), title: hit.doc.title, segments, place },
        ];
      }),
    [searchIndex, getPlace, query],
  );

  return (
    <div className="flex flex-col py-2">
      <div className="flex items-center justify-between gap-2 px-4 pb-2">
        <p className="text-sm text-muted" aria-live="polite">
          {items.length} place{items.length === 1 ? '' : 's'} for “{query}”
        </p>
        <Button size="sm" variant="ghost" icon="search" onClick={() => openPalette(query)}>
          Edit search
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon="search"
          title={`No mapped place matches “${query}”.`}
          description="Most campus buildings are not yet named in OpenStreetMap."
        />
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <ResultRow
                title={item.title}
                segments={item.segments}
                subtitle={item.subtitle}
                icon={item.icon}
                {...(item.iconColor ? { iconColor: item.iconColor } : {})}
                onSelect={() =>
                  selectPlace(item.place.id, { focus: item.place.location !== null && !listMode })
                }
                className="px-4"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
