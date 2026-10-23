import { useAppStore } from '../../app/store/index.ts';
import { Button } from '../ui/index.ts';

/** Phone prompt while the next map tap sets a route endpoint (shown above the map, not under the sheet). */
export function MapPickPrompt() {
  const picking = useAppStore((s) => s.pickingOnMap);
  if (!picking) return null;
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-accent bg-surface-raised px-3 py-2 text-sm text-text shadow-3"
    >
      <span className="flex-1">
        Tap the map or a place to set the {picking === 'origin' ? 'start' : 'destination'}.
      </span>
      <Button size="sm" variant="ghost" onClick={() => useAppStore.getState().setPickingOnMap(null)}>
        Cancel
      </Button>
    </div>
  );
}
