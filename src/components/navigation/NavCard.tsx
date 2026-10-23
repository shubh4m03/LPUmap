import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../app/store/index.ts';
import { formatDistance, formatDuration } from '../../distance/index.ts';
import { Notice } from '../directions/Notice.tsx';
import { Button, IconButton } from '../ui/index.ts';
import { GpsIndicator } from './GpsIndicator.tsx';
import { useReroute } from './hooks.ts';
import { geoProblem, progressPercent } from './nav-format.ts';
import { TrackingLine } from './TrackingCard.tsx';

/** Live route-following card: remaining distance/time, progress, GPS, off-route and arrival. */
export function NavCard({ backgroundPaused }: { backgroundPaused: boolean }) {
  const { progress, destination, geoStatus, rerouteError, route, trackingActive, hasFix } = useAppStore(
    useShallow((s) => ({
      progress: s.progress,
      destination: s.destination,
      geoStatus: s.geoStatus,
      rerouteError: s.rerouteError,
      route: s.alternatives[s.activeAlternative] ?? null,
      trackingActive: s.trackingActive,
      hasFix: s.lastSample !== null,
    })),
  );
  const recalculate = useReroute();
  const stop = () => useAppStore.getState().stopNavigation();
  const recenter = () => {
    const s = useAppStore.getState();
    if (s.lastSample) s.requestFocus({ kind: 'point', lngLat: s.lastSample.lngLat });
  };
  const destLabel = destination?.label ?? 'your destination';

  if (progress?.arrived) {
    return <ArrivalCard destLabel={destLabel} onDone={stop} />;
  }

  const planned = route?.distanceM ?? progress?.plannedDistanceM ?? Number.NaN;
  const remainingM = progress ? progress.remainingM : planned;
  const remainingS = progress ? progress.remainingS : (route?.durationS ?? Number.NaN);
  const pct = progressPercent(progress);
  const problem = geoProblem(geoStatus);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">To {destLabel}</h2>
        <IconButton
          icon="locate"
          label={hasFix ? 'Centre the map on me' : 'Centre the map on me (waiting for a location fix)'}
          size="sm"
          variant="secondary"
          disabled={!hasFix}
          onClick={recenter}
        />
        {/* Short visible text; the accessible name starts with it (label in name). */}
        <Button size="sm" variant="secondary" icon="stop" aria-label="End navigation" onClick={stop}>
          End
        </Button>
      </div>
      <p className="text-lg leading-tight font-semibold">
        {formatDistance(remainingM)} left · {formatDuration(remainingS)}
      </p>

      <div
        role="progressbar"
        aria-label="Route progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${formatDistance(progress?.distanceAlongM ?? 0)} of ${formatDistance(planned)} covered`}
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {/* Problems and the off-route action come first: on short phone screens the card scrolls. */}
      {problem ? (
        // Not a live region: the location toast already announces the problem.
        <Notice
          tone="danger"
          title="Location problem"
          actions={
            problem.retry ? (
              <Button size="sm" variant="secondary" onClick={() => useAppStore.getState().retryLocation()}>
                Retry
              </Button>
            ) : null
          }
        >
          {problem.text}
        </Notice>
      ) : null}
      {backgroundPaused ? (
        <Notice tone="info" role="status" title="Location updates paused while the app was in the background">
          Progress resumes with the next location fix.
        </Notice>
      ) : null}
      {rerouteError ? (
        <Notice tone="warning" title="Still on the original route">
          Couldn't recalculate: {rerouteError}
        </Notice>
      ) : null}
      {progress?.offRoute ? (
        <Notice
          tone="warning"
          title="You seem to be off the route"
          actions={
            <Button size="sm" variant="primary" icon="route" onClick={recalculate}>
              Recalculate from here
            </Button>
          }
        >
          {progress.distanceFromRouteM !== null
            ? `About ${formatDistance(progress.distanceFromRouteM)} from the planned route.`
            : null}
        </Notice>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>Planned route {formatDistance(planned)}</span>
        <span>
          Straight line to destination {formatDistance(progress?.straightLineToDestinationM ?? Number.NaN)}
        </span>
        <GpsIndicator mode="navigation" />
      </p>
      {trackingActive ? (
        <TrackingLine plannedM={planned} />
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon="history"
          className="self-start"
          onClick={() => useAppStore.getState().startTracking()}
        >
          Track my walk
        </Button>
      )}
    </div>
  );
}

function ArrivalCard({ destLabel, onDone }: { destLabel: string; onDone(): void }) {
  const { planned, trip } = useAppStore(
    useShallow((s) => ({
      planned: s.progress?.plannedDistanceM ?? Number.NaN,
      trip: s.navTrip,
    })),
  );
  // Elapsed time as of the fix that confirmed arrival.
  const tookS = trip ? trip.elapsedS : Number.NaN;
  return (
    <div className="flex flex-col gap-2">
      <Notice tone="success" title="You have arrived">
        <p>You are at {destLabel}.</p>
      </Notice>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Planned route</dt>
        <dd>{formatDistance(planned)}</dd>
        <dt className="text-muted">Covered (GPS, approximate)</dt>
        <dd>{trip ? formatDistance(trip.travelledM) : '—'}</dd>
        <dt className="text-muted">Time taken</dt>
        <dd>{formatDuration(tookS)}</dd>
      </dl>
      <Button variant="primary" icon="check" onClick={onDone} className="self-end">
        End navigation
      </Button>
    </div>
  );
}
