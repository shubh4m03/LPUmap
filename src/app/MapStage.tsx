import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ImageryNotice } from '../components/map-controls/ImageryNotice.tsx';
import { ReturnToCampusButton } from '../components/map-controls/ReturnToCampusButton.tsx';
import { useIsMobile } from '../accessibility/useMediaQuery.ts';
import { Button, Icon } from '../components/ui/index.ts';
import { ToastContext } from '../components/ui/toast-context.ts';
import { APP_CONFIG } from '../config/index.ts';
import type { DetectionsFile, LngLat } from '../data/index.ts';
import { useSuggestEditing } from '../components/suggest/useSuggestEditing.ts';
import { MAP_MESSAGES, MapView, type MapController, type MapPadding } from '../map/index.ts';
import { boundsOfPolygons, campusOutOfView, polygonsOf, type CameraView } from '../map/providers/camera.ts';
import { probeImagery } from '../map/providers/failure.ts';
import { imageryForMode } from '../map/providers/registry.ts';
import type { ImageryProvider, ProviderFailure } from '../map/providers/types.ts';
import { useAtlas } from './data/atlas-context.ts';
import { useImageryFailureReporter } from './hooks/useImageryRuntime.ts';
import { useNow } from './hooks/useNow.ts';
import { setMapController } from './map-controller.ts';
import { pickPlaceOnMap, pickPointOnMap } from './map-picking.ts';
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
export const DETECTIONS_LOAD_FAILED =
  'Could not load the unverified detected footprints. Try the layer again later.';

/** The detected-footprints file, fetched the first time the opt-in layer is turned on. */
function useDetections(show: boolean): DetectionsFile | null {
  const { optional } = useAtlas();
  const toast = useContext(ToastContext);
  const [detections, setDetections] = useState<DetectionsFile | null>(null);
  useEffect(() => {
    if (!show || detections || !optional) return;
    let cancelled = false;
    optional.detections().then(
      (file) => {
        if (!cancelled) setDetections(file);
      },
      () => {
        if (!cancelled) toast?.show({ message: DETECTIONS_LOAD_FAILED, tone: 'warning' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [show, detections, optional, toast]);
  return detections;
}

/** Width the phone control column takes from the right edge (two-column view-mode switcher plus gutters). */
const COMPACT_CONTROLS_PX = 12 + 90 + 8;

export function MapStage({ theme, reducedMotion, padding, onFatalError }: MapStageProps) {
  const { data, getPlace, studioModels, contextPlaces } = useAtlas();
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
  const { showNearbyOutsideCampus, showDetectedFootprints } = useAppStore(
    useShallow((s) => ({
      showNearbyOutsideCampus: s.showNearbyOutsideCampus,
      showDetectedFootprints: s.showDetectedFootprints,
    })),
  );
  const detections = useDetections(showDetectedFootprints);
  // "Suggest a missing place": map clicks place the suggestion's point instead of selecting places.
  const suggestEditing = useSuggestEditing();
  const { viewMode, providers, imageryRuntime } = useAppStore(
    useShallow((s) => ({ viewMode: s.viewMode, providers: s.providers, imageryRuntime: s.imageryRuntime })),
  );
  // Satellite 2D draws imagery; Campus 3D draws it only when it shows buildings; never a fake.
  const imagery = useMemo(
    () => imageryForMode(viewMode, providers, imageryRuntime),
    [viewMode, providers, imageryRuntime],
  );
  const onImageryFailure = useImageryFailureReporter();
  const isMobile = useIsMobile();
  useImageryProbe(imagery, onImageryFailure);
  const [cameraView, setCameraView] = useState<CameraView | null>(null);
  const campusBounds = useMemo(() => boundsOfPolygons(data.boundary), [data.boundary]);
  const campusPolygons = useMemo(() => polygonsOf(data.boundary), [data.boundary]);
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

  const pickToast = useContext(ToastContext);
  const onSelectPlace = useCallback(
    (id: string | null) => {
      // While choosing on the map: an empty-map click is handled by onMapClick; an
      // unconnected place explains itself and keeps picking on (src/app/map-picking.ts).
      const picked = pickPlaceOnMap(id ? getPlace(id) : undefined);
      if (picked.kind === 'not-connected')
        pickToast?.show({ message: picked.message, tone: 'warning', durationMs: 9000 });
      if (picked.kind !== 'not-picking') return;
      const s = useAppStore.getState();
      if (id) s.selectPlace(id, { focus: false });
      else if (s.selectedPlaceId) s.clearSelection();
    },
    [getPlace, pickToast],
  );

  const onMapClick = useCallback((lngLat: LngLat) => {
    pickPointOnMap(lngLat);
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
        studioModels={studioModels}
        showNearbyOutsideCampus={showNearbyOutsideCampus}
        contextPlaces={contextPlaces}
        showDetectedFootprints={showDetectedFootprints}
        detections={detections}
        editing={suggestEditing}
        onSelectPlace={onSelectPlace}
        onMapClick={onMapClick}
        onUserPan={onUserPan}
        onReady={onReady}
        onError={onError}
        imagery={imagery}
        onImageryFailure={onImageryFailure}
        onCameraIdle={setCameraView}
      />
      {imagery ? (
        <ImageryNotice
          provider={imagery}
          compact={isMobile}
          center={cameraView?.center ?? null}
          className="absolute z-(--ds-z-controls)"
          // Clear of the search bar, the side panel and the control column.
          style={{
            left: padding.left + 8,
            top: padding.top + 8,
            maxWidth: `min(24rem, calc(100% - ${padding.left + Math.max(padding.right, isMobile ? COMPACT_CONTROLS_PX : 0) + 16}px))`,
          }}
        />
      ) : null}
      {campusOutOfView(cameraView, campusBounds, campusPolygons) ? (
        <div
          className="pointer-events-none absolute z-(--ds-z-controls) flex justify-center"
          style={{ left: padding.left, right: padding.right, bottom: padding.bottom + 48 }}
        >
          <ReturnToCampusButton className="pointer-events-auto" />
        </div>
      ) : null}
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

/**
 * One metadata request (no imagery) when a keyed provider is first shown, so a
 * missing, revoked or expired key falls back at once instead of after tile errors.
 */
function useImageryProbe(imagery: ImageryProvider | null, onFailure: (f: ProviderFailure) => void): void {
  const probed = useRef<string | null>(null);
  useEffect(() => {
    const url = imagery?.probeUrl() ?? null;
    if (!imagery || !url || probed.current === imagery.id) return;
    probed.current = imagery.id;
    const ac = new AbortController();
    probeImagery(url, { signal: ac.signal }).then(
      (failure) => {
        if (failure) onFailure(failure);
      },
      () => {
        // Aborted (left the mode before the answer): probe again next time.
        probed.current = null;
      },
    );
    return () => ac.abort();
  }, [imagery, onFailure]);
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
