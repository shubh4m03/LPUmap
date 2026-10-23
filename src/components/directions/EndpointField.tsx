import { useEffect, useId, useRef, useState } from 'react';
import { useMediaQuery } from '../../accessibility/index.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { placeEndpoint, routeBlockReason } from '../../app/place-actions.ts';
import { useAppStore, type PickTarget } from '../../app/store/index.ts';
import type { RouteEndpoint } from '../../routing/index.ts';
import { Button, Icon, IconButton } from '../ui/index.ts';
import { endpointRoleLabel, locationBlockReason } from './directions-model.ts';
import { EndpointSearch } from './EndpointSearch.tsx';
import { startMapPicking } from './picking-sheet.ts';

const isPlace = (e: RouteEndpoint | null, placeId: string) => e?.kind === 'place' && e.placeId === placeId;

/**
 * One route endpoint: its current value plus the four ways to set it. Once an
 * endpoint is set the editor folds away behind "Change", so on a phone the
 * route result stays within reach without scrolling.
 */
export function EndpointField({ role, locked }: { role: PickTarget; locked: boolean }) {
  const { getPlace, directory } = useAtlas();
  const endpoint = useAppStore((s) => (role === 'origin' ? s.origin : s.destination));
  const other = useAppStore((s) => (role === 'origin' ? s.destination : s.origin));
  const picking = useAppStore((s) => s.pickingOnMap === role);
  const awaiting = useAppStore((s) => s.awaitingLocationFor === role);
  const geoStatus = useAppStore((s) => s.geoStatus);
  const accuracyM = useAppStore((s) =>
    s.awaitingLocationFor === role ? s.lastSample?.accuracyM : undefined,
  );
  const listMode = useAppStore((s) => s.listMode);
  const selectedId = useAppStore((s) => s.selectedPlaceId);
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const ids = { loc: useId(), sel: useId(), heading: useId(), editor: useId() };
  // The endpoint the user chose to change; any new endpoint folds the editor again.
  const [editing, setEditing] = useState<RouteEndpoint | null | undefined>(undefined);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusWithin = useRef(false);

  const roleLabel = endpointRoleLabel(role);
  const heading = role === 'origin' ? 'Start' : 'Destination';
  const expanded = !locked && (!endpoint || editing === endpoint || picking || awaiting);
  const set = (e: RouteEndpoint | null) => {
    const s = useAppStore.getState();
    if (role === 'origin') s.setOrigin(e);
    else s.setDestination(e);
  };

  // When the editor folds after a choice, keep keyboard focus in this field.
  useEffect(() => {
    if (!focusWithin.current || expanded) return;
    const active = document.activeElement;
    if (!active || active === document.body) toggleRef.current?.focus();
  }, [endpoint, expanded]);

  const locBlocked = locationBlockReason(geoStatus);
  // The privacy note is shown once (under the start); a blocked reason under both.
  const showLocHint = locBlocked !== null || role === 'origin';
  const selected = selectedId ? getPlace(selectedId) : undefined;
  // Offer the selected place only when it is not already one of the two endpoints.
  const showSelected =
    selected !== undefined && !isPlace(endpoint, selected.id) && !isPlace(other, selected.id);
  const selBlocked = selected ? routeBlockReason(selected, directory) : null;
  const verb = coarsePointer ? 'Tap' : 'Click';

  return (
    <section
      aria-labelledby={ids.heading}
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
      onFocus={() => {
        focusWithin.current = true;
      }}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && !e.currentTarget.contains(next)) focusWithin.current = false;
      }}
    >
      <div className="flex min-h-8 items-center gap-2">
        <Icon name={role === 'origin' ? 'navigation' : 'pin'} size={18} className="shrink-0 text-muted" />
        <h3 id={ids.heading} className="text-sm font-semibold">
          {heading}
        </h3>
        <p className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
          {endpoint ? endpoint.label : <span className="text-muted">Not set</span>}
        </p>
        {endpoint && !locked && !picking && !awaiting ? (
          <Button
            ref={toggleRef}
            size="sm"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={expanded ? ids.editor : undefined}
            aria-label={expanded ? `Done changing the ${roleLabel}` : `Change the ${roleLabel}`}
            onClick={() => setEditing(expanded ? undefined : endpoint)}
          >
            {expanded ? 'Done' : 'Change'}
          </Button>
        ) : null}
        {endpoint && !locked ? (
          <IconButton icon="close" size="sm" label={`Remove the ${roleLabel}`} onClick={() => set(null)} />
        ) : null}
      </div>

      {picking ? (
        <div className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm">
          <span className="flex-1">
            {verb} the map or a place to set the {roleLabel}.
          </span>
          <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().setPickingOnMap(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {awaiting ? (
        <div role="status" className="flex items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm">
          <span className="flex-1">
            Waiting for an accurate location fix
            {accuracyM !== undefined ? ` (currently ±${Math.round(accuracyM)} m)` : ''}…
          </span>
          <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().cancelAwaitingLocation()}>
            Cancel
          </Button>
        </div>
      ) : null}

      {expanded ? (
        <div id={ids.editor} className="flex flex-col gap-2">
          <EndpointSearch roleLabel={roleLabel} onPick={set} autoFocus={editing !== undefined} />
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon="locate"
              disabled={locBlocked !== null || awaiting}
              aria-describedby={showLocHint ? ids.loc : undefined}
              onClick={() => useAppStore.getState().setEndpointToMyLocation(role)}
            >
              My location
            </Button>
            {listMode ? null : (
              <Button
                size="sm"
                variant="ghost"
                icon="pin"
                aria-pressed={picking}
                onClick={() => startMapPicking(role)}
              >
                Choose on map
              </Button>
            )}
            {showSelected && selected ? (
              <Button
                size="sm"
                variant="ghost"
                icon="building"
                disabled={selBlocked !== null}
                aria-describedby={selBlocked ? ids.sel : undefined}
                onClick={() => set(placeEndpoint(selected))}
                className="max-w-full"
              >
                <span className="truncate">Selected: {selected.displayName}</span>
              </Button>
            ) : null}
          </div>
          {showLocHint ? (
            <p id={ids.loc} className="text-xs text-muted">
              {locBlocked ??
                "My location uses your device's position at that moment. It stays on this device — never stored or sent."}
            </p>
          ) : null}
          {showSelected && selBlocked ? (
            <p id={ids.sel} className="text-xs text-muted">
              Selected place can't be used: {selBlocked}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
