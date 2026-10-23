import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { Place } from '../../data/index.ts';
import { safeExternalUrl } from '../../utils/safe-url.ts';
import { ExternalLink } from '../place/index.ts';
import { PanelSection } from '../settings/PanelSection.tsx';
import { Badge, Button, Icon } from '../ui/index.ts';
import { groupOrganizations } from './directory-model.ts';

const OPEN_GROUP_MAX = 5;

/** The curated directory of official LPU units, from the dataset (never invented). */
export function AcademicDirectory() {
  const { data } = useAtlas();
  const groups = groupOrganizations(data.places);
  const total = groups.reduce((n, g) => n + g.places.length, 0);
  const located = groups.reduce((n, g) => n + g.places.filter((p) => p.location !== null).length, 0);

  return (
    <PanelSection
      title="Academic directory"
      icon="school"
      description={
        total === 0
          ? undefined
          : `${total} schools, departments and services named on LPU’s official website (also searchable). ${located} of ${total} are placed on the map: no official campus map was found to place the rest.`
      }
    >
      {total === 0 ? (
        <p className="text-sm text-muted">No official directory records are in this dataset.</p>
      ) : (
        groups.map((g) => (
          // Large groups start collapsed so the sections below stay reachable.
          <details key={g.categoryId} open={g.places.length <= OPEN_GROUP_MAX} className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus">
              <Icon
                name="chevron-right"
                size={16}
                className="text-muted transition-transform duration-fast group-open:rotate-90 motion-reduce:transition-none"
              />
              {g.label} ({g.places.length})
            </summary>
            <ul className="flex flex-col divide-y divide-border pl-6">
              {g.places.map((p) => (
                <OrgRow key={p.id} place={p} />
              ))}
            </ul>
          </details>
        ))
      )}
    </PanelSection>
  );
}

function OrgRow({ place }: { place: Place }) {
  const listMode = useAppStore((s) => s.listMode);
  const website = safeExternalUrl(place.contact?.website);
  const located = place.location !== null;
  return (
    <li className="flex flex-col gap-1 py-2 text-sm">
      <span className="font-medium">{place.displayName}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {located ? (
          <Button
            size="sm"
            variant="ghost"
            icon="pin"
            className="-ml-3"
            onClick={() => useAppStore.getState().selectPlace(place.id, { focus: !listMode })}
          >
            Show on map
          </Button>
        ) : (
          <Badge tone="neutral" icon="pin">
            No verified map position
          </Badge>
        )}
        {website ? <ExternalLink href={website}>Official page</ExternalLink> : null}
      </div>
    </li>
  );
}
