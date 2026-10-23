import { useMemo, useState } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useNow } from '../../app/hooks/useNow.ts';
import { useAppStore } from '../../app/store/index.ts';
import { getCategory } from '../../config/categories.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { Button, EmptyState, ResultRow, iconForCategory } from '../ui/index.ts';
import { categoryRows } from './category-list.ts';

const PAGE = 60;

/** Places of one category, nearest first when an origin is known. */
export function CategoryPanel() {
  const { directory, router, getPlace } = useAtlas();
  const categoryId = useAppStore((s) => s.categoryId);
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  const lastSample = useAppStore((s) => s.lastSample);
  const listMode = useAppStore((s) => s.listMode);
  const selectPlace = useAppStore((s) => s.selectPlace);
  const openReport = useAppStore((s) => s.openReport);
  const [limit, setLimit] = useState(PAGE);

  const now = useNow(10_000, lastSample !== null);
  const fresh = lastSample !== null && now - lastSample.timestamp < APP_CONFIG.geolocation.staleAfterMs;
  const selectedLocation = selectedPlaceId ? (getPlace(selectedPlaceId)?.location ?? null) : null;
  const origin = fresh ? lastSample.lngLat : selectedLocation;
  const originLabel = fresh ? 'your location' : selectedLocation ? 'the selected place' : null;

  const rows = useMemo(
    () => (categoryId ? categoryRows({ categoryId, directory, router, origin }) : []),
    [categoryId, directory, router, origin],
  );
  if (!categoryId) return null;
  const category = getCategory(categoryId);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={iconForCategory(category.icon)}
        title={`No ${category.noun} are mapped yet`}
        description={`OpenStreetMap has no ${category.label.toLowerCase()} recorded on or near campus yet, so none are shown — we never guess locations. If you know one, please report it.`}
        action={
          <Button
            variant="secondary"
            icon="flag"
            onClick={() => openReport({ kind: 'missing-facility', placeName: category.label })}
          >
            Report a missing {category.label.toLowerCase()}
          </Button>
        }
      />
    );
  }

  const unlocated = rows.filter((r) => r.place.location === null).length;
  return (
    <div className="flex flex-col py-2">
      <p className="px-4 pb-2 text-sm text-muted">
        {rows.length} {rows.length === 1 ? 'place' : 'places'}
        {originLabel
          ? ` · nearest to ${originLabel} first (walking distance where a mapped path exists, otherwise straight-line)`
          : ' · turn on your location or select a place to sort by distance'}
        {unlocated > 0 ? ` · ${unlocated} without a verified map position` : ''}
      </p>
      <ul>
        {rows.slice(0, limit).map(({ place, distanceText }) => (
          <li key={place.id}>
            <ResultRow
              title={place.displayName}
              subtitle={
                place.location === null
                  ? 'No verified map position'
                  : place.campusZone === 'off-campus-nearby'
                    ? 'Off campus (nearby)'
                    : 'On campus'
              }
              meta={distanceText ?? undefined}
              icon={iconForCategory(category.icon)}
              iconColor={category.color}
              onSelect={() => selectPlace(place.id, { focus: place.location !== null && !listMode })}
              className="px-4"
            />
          </li>
        ))}
      </ul>
      {rows.length > limit ? (
        <Button variant="ghost" className="mx-4 mt-2" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({rows.length - limit} left)
        </Button>
      ) : null}
    </div>
  );
}
