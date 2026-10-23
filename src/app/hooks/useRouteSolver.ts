import { useEffect } from 'react';
import type { RouteOk } from '../../routing/index.ts';
import { useAtlas } from '../data/atlas-context.ts';
import { useAppStore } from '../store/index.ts';

/**
 * Recomputes the route whenever both endpoints, the profile or the preference
 * change. The router never invents connections; failures are stored as-is so
 * the UI can explain them.
 */
export function useRouteSolver(): void {
  const { router } = useAtlas();
  const origin = useAppStore((s) => s.origin);
  const destination = useAppStore((s) => s.destination);
  const profile = useAppStore((s) => s.profile);
  const preference = useAppStore((s) => s.preference);

  useEffect(() => {
    const { setRouteResult } = useAppStore.getState();
    if (!origin || !destination) return;
    const results = router.alternatives({ from: origin, to: destination, profile, preference });
    const ok = results.filter((r): r is RouteOk => r.ok);
    setRouteResult(results[0] ?? null, ok);
  }, [router, origin, destination, profile, preference]);
}
