/**
 * Lazy admin map with honest fallbacks: a spinner while MapLibre and the
 * dataset load, and a text explanation (never a blank box) when the map
 * cannot run — every map action also has a form control (coordinates,
 * access-point list), so editing still works without it.
 */
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Button } from '../../components/ui/index.ts';
import { cx } from '../../components/ui/index.ts';
import { Spinner } from '../../components/ui/index.ts';
import type { CampusData } from '../../data/index.ts';
import type { LngLat } from '../../data/index.ts';
import type { MapEditingProps } from '../../map/editing/index.ts';
import type { CampusDataState } from '../data/campus-data.ts';
import type { AdminMapProps } from './AdminMap.tsx';

const AdminMap = lazy<ComponentType<AdminMapProps>>(() =>
  import('./AdminMap.tsx').catch(() => ({ default: MapChunkFailed })),
);

function MapChunkFailed() {
  return <MapUnavailable message="The map could not be downloaded. Reload the page to try again." />;
}

function MapUnavailable({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="status"
      className="flex h-full min-h-40 flex-col items-center justify-center gap-2 bg-surface-sunken p-4 text-center text-sm text-muted"
    >
      <p>{message}</p>
      <p>You can still enter coordinates in the form.</p>
      {onRetry ? (
        <Button size="sm" icon="reset" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export interface MapPanelProps {
  campus: CampusDataState;
  editing: MapEditingProps;
  focus?: { lngLat: LngLat; zoom?: number } | null;
  /** Accessible name of the map region. */
  label: string;
  className?: string;
}

export function MapPanel({ campus, editing, focus, label, className }: MapPanelProps) {
  const [mapError, setMapError] = useState<string | null>(null);
  return (
    <section aria-label={label} className={cx('relative overflow-hidden bg-surface-sunken', className)}>
      {campus.status === 'error' ? (
        <MapUnavailable message={campus.message} onRetry={campus.retry} />
      ) : campus.status === 'loading' ? (
        <div className="flex h-full min-h-40 items-center justify-center">
          <Spinner label="Loading the map…" />
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex h-full min-h-40 items-center justify-center">
              <Spinner label="Loading the map…" />
            </div>
          }
        >
          <ReadyMap data={campus.data} editing={editing} focus={focus ?? null} onError={setMapError} />
        </Suspense>
      )}
      {mapError ? (
        <p
          role="alert"
          className="absolute inset-x-2 bottom-2 rounded-md border border-border bg-surface-raised p-2 text-sm text-text shadow-2"
        >
          {mapError}
        </p>
      ) : null}
    </section>
  );
}

function ReadyMap(props: {
  data: CampusData;
  editing: MapEditingProps;
  focus: { lngLat: LngLat; zoom?: number } | null;
  onError(message: string): void;
}) {
  return <AdminMap {...props} className="relative h-full w-full" />;
}
