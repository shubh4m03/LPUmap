import { useAtlas } from '../../app/data/atlas-context.ts';
import { useNow } from '../../app/hooks/useNow.ts';
import { useAppStore } from '../../app/store/index.ts';
import { getCategory } from '../../config/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { Place } from '../../data/index.ts';
import { formatDistance, haversineM } from '../../distance/index.ts';
import { Badge, Icon, iconForCategory } from '../ui/index.ts';
import { isUnnamed, KIND_LABELS, unnamedNote, ZONE_LABELS } from './place-format.ts';

/** Name, category, kind, zone, honest notes for unnamed / unlocated places, distance. */
export function PlaceSummary({ place }: { place: Place }) {
  const { sourceName } = useAtlas();
  const lastSample = useAppStore((s) => s.lastSample);
  const category = getCategory(place.categoryId);
  const distanceM = lastSample && place.location ? haversineM(lastSample.lngLat, place.location) : null;
  const now = useNow(10_000, distanceM !== null);
  const stale = lastSample !== null && now - lastSample.timestamp > APP_CONFIG.geolocation.staleAfterMs;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken"
          style={{ color: category.color }}
        >
          <Icon name={iconForCategory(category.icon)} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 data-panel-focus className="text-lg leading-tight font-semibold break-words">
            {place.displayName}
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="accent" icon={iconForCategory(category.icon)}>
              {category.label}
            </Badge>
            <Badge>{KIND_LABELS[place.kind]}</Badge>
            <Badge tone={place.campusZone === 'on-campus' ? 'neutral' : 'info'}>
              {ZONE_LABELS[place.campusZone]}
            </Badge>
          </div>
        </div>
      </div>

      {place.aliases.length > 0 ? (
        <p className="text-sm text-muted">Also known as: {place.aliases.join(', ')}</p>
      ) : null}

      {isUnnamed(place) ? (
        <p className="rounded-md bg-surface-sunken p-3 text-sm text-muted">{unnamedNote(place)}</p>
      ) : null}

      {place.location === null ? (
        <p className="flex gap-2 rounded-md bg-warning-soft p-3 text-sm text-text">
          <Icon name="warning" className="mt-0.5 text-warning" />
          <span>
            <strong className="font-semibold">No verified map position.</strong> Listed by{' '}
            {sourceName(place.provenance.sourceId)}, but where it is on campus has not been verified, so it is
            not drawn on the map and cannot be routed to.
          </span>
        </p>
      ) : null}

      {place.description ? <p className="text-sm text-text">{place.description}</p> : null}

      {distanceM !== null ? (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Icon name="locate" size={16} />
          {formatDistance(distanceM)} straight-line from your {stale ? 'last known ' : ''}location (not a
          walking distance)
        </p>
      ) : null}
    </div>
  );
}
