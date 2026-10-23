import { useEffect, useId, useRef } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { Button } from '../ui/index.ts';
import { locationBlockReason } from './directions-model.ts';

const PERMISSION_NOTE =
  "Navigation follows your position with this device's location. Your browser may ask for permission first. Your location stays on this device — it is never stored or sent.";

/** "Start navigation" — explains the location permission before asking for it. */
export function NavigationStart() {
  const geoStatus = useAppStore((s) => s.geoStatus);
  const locationActive = useAppStore((s) => s.locationActive);
  const navigating = useAppStore((s) => s.navigationActive);
  const noteId = useId();
  const blocked = locationBlockReason(geoStatus);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  // Starting or ending navigation swaps the button under the user's focus;
  // keep keyboard focus here (on its replacement) instead of losing it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body) buttonRef.current?.focus();
  }, [navigating]);

  if (navigating) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-accent p-3">
        <p className="text-sm font-semibold">Navigation is on.</p>
        <p className="text-sm text-muted">End navigation to change the start, destination or travel mode.</p>
        <Button
          ref={buttonRef}
          variant="secondary"
          icon="stop"
          className="self-start"
          onClick={() => useAppStore.getState().stopNavigation()}
        >
          End navigation
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        ref={buttonRef}
        variant="primary"
        icon="navigation"
        fullWidth
        disabled={blocked !== null}
        aria-describedby={noteId}
        onClick={() => {
          const s = useAppStore.getState();
          s.startNavigation();
          // On phones, lower the sheet so the map and the navigation card are visible.
          if (s.sheetSnap !== 'peek') s.setSheetSnap('peek');
        }}
      >
        Start navigation
      </Button>
      <p id={noteId} className="text-xs text-muted">
        {blocked ? `Navigation needs your location. ${blocked}` : locationActive ? null : PERMISSION_NOTE}
      </p>
    </div>
  );
}

const TRACK_NOTE =
  'Measures how far you walk or ride using GPS (approximate). Nothing is saved; closing the tab ends it.';

/** Starts or stops the walk-tracking session. */
export function TrackWalkButton({ className }: { className?: string }) {
  const tracking = useAppStore((s) => s.trackingActive);
  const geoStatus = useAppStore((s) => s.geoStatus);
  const noteId = useId();
  const blocked = locationBlockReason(geoStatus);
  return (
    <div className={className}>
      <Button
        variant="secondary"
        size="sm"
        icon={tracking ? 'stop' : 'history'}
        disabled={!tracking && blocked !== null}
        aria-describedby={noteId}
        onClick={() => {
          const s = useAppStore.getState();
          if (tracking) s.stopTracking();
          else s.startTracking();
        }}
      >
        {tracking ? 'Stop tracking' : 'Track my walk'}
      </Button>
      <p id={noteId} className="mt-1 text-xs text-muted">
        {!tracking && blocked ? `Tracking needs your location. ${blocked}` : TRACK_NOTE}
      </p>
    </div>
  );
}
