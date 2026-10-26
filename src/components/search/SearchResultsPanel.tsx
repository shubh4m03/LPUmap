import { useMemo } from 'react';
import { selectDirectoryItem } from '../../app/artwork-selection.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { highlightSegments } from '../../search/index.ts';
import { Button, EmptyState, ResultRow, type IconName, type TitleSegment } from '../ui/index.ts';
import { placeItem } from './palette-model.ts';

const LIMIT = 50;

interface ResultItem {
  key: string;
  title: string;
  segments: TitleSegment[];
  subtitle?: string;
  icon: IconName;
  iconColor?: string;
  select(): void;
}

/**
 * Place results for the last palette query, kept open beside the map, plus
 * items of the campus illustration that are not linked to a verified building.
 */
export function SearchResultsPanel() {
  const { searchIndex, getPlace, buildingDirectory } = useAtlas();
  const query = useAppStore((s) => s.resultsQuery);
  const selectPlace = useAppStore((s) => s.selectPlace);
  const listMode = useAppStore((s) => s.listMode);
  const openPalette = useAppStore((s) => s.openPalette);
  const items = useMemo(
    () =>
      searchIndex
        .search(query, { limit: LIMIT, kinds: ['place', 'artwork'] })
        .flatMap((hit): ResultItem[] => {
          const segments = highlightSegments(hit.doc.title, hit.highlights);
          if (hit.doc.kind === 'artwork') {
            const row = buildingDirectory.item(hit.doc.ref);
            if (!row) return [];
            return [
              {
                key: hit.doc.id,
                title: hit.doc.title,
                segments,
                subtitle: hit.doc.subtitle ?? 'Campus illustration',
                icon: 'overview',
                select: () => selectDirectoryItem(row),
              },
            ];
          }
          const place = getPlace(hit.doc.ref);
          if (!place) return [];
          const p = placeItem(place, hit.doc.id, hit.doc.qualifier);
          return [
            {
              key: p.key,
              title: hit.doc.title,
              segments,
              ...(p.subtitle ? { subtitle: p.subtitle } : {}),
              icon: p.icon,
              ...(p.iconColor ? { iconColor: p.iconColor } : {}),
              select: () => selectPlace(place.id, { focus: place.location !== null && !listMode }),
            },
          ];
        }),
    [searchIndex, getPlace, buildingDirectory, query, selectPlace, listMode],
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
                onSelect={item.select}
                className="px-4"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
