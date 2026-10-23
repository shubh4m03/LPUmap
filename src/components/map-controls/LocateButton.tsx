import { useAppStore } from '../../app/store/index.ts';
import type { GeoStatus } from '../../geolocation/index.ts';
import { IconButton, cx, type IconName } from '../ui/index.ts';

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
 */
export function LocateButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const status = useAppStore((s) => s.geoStatus);
  const active = useAppStore((s) => s.locationActive);
  const start = useAppStore((s) => s.startLocation);
  const stop = useAppStore((s) => s.stopLocation);
  const view = VIEW[status];
  return (
    <IconButton
      icon={view.icon}
      label={view.label}
      variant="secondary"
      size={size}
      data-state={stateOf(status, active)}
      aria-busy={status === 'requesting' || undefined}
      onClick={() => (active ? stop() : start())}
      className={cx(
        'data-[state=on]:border-accent data-[state=on]:bg-accent-soft data-[state=on]:text-accent-text',
        'data-[state=problem]:border-danger data-[state=problem]:text-danger',
        status === 'requesting' && 'animate-pulse motion-reduce:animate-none',
      )}
    />
  );
}
