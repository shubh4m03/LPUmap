import { useAppStore } from '../../app/store/index.ts';
import { useNow } from '../../app/hooks/useNow.ts';
import { Badge } from '../ui/index.ts';
import { gpsLabel, gpsState } from './nav-format.ts';

/** GPS quality in words ("GPS ±12 m", "Weak GPS signal — progress paused"). */
export function GpsIndicator({ mode }: { mode: 'navigation' | 'tracking' }) {
  const sample = useAppStore((s) => s.lastSample);
  const progress = useAppStore((s) => (mode === 'navigation' ? s.progress : null));
  const now = useNow(2000);
  const state = gpsState(sample, now, progress);
  const tone = state.kind === 'good' ? 'success' : state.kind === 'weak' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} icon={state.kind === 'weak' ? 'warning' : 'locate'}>
      {gpsLabel(state, mode)}
    </Badge>
  );
}
