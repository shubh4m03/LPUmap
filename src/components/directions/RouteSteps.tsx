import { useId } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { formatDistance } from '../../distance/index.ts';
import type { RouteOk, RouteStepKind } from '../../routing/index.ts';
import { Icon, cx, type IconName } from '../ui/index.ts';

const STEP_ICON: Record<RouteStepKind, IconName> = {
  path: 'walk',
  road: 'route',
  steps: 'steps',
  connector: 'navigation',
  'push-bike': 'bike',
};

/** Zoom used when jumping to one step: close enough to see the junction. */
export const STEP_FOCUS_ZOOM = 18;

/** Turn-by-segment list; each step moves the map to where it begins. */
export function RouteSteps({ route }: { route: RouteOk }) {
  const titleId = useId();
  const focusStep = (index: number) => {
    const at = route.coordinates[route.steps[index]?.startIndex ?? -1];
    if (!at) return;
    const s = useAppStore.getState();
    s.requestFocus({ kind: 'point', lngLat: at, zoom: STEP_FOCUS_ZOOM });
    if (s.sheetSnap === 'full') s.setSheetSnap('half');
  };

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h3 id={titleId} className="text-sm font-semibold">
        Steps <span className="font-normal text-muted">({route.steps.length})</span>
      </h3>
      <ol className="flex flex-col rounded-lg border border-border">
        {route.steps.map((step, i) => (
          <li key={`${step.startIndex}-${i}`} className="border-b border-border last:border-b-0">
            <button
              type="button"
              onClick={() => focusStep(i)}
              className={cx(
                'flex min-h-11 w-full items-start gap-3 px-3 py-2 text-left hover:bg-surface-hover',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
              )}
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-muted">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                {step.instruction}
                <span className="sr-only">. Show on map.</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                <Icon name={STEP_ICON[step.kind]} size={14} />
                {formatDistance(step.distanceM)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
