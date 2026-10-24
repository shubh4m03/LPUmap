/**
 * Directions panel. The route slice (src/app/store/route-slice.ts) is the
 * single source of truth: this panel edits the request, useRouteSolver
 * (mounted in AppShell) solves it synchronously, and the map overlay and the
 * navigation HUD read the same state. A failed request has already cleared
 * the old route by the time its error is shown.
 */
import { useEffect } from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { useAppStore } from '../../app/store/index.ts';
import { sameRoute } from '../../app/store/route-slice.ts';
import { formatDistance, formatDuration } from '../../distance/index.ts';
import { Button } from '../ui/index.ts';
import { failureAdvice, pickFallbackRoles } from './directions-model.ts';
import { EndpointField } from './EndpointField.tsx';
import { NavigationStart, TrackWalkButton } from './NavigationStart.tsx';
import { Notice } from './Notice.tsx';
import { startMapPicking, usePickingSheetRestore } from './picking-sheet.ts';
import { ProfilePicker } from './ProfilePicker.tsx';
import { RouteSteps } from './RouteSteps.tsx';
import { RouteSummary } from './RouteSummary.tsx';

export function DirectionsPanel() {
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);
  const profile = useAppStore((s) => s.profile);
  const result = useAppStore((s) => s.result);
  const route = useAppStore((s) => s.alternatives[s.activeAlternative] ?? null);
  const locked = useAppStore((s) => s.navigationActive);
  const listMode = useAppStore((s) => s.listMode);
  const advice = result ? failureAdvice(result, profile, origin, destination) : null;
  useResultAnnouncements();
  usePickingSheetRestore();

  return (
    <div className="flex flex-col gap-3 p-4">
      <EndpointField role="origin" locked={locked} />
      {locked ? null : (
        <Button
          size="sm"
          variant="ghost"
          icon="swap"
          className="self-center"
          disabled={!origin && !destination}
          onClick={() => useAppStore.getState().swap()}
        >
          Swap start and destination
        </Button>
      )}
      <EndpointField role="destination" locked={locked} />
      <ProfilePicker locked={locked} />

      {!origin || !destination ? (
        <p className="text-sm text-muted">
          Set a start and a destination to plan a route. Routes follow mapped paths only; nothing is guessed.
        </p>
      ) : result && !result.ok ? (
        <Notice
          tone="danger"
          role="alert"
          title="No route found"
          actions={
            listMode || locked || pickFallbackRoles(result).length === 0
              ? null
              : pickFallbackRoles(result).map((role) => (
                  <Button
                    key={role}
                    size="sm"
                    variant="secondary"
                    icon="pin"
                    onClick={() => startMapPicking(role)}
                  >
                    {role === 'origin' ? 'Choose start on map' : 'Choose destination on map'}
                  </Button>
                ))
          }
        >
          <p>{result.message}</p>
          {advice ? <p className="mt-1">{advice}</p> : null}
        </Notice>
      ) : route ? (
        <>
          <RouteSummary locked={locked} />
          <NavigationStart />
        </>
      ) : null}
      {(origin || destination) && !locked ? (
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          className="self-start"
          onClick={() => useAppStore.getState().clearRoute()}
        >
          Clear route
        </Button>
      ) : null}
      {route && !(result && !result.ok) && origin && destination ? <RouteSteps route={route} /> : null}

      <div className="border-t border-border pt-3">
        <TrackWalkButton />
      </div>
    </div>
  );
}

/**
 * Announces a new route once per solve — never coordinates. A failure is not
 * announced here: its notice is an alert, which screen readers read out.
 * Re-solving the route being navigated (same geometry) stays silent.
 */
function useResultAnnouncements() {
  const announce = useAnnounce();
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.result === prev.result || !s.result?.ok) return;
        if (s.navigationActive && sameRoute(s.alternatives[0], prev.alternatives[prev.activeAlternative]))
          return;
        const n = s.alternatives.length;
        announce(
          `Route found: ${formatDistance(s.result.distanceM)}, about ${formatDuration(s.result.durationS)}` +
            (n > 1 ? `. ${n} options.` : '.'),
        );
      }),
    [announce],
  );
}
