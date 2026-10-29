import { useRef, useState } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import type { GeoStatus } from '../../geolocation/index.ts';
import { Button, Dialog, IconButton, cx, type IconName } from '../ui/index.ts';
import {
  LOCATION_PRIMER_STOP,
  LOCATION_PRIMER_TEXT,
  LOCATION_PRIMER_TITLE,
  locationPromptExpected,
  markLocationPrimerShown,
} from './location-primer.ts';

const VIEW: Record<GeoStatus, { icon: IconName; label: string }> = {
  idle: { icon: 'locate', label: 'Show my location' },
  requesting: { icon: 'locate', label: 'Finding your location…' },
  active: { icon: 'locate', label: 'Stop showing my location' },
  unavailable: { icon: 'locate', label: 'Location unavailable — still trying. Click to stop' },
  timeout: { icon: 'locate', label: 'Location is slow — still trying. Click to stop' },
  denied: { icon: 'locate-off', label: 'Location blocked — click for how to allow it' },
  unsupported: { icon: 'locate-off', label: 'Location not available in this browser' },
  error: { icon: 'locate-off', label: 'Location failed — click to try again' },
};

type LocateState = 'on' | 'problem' | 'off';

function stateOf(status: GeoStatus, active: boolean): LocateState {
  if (status === 'denied' || status === 'unsupported' || status === 'error') return 'problem';
  return active ? 'on' : 'off';
}

/**
 * Toggles live location (in-memory only). The label names what a click does
 * ("Show…" / "Stop showing…"), so no aria-pressed (a changing name plus a
 * pressed state would be announced contradictorily); the state is also shown
 * by icon and colour: accent tint while on, danger colour when blocked/failed.
 *
 * Before the first browser permission prompt a short dialog says why the
 * location is needed and that it never leaves the device; "Continue" then
 * starts location (and so the browser's prompt).
 */
export function LocateButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const status = useAppStore((s) => s.geoStatus);
  const active = useAppStore((s) => s.locationActive);
  const start = useAppStore((s) => s.startLocation);
  const stop = useAppStore((s) => s.stopLocation);
  const [primerOpen, setPrimerOpen] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const view = VIEW[status];

  const request = () => {
    void locationPromptExpected().then((ask) => (ask ? setPrimerOpen(true) : start()));
  };
  const accept = () => {
    markLocationPrimerShown();
    setPrimerOpen(false);
    start();
  };

  return (
    <>
      <IconButton
        icon={view.icon}
        label={view.label}
        variant="secondary"
        size={size}
        data-state={stateOf(status, active)}
        aria-busy={status === 'requesting' || undefined}
        onClick={() => (active ? stop() : request())}
        className={cx(
          'data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:text-accent-text',
          'data-[state=problem]:border-danger data-[state=problem]:text-danger',
          status === 'requesting' && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      <Dialog
        open={primerOpen}
        onClose={() => setPrimerOpen(false)}
        title={LOCATION_PRIMER_TITLE}
        description={LOCATION_PRIMER_TEXT}
        size="sm"
        initialFocus={continueRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrimerOpen(false)}>
              Not now
            </Button>
            <Button ref={continueRef} onClick={accept}>
              Continue
            </Button>
          </>
        }
      >
        <p className="text-sm">{LOCATION_PRIMER_STOP}</p>
      </Dialog>
    </>
  );
}
