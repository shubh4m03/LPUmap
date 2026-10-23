import { useShallow } from 'zustand/react/shallow';
import { useNow } from '../../app/hooks/useNow.ts';
import { useAppStore } from '../../app/store/index.ts';
import { formatDistance, formatDuration, formatSpeed } from '../../distance/index.ts';
import { Notice } from '../directions/Notice.tsx';
import { Button } from '../ui/index.ts';
import { GpsIndicator } from './GpsIndicator.tsx';
import { elapsedSince, geoProblem, MOVEMENT_LABEL } from './nav-format.ts';

function useTrackingNumbers() {
  const { tracking, startedAt } = useAppStore(
    useShallow((s) => ({ tracking: s.tracking, startedAt: s.trackingStartedAt })),
  );
  const now = useNow(1000, startedAt !== null);
  return { tracking, elapsedS: elapsedSince(startedAt, now) };
}

/** One line inside the navigation card while a walk is also being tracked. */
export function TrackingLine({ plannedM }: { plannedM: number }) {
  const { tracking, elapsedS } = useTrackingNumbers();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span>
        Tracked {formatDistance(tracking?.travelledM ?? 0)} of {formatDistance(plannedM)} planned ·{' '}
        {formatDuration(elapsedS)}
      </span>
      <Button size="sm" variant="ghost" icon="stop" onClick={() => useAppStore.getState().stopTracking()}>
        Stop tracking
      </Button>
    </div>
  );
}

/** "Track my walk" card shown when tracking runs without navigation. */
export function TrackingCard({ backgroundPaused }: { backgroundPaused: boolean }) {
  const { tracking, elapsedS } = useTrackingNumbers();
  const geoStatus = useAppStore((s) => s.geoStatus);
  const problem = geoProblem(geoStatus);
  const speed = tracking?.averageSpeedMps ?? null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Tracking your walk</h2>
          <p className="text-lg leading-tight font-semibold">
            {formatDistance(tracking?.travelledM ?? 0)} · {formatDuration(elapsedS)}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon="stop"
          onClick={() => useAppStore.getState().stopTracking()}
        >
          Stop tracking
        </Button>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>Average {speed === null ? 'not known yet' : formatSpeed(speed)}</span>
        <span>{MOVEMENT_LABEL[tracking?.movement ?? 'unknown']}</span>
        <GpsIndicator mode="tracking" />
      </p>
      {problem ? (
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
          Distance resumes with the next location fix.
        </Notice>
      ) : null}
    </div>
  );
}
