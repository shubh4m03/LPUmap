import { lazy, Suspense } from 'react';
import { Spinner } from '../components/ui/index.ts';
import type { MapStageProps } from './MapStage.tsx';
import { useAppStore } from './store/index.ts';

// MapLibre is ~1 MB: load it in its own chunk so search and panels are usable sooner.
const MapStage = lazy(() => import('./MapStage.tsx').then((m) => ({ default: m.MapStage })));
// The Canvas2D overview never loads MapLibre (Decision D4).
const IsoStudioStage = lazy(() =>
  import('./IsoStudioStage.tsx').then((m) => ({ default: m.IsoStudioStage })),
);
// The isometric mode: the owner's illustration (default) or the map-accurate drawing (?iso=map).
const IsometricModeStage = lazy(() =>
  import('../isometric-art/IsometricModeStage.tsx').then((m) => ({ default: m.IsometricModeStage })),
);

export interface ViewStageProps extends MapStageProps {
  /** Draw the overview whatever the stored mode (no WebGL, before the store has caught up). */
  forceOverview?: boolean;
}

/**
 * The view of the active mode (docs/ISOMETRIC_AND_3D_DESIGN.md §8.1):
 * MapStage for Realistic 3D and 2D (one MapLibre map, so switching between
 * them keeps the map), IsoStudioStage for the overview. Selection, search,
 * favourites and the route live in the store and are shared by both.
 */
export function ViewStage({ forceOverview = false, ...props }: ViewStageProps) {
  const overview = useAppStore((s) => s.viewMode === 'isometric') || forceOverview;
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-surface-sunken">
          <Spinner label={overview ? 'Loading the overview…' : 'Loading the map…'} />
        </div>
      }
    >
      {overview ? (
        <IsometricModeStage
          reducedMotion={props.reducedMotion}
          padding={props.padding}
          renderMapAccurate={(padding) => (
            <IsoStudioStage theme={props.theme} reducedMotion={props.reducedMotion} padding={padding} />
          )}
        />
      ) : (
        <MapStage {...props} />
      )}
    </Suspense>
  );
}
