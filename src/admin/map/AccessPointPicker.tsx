/**
 * Access-point choice for a place: one of the VALIDATED candidate nodes
 * (existing walkable graph nodes within the server's distance limit), keep
 * the stored one, or none (the place is then not routable). Nothing is
 * preselected and nothing is inferred: the owner must choose, and the server
 * validates the choice again.
 */
import { useId } from 'react';
import { Button } from '../../components/ui/index.ts';
import { TextInput } from '../../components/ui/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import type { LngLat } from '../../data/index.ts';
import type { AccessCandidate } from './access-points.ts';
import { formatMetres } from '../ui/format.ts';
import type { AccessChoice } from './access-choice.ts';
import { ACCESS_PICK_RADIUS_M, nearClickSummary } from './access-pick.ts';
import type { AccessMapPick } from './useAccessMapPick.ts';

export interface AccessPointPickerProps {
  location: LngLat | null;
  /** Candidates for `location` (null while the dataset is loading or unavailable). */
  candidates: readonly AccessCandidate[] | null;
  /** Why candidates are missing (dataset loading / failed). */
  candidatesNote?: string | null;
  value: AccessChoice;
  onChange(choice: AccessChoice): void;
  /** The stored access node, offered as "keep" (with the server's verdict at the current position). */
  current?: { nodeId: number; problem: string | null } | null;
  disabled?: boolean;
  error?: string | null;
  /** Wording of the "none" option (overrides: fall back to the base place's routing). */
  noneLabel?: string;
  noneDetail?: string;
  /** "Choose on the map" (the editor's map reports clicks to it while active). */
  mapPick?: AccessMapPick;
}

export const NOTE_MAX = 300;

export function AccessPointPicker({
  location,
  candidates,
  candidatesNote,
  value,
  onChange,
  current,
  disabled,
  error,
  noneLabel,
  noneDetail = 'The place will not be routable until one is chosen.',
  mapPick,
}: AccessPointPickerProps) {
  const name = useId();
  const max = APP_CONFIG.routing.maxPlaceConnectorM;
  const radio = (key: string, checked: boolean, label: string, detail: string | null, select: () => void) => {
    const id = `${name}-${key}`;
    return (
      <li key={key} className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
        <input
          id={id}
          type="radio"
          name={name}
          checked={checked}
          onChange={select}
          aria-describedby={detail ? `${id}-detail` : undefined}
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-accent"
        />
        <span className="flex min-w-0 flex-col">
          <label htmlFor={id} className="cursor-pointer text-sm font-medium text-text">
            {label}
          </label>
          {detail ? (
            <span id={`${id}-detail`} className="text-sm text-muted">
              {detail}
            </span>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} aria-describedby={`${name}-help`}>
      <legend className="mb-1 text-sm font-semibold text-text">Access point (routing)</legend>
      <p id={`${name}-help`} className="text-sm text-muted">
        Choose the path node where people actually enter this place. Only existing walkable nodes within {max}{' '}
        m are offered; the server checks the choice again. Without an access point the place is shown but
        cannot be routed to.
      </p>
      {!location ? (
        <p className="text-sm text-muted">Place the point first to see the nearby path nodes.</p>
      ) : candidates === null ? (
        <p role="status" className="text-sm text-muted">
          {candidatesNote ?? 'Loading nearby path nodes…'}
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-text">
          No walkable path node is within {max} m of this position, so no access point can be chosen here.
        </p>
      ) : null}
      {mapPick && location && candidates && candidates.length > 0 ? (
        <MapPickControls
          pick={mapPick}
          onChoose={(nodeId) => {
            onChange({ kind: 'node', nodeId, note: value.kind === 'node' ? value.note : '' });
            mapPick.cancel();
          }}
        />
      ) : null}
      <ul className="flex flex-col">
        {current
          ? radio(
              'keep',
              value.kind === 'keep',
              `Keep the current access point (path node ${current.nodeId})`,
              current.problem
                ? `Not valid at this position: ${current.problem}`
                : 'Still valid at this position.',
              () => onChange({ kind: 'keep' }),
            )
          : null}
        {(candidates ?? []).map((c, i) =>
          radio(
            `n${c.nodeId}`,
            value.kind === 'node' && value.nodeId === c.nodeId,
            `Path node ${c.nodeId}${i === 0 ? ' (nearest)' : ''}`,
            `${formatMetres(c.distanceM)} from the place`,
            () => onChange({ kind: 'node', nodeId: c.nodeId, note: value.kind === 'node' ? value.note : '' }),
          ),
        )}
        {radio(
          'none',
          value.kind === 'none',
          noneLabel ?? (current ? 'Remove the access point' : 'No access point'),
          noneDetail,
          () => onChange({ kind: 'none' }),
        )}
      </ul>
      {value.kind === 'node' ? (
        <TextInput
          label="Access note (optional, admin only)"
          hint="For example “Entrance on the north side”. Not published."
          maxLength={NOTE_MAX}
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function MapPickControls({ pick, onChoose }: { pick: AccessMapPick; onChoose(nodeId: number): void }) {
  if (!pick.active)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="locate" onClick={pick.start} data-testid="access-pick-start">
          Choose on the map
        </Button>
        <span className="text-sm text-muted">Click near the place to list the valid path nodes there.</span>
      </div>
    );
  return (
    <div
      role="group"
      aria-label="Choose the access point on the map"
      data-testid="access-pick"
      className="flex flex-col gap-2 rounded-md border border-accent bg-accent-soft/40 p-2.5"
    >
      <p role="status" className="text-sm text-text">
        {pick.nearby === null
          ? `Click or tap on the map near the place. The highlighted path nodes are the valid ones; a click lists those within ${ACCESS_PICK_RADIUS_M} m of it, and nothing is chosen until you pick one.`
          : nearClickSummary(pick.nearby.length)}
      </p>
      {pick.nearby && pick.nearby.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Path nodes near the click">
          {pick.nearby.map((c) => (
            <li key={c.nodeId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button size="sm" variant="primary" onClick={() => onChoose(c.nodeId)}>
                Use path node {c.nodeId}
              </Button>
              <span className="text-sm text-muted">
                {formatMetres(c.distanceM)} from the place · {formatMetres(c.fromClickM)} from the click
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="w-fit"
        onClick={pick.cancel}
        data-testid="access-pick-cancel"
      >
        Stop choosing on the map
      </Button>
    </div>
  );
}
