/**
 * Owner and community locations: /admin/locations (list + map, filters in
 * the query), /admin/locations/new and /admin/locations/<id> (editor).
 * Hidden locations are listed under the "Hidden" filter.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../../components/ui/cx.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx';
import { Spinner } from '../../components/ui/Spinner.tsx';
import { SearchInput } from '../../components/ui/TextInput.tsx';
import type { LocationRecord } from '../api/schemas.ts';
import { useAdminApi } from '../context.ts';
import { useAdminCampusData } from '../data/campus-data.ts';
import { useResource } from '../hooks/useResource.ts';
import { MapPanel } from '../map/MapPanel.tsx';
import { usePointEditing } from '../map/usePointEditing.ts';
import { adminHref } from '../routes.ts';
import { ErrorNotice } from '../ui/ErrorNotice.tsx';
import { categoryLabel } from '../ui/format.ts';
import { onInAppClick } from '../ui/links.ts';
import { SplitLayout } from '../ui/SplitLayout.tsx';
import { LocationEditor } from './locations/LocationEditor.tsx';
import {
  filterLocations,
  locationFiltersQuery,
  locationNear,
  NEW_LOCATION_ID,
  parseLocationFilters,
  type LocationFilters,
} from './locations/locations-model.ts';
import type { AdminSectionProps } from './types.ts';

export default function LocationsSection({ route, navigate }: AdminSectionProps) {
  const api = useAdminApi();
  const campus = useAdminCampusData();
  const list = useResource('locations', (signal) => api.community.listLocations({}, { signal }));
  const filters = parseLocationFilters(route.query);
  const [lastListQuery, setLastListQuery] = useState(route.query);
  if (!route.id && lastListQuery !== route.query) setLastListQuery(route.query);
  const items = useMemo(() => list.state.data?.items ?? [], [list.state.data]);
  const backToList = () => navigate({ section: 'locations', query: lastListQuery });
  const backHref = adminHref({ section: 'locations', query: lastListQuery });

  const replaceRecord = (rec: LocationRecord | null, removedId?: string) =>
    list.setData((d) => {
      const cur = d?.items ?? [];
      if (!rec) return { items: cur.filter((i) => i.id !== removedId) };
      return {
        items: cur.some((i) => i.id === rec.id) ? cur.map((i) => (i.id === rec.id ? rec : i)) : [...cur, rec],
      };
    });

  if (route.id) {
    if (route.id !== NEW_LOCATION_ID && !list.state.data) {
      return (
        <div className="flex flex-col gap-4 p-4">
          {list.state.status === 'error' ? (
            <ErrorNotice
              error={list.state.error}
              title="Could not load the locations"
              onReload={list.reload}
            />
          ) : (
            <Spinner label="Loading the location…" />
          )}
        </div>
      );
    }
    const record = route.id === NEW_LOCATION_ID ? null : (items.find((i) => i.id === route.id) ?? null);
    if (route.id !== NEW_LOCATION_ID && !record) {
      return (
        <div className="flex flex-col gap-4 p-4">
          <EmptyState
            icon="warning"
            title="This location does not exist"
            description="It may have been deleted. The history still lists what happened to it."
            action={<Button onClick={backToList}>All locations</Button>}
          />
        </div>
      );
    }
    return (
      <LocationEditor
        key={record ? `${record.id}:${record.revision}` : NEW_LOCATION_ID}
        record={record}
        others={items}
        campus={campus}
        navigate={navigate}
        backHref={backHref}
        onBack={backToList}
        onSaved={replaceRecord}
        onReload={list.reload}
      />
    );
  }

  return (
    <LocationsList
      filters={filters}
      items={items}
      state={list.state.status}
      error={list.state.status === 'error' ? list.state.error : null}
      onReload={list.reload}
      campus={campus}
      onFilters={(f) => navigate({ section: 'locations', query: locationFiltersQuery(f) })}
      onOpen={(id) => navigate({ section: 'locations', id })}
    />
  );
}

function LocationsList({
  filters,
  items,
  state,
  error,
  onReload,
  campus,
  onFilters,
  onOpen,
}: {
  filters: LocationFilters;
  items: readonly LocationRecord[];
  state: 'loading' | 'ready' | 'error';
  error: Parameters<typeof ErrorNotice>[0]['error'] | null;
  onReload(): void;
  campus: ReturnType<typeof useAdminCampusData>;
  onFilters(f: LocationFilters): void;
  onOpen(id: string): void;
}) {
  const visible = useMemo(() => filterLocations(items, filters), [items, filters]);
  const [q, setQ] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setQ(filters.q);
  }
  const others = useMemo(() => visible.map((l) => ({ id: l.id, position: l.location })), [visible]);
  const { editing } = usePointEditing({
    point: null,
    editable: false,
    reticle: false,
    others,
    onPick: (p) => {
      const hit = locationNear(visible, p);
      if (hit) onOpen(hit.id);
    },
  });
  const hiddenCount = items.filter((i) => i.status === 'hidden').length;

  const panel = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text">Locations</h1>
          <p className="text-sm text-muted">
            Places you added and approved community suggestions. Select one on the list or the map to edit it.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => onOpen(NEW_LOCATION_ID)}>
          Add location
        </Button>
      </div>
      <SegmentedControl
        label="Visibility"
        value={filters.status}
        onChange={(status) => onFilters({ ...filters, status })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'active', label: 'Published' },
          { value: 'hidden', label: hiddenCount > 0 ? `Hidden (${hiddenCount})` : 'Hidden' },
        ]}
      />
      <SegmentedControl
        label="Origin"
        value={filters.origin}
        onChange={(origin) => onFilters({ ...filters, origin })}
        options={[
          { value: 'all', label: 'Any origin' },
          { value: 'owner', label: 'Owner' },
          { value: 'community', label: 'Community' },
        ]}
      />
      <form
        role="search"
        className="flex items-end gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onFilters({ ...filters, q: q.trim() });
        }}
      >
        <SearchInput
          className="flex-1"
          label="Search locations"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => {
            setQ('');
            onFilters({ ...filters, q: '' });
          }}
        />
        <Button type="submit">Search</Button>
      </form>
      {error ? <ErrorNotice error={error} title="Could not load the locations" onReload={onReload} /> : null}
      {state === 'loading' && items.length === 0 ? (
        <Spinner label="Loading locations…" />
      ) : visible.length === 0 && state !== 'error' ? (
        <EmptyState
          icon="pin"
          title={items.length === 0 ? 'No locations yet' : 'No locations match these filters'}
          description={
            items.length === 0
              ? 'Approved suggestions and places you add appear here.'
              : filters.status === 'hidden'
                ? 'Nothing is hidden.'
                : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {visible.length} of {items.length} {items.length === 1 ? 'location' : 'locations'}
          </p>
          <ul className="flex flex-col gap-2" aria-label="Locations">
            {visible.map((l) => (
              <li key={l.id}>
                <a
                  href={adminHref({ section: 'locations', id: l.id })}
                  onClick={onInAppClick(() => onOpen(l.id))}
                  className={cx(
                    'flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3 hover:bg-surface-hover',
                    FOCUS_RING,
                  )}
                >
                  <span className="font-semibold break-words text-text">{l.name}</span>
                  <span className="text-sm text-muted">{categoryLabel(l.categoryId)}</span>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={l.status === 'active' ? 'success' : 'neutral'}>
                      {l.status === 'active' ? 'Published' : 'Hidden'}
                    </Badge>
                    <Badge>{l.origin === 'owner' ? 'Owner' : 'Community'}</Badge>
                    {l.accessNodeId === null ? <Badge tone="warning">Not routable</Badge> : null}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );

  return (
    <SplitLayout
      panel={panel}
      map={
        <MapPanel campus={campus} editing={editing} label="Map of the listed locations" className="h-full" />
      }
    />
  );
}
