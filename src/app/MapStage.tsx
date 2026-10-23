import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, Icon } from '../components/ui/index.ts';
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/index.ts';
import { MAP_MESSAGES, MapView, type MapController, type MapPadding } from '../map/index.ts';
import { useAtlas } from './data/atlas-context.ts';
import { useNow } from './hooks/useNow.ts';
import { setMapController } from './map-controller.ts';
import { placeEndpoint } from './place-actions.ts';
import { buildRouteOverlay, useAppStore } from './store/index.ts';
import './maplibre-worker.ts';

export interface MapStageProps {
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  padding: MapPadding;
  /** The map cannot run at all (no WebGL): switch to list mode. */
  onFatalError(message: string): void;
}

/** MapView wired to the store. Subscribes only to the state the map draws. */
export function MapStage({ theme, reducedMotion, padding, onFatalError }: MapStageProps) {
  const { data, getPlace } = useAtlas();
  const [controller, setController] = useState<MapController | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { mode3d, showLabels, visibleGroups, selectedPlaceId, focusRequest } = useAppStore(
    useShallow((s) => ({
      mode3d: s.mode3d,
      showLabels: s.showLabels,
      visibleGroups: s.visibleGroups,
      selectedPlaceId: s.selectedPlaceId,
      focusRequest: s.focusRequest,
    })),
  );
  const { alternatives, activeAlternative, progress, navigationActive, lastSample, followUser } = useAppStore(
    useShallow((s) => ({
      alternatives: s.alternatives,
      activeAlternative: s.activeAlternative,
      progress: s.progress,
      navigationActive: s.navigationActive,
      lastSample: s.lastSample,
      followUser: s.followUser,
    })),
  );

  const route = useMemo(
    () => buildRouteOverlay(alternatives, activeAlternative, progress, navigationActive),
    [alternatives, activeAlternative, progress, navigationActive],
  );
  const now = useNow(5000, lastSample !== null);
  const stale = lastSample !== null && now - lastSample.timestamp > APP_CONFIG.geolocation.staleAfterMs;
  const userLocation = useMemo(
    () => (lastSample ? { lngLat: lastSample.lngLat, accuracyM: lastSample.accuracyM, stale } : null),
    [lastSample, stale],
  );

  const onSelectPlace = useCallback(
    (id: string | null) => {
      const s = useAppStore.getState();
      if (s.pickingOnMap) {
        const place = id ? getPlace(id) : undefined;
        const endpoint = place ? placeEndpoint(place) : null;
        if (!endpoint) return; // An empty-map click is handled by onMapClick.
        if (s.pickingOnMap === 'origin') s.setOrigin(endpoint);
        else s.setDestination(endpoint);
        s.setPickingOnMap(null);
        return;
      }
      if (id) s.selectPlace(id, { focus: false });
      else if (s.selectedPlaceId) s.clearSelection();
    },
    [getPlace],
  );

  const onMapClick = useCallback((lngLat: LngLat) => {
    const s = useAppStore.getState();
    if (!s.pickingOnMap) return;
    const endpoint = { kind: 'point' as const, label: 'Point picked on map', location: lngLat };
    if (s.pickingOnMap === 'origin') s.setOrigin(endpoint);
    else s.setDestination(endpoint);
    s.setPickingOnMap(null);
  }, []);

  // Panning while navigating stops follow-me; the navigation card offers "Follow" again.
  const onUserPan = useCallback(() => {
    const s = useAppStore.getState();
    if (s.navigationActive && s.followUser) s.setFollowUser(false);
  }, []);

  const onReady = useCallback((c: MapController) => {
    setMapController(c);
    setController(c);
  }, []);

  const onError = useCallback(
    (message: string) => {
      if (message === MAP_MESSAGES.webglUnavailable) onFatalError(message);
      else setProblem(message);
    },
    [onFatalError],
  );

  useEffect(() => () => setMapController(null), []);

  useEffect(() => {
    controller?.setPadding(padding);
  }, [controller, padding]);

  useEffect(() => {
    if (!controller || !focusRequest) return;
    if (focusRequest.kind === 'reset') controller.resetView();
    else if (focusRequest.kind === 'fit') controller.fitCoordinates(focusRequest.coordinates);
    else if (focusRequest.kind === 'point') controller.flyTo(focusRequest.lngLat, focusRequest.zoom);
    else {
      const location = getPlace(focusRequest.placeId)?.location;
      if (location) controller.flyTo(location);
    }
  }, [controller, focusRequest, getPlace]);

  // Follow-me: each accepted fix (lastSample only changes on accepted samples) re-centres
  // the camera while navigating, until the user pans.
  useEffect(() => {
    if (controller && navigationActive && followUser && lastSample) controller.follow(lastSample.lngLat);
  }, [controller, navigationActive, followUser, lastSample]);

  // Frame a newly planned route (not while navigating: the user is following it).
  const activeCoords = alternatives[activeAlternative]?.coordinates;
  useEffect(() => {
    if (controller && activeCoords && activeCoords.length > 1 && !useAppStore.getState().navigationActive) {
      controller.fitCoordinates(activeCoords);
    }
  }, [controller, activeCoords]);

  return (
    <div className="relative h-full w-full">
      <MapView
        data={data}
        theme={theme}
        mode3d={mode3d}
        reducedMotion={reducedMotion}
        visibleGroups={visibleGroups}
        showLabels={showLabels}
        selectedPlaceId={selectedPlaceId}
        route={route}
        userLocation={userLocation}
        onSelectPlace={onSelectPlace}
        onMapClick={onMapClick}
        onUserPan={onUserPan}
        onReady={onReady}
        onError={onError}
      />
      {problem ? (
        <MapProblemBanner
          message={problem}
          onDismiss={() => setProblem(null)}
          onListMode={() => onFatalError(problem)}
        />
      ) : null}
    </div>
  );
}

function MapProblemBanner(props: { message: string; onDismiss(): void; onListMode(): void }) {
  return (
    <div
      role="alert"
      className="absolute inset-x-3 bottom-10 z-(--ds-z-controls) mx-auto flex max-w-lg flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm text-text shadow-2"
    >
      <Icon name="warning" className="text-warning" />
      <p className="min-w-0 flex-1">{props.message}</p>
      <Button size="sm" variant="secondary" onClick={props.onListMode}>
        Use list view
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
