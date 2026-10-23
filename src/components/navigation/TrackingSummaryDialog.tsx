import { useRef } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { formatDistance, formatDuration, formatSpeed } from '../../distance/index.ts';
import { Button, Dialog } from '../ui/index.ts';

/** Shown once when walk tracking stops. Nothing in it is stored. */
export function TrackingSummaryDialog() {
  const summary = useAppStore((s) => s.trackingSummary);
  const dismiss = useAppStore((s) => s.dismissTrackingSummary);
  const doneRef = useRef<HTMLButtonElement>(null);
  if (!summary) return null;
  const elapsedS = (summary.endedAt - summary.startedAt) / 1000;

  return (
    <Dialog
      open
      onClose={dismiss}
      title="Walk summary"
      size="sm"
      initialFocus={doneRef}
      footer={
        <Button ref={doneRef} variant="primary" onClick={dismiss}>
          Done
        </Button>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Distance travelled</dt>
        <dd className="font-semibold">{formatDistance(summary.travelledM)}</dd>
        <dt className="text-muted">Time elapsed</dt>
        <dd className="font-semibold">{formatDuration(elapsedS)}</dd>
        <dt className="text-muted">Average speed</dt>
        <dd className="font-semibold">
          {summary.averageSpeedMps === null ? 'Not enough data' : formatSpeed(summary.averageSpeedMps)}
        </dd>
        {summary.plannedDistanceM !== null ? (
          <>
            <dt className="text-muted">Planned route</dt>
            <dd className="font-semibold">{formatDistance(summary.plannedDistanceM)}</dd>
          </>
        ) : null}
      </dl>
      {summary.acceptedSamples === 0 ? (
        <p className="mt-3 text-sm">
          No usable location fixes were received, so no distance could be measured.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        Measured with your device's GPS, which is approximate — not fitness-grade. Only movement from reliable
        fixes was counted. Nothing was saved: this summary disappears when you close it, and closing the tab
        ends any tracking.
      </p>
    </Dialog>
  );
}
