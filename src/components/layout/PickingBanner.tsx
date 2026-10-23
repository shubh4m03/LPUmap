import { useAppStore } from '../../app/store/index.ts';
import { Button } from '../ui/index.ts';

/** Shown while the next map click sets a route endpoint. */
export function PickingBanner() {
  const picking = useAppStore((s) => s.pickingOnMap);
  const cancel = useAppStore((s) => s.setPickingOnMap);
  if (!picking) return null;
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-3 rounded-lg border border-accent bg-surface-raised px-4 py-2 text-sm shadow-2"
    >
      <span className="flex-1">
        Click the map or a place to set the {picking === 'origin' ? 'start' : 'destination'}.
      </span>
      <Button size="sm" variant="ghost" onClick={() => cancel(null)}>
        Cancel
      </Button>
    </div>
  );
}
