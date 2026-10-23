import { useId } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { formatDistance, formatDuration } from '../../distance/index.ts';
import type { RouteOk } from '../../routing/index.ts';
import { Button, cx } from '../ui/index.ts';
import { paceFootnote } from './directions-model.ts';
import { Notice } from './Notice.tsx';

const summaryText = (r: RouteOk) => `${formatDistance(r.distanceM)} · ${formatDuration(r.durationS)}`;

/** Distance, time, route options and caveats of the planned route. */
export function RouteSummary({ locked }: { locked: boolean }) {
  const alternatives = useAppStore((s) => s.alternatives);
  const active = useAppStore((s) => s.activeAlternative);
  const listMode = useAppStore((s) => s.listMode);
  const route = alternatives[active];
  const groupName = useId();
  if (!route) return null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xl font-semibold" data-testid="route-summary">
          {summaryText(route)}
        </p>
        <p className="text-xs text-muted">{paceFootnote(route.profile)} Distances follow mapped paths.</p>
      </div>

      {alternatives.length > 1 ? (
        <fieldset className="flex flex-col gap-1" disabled={locked}>
          <legend className="mb-1 text-sm font-semibold">Route options</legend>
          {alternatives.map((alt, i) => (
            <label
              key={i}
              className={cx(
                'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm',
                i === active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover',
              )}
            >
              <input
                type="radio"
                name={groupName}
                checked={i === active}
                onChange={() => useAppStore.getState().setActiveAlternative(i)}
                className="size-4 accent-(--color-accent)"
              />
              <span className="flex-1">
                <span className="font-medium">{i === 0 ? 'Best match' : `Alternative ${i}`}</span>
                <span className="text-muted"> — {summaryText(alt)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {route.caveats.map((c) => (
        <Notice key={c.code} tone="warning" title="Note">
          {c.message}
        </Notice>
      ))}

      {listMode ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon="route"
            onClick={() =>
              useAppStore.getState().requestFocus({ kind: 'fit', coordinates: route.coordinates })
            }
          >
            Fit route
          </Button>
        </div>
      )}
    </div>
  );
}
