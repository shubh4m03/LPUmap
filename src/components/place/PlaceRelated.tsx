import { useMemo, useState } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { getCategory } from '../../config/index.ts';
import type { RelationType } from '../../data/index.ts';
import { formatDistance } from '../../distance/index.ts';
import { Button, ResultRow, iconForCategory } from '../ui/index.ts';
import { DetailSection } from './DetailSection.tsx';

const INITIAL = 5;

/** Wording when the relation points at this place (e.g. a building that contains it). */
const INCOMING_LABELS: Partial<Record<RelationType, string>> = {
  located_in: 'Contains',
  part_of: 'Includes',
  accessed_via: 'Entrance to',
};

/** Related places from the relations file, labelled by relation type. */
export function PlaceRelated({ placeId }: { placeId: string }) {
  const { directory } = useAtlas();
  const selectPlace = useAppStore((s) => s.selectPlace);
  const [expanded, setExpanded] = useState(false);
  const related = useMemo(() => directory.related(placeId), [directory, placeId]);
  if (related.length === 0) return null;
  const shown = expanded ? related : related.slice(0, INITIAL);

  return (
    <DetailSection title="Related places" icon="route">
      <ul className="-mx-3">
        {shown.map(({ relation, place, label, direction }) => {
          const category = getCategory(place.categoryId);
          const verb = (direction === 'incoming' ? INCOMING_LABELS[relation.type] : undefined) ?? label;
          const extras = [
            relation.distanceM !== undefined ? formatDistance(relation.distanceM) : null,
            relation.inferred ? 'inferred' : null,
          ].filter(Boolean);
          return (
            <li key={`${relation.id}-${direction}`}>
              <ResultRow
                title={place.displayName}
                subtitle={[verb, ...extras].join(' · ')}
                subtitleLines={2}
                icon={iconForCategory(category.icon)}
                iconColor={category.color}
                onSelect={() => selectPlace(place.id)}
              />
            </li>
          );
        })}
      </ul>
      {related.some((r) => r.relation.inferred) ? (
        <p className="mt-1 text-xs text-subtle">
          “Inferred” links come from map geometry (e.g. a point inside a footprint), not an on-site check.
        </p>
      ) : null}
      {related.length > INITIAL ? (
        <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Show fewer' : `Show all ${related.length}`}
        </Button>
      ) : null}
    </DetailSection>
  );
}
