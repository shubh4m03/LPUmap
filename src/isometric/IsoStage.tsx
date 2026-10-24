import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAtlas } from '../app/data/atlas-context.ts';
import { setMapController } from '../app/map-controller.ts';
import { placeEndpoint } from '../app/place-actions.ts';
import { buildRouteOverlay, useAppStore } from '../app/store/index.ts';
import type { LngLat } from '../data/index.ts';
import type { MapPadding } from '../map/types.ts';
import type { IsoController } from './iso-controller.ts';
import { IsoView } from './IsoView.tsx';
import type { IsoStudioModel } from './scene.ts';

export interface IsoStageProps {
  theme: 'light' | 'dark';
  reducedMotion: boolean;
  padding: MapPadding;
  /** Owner-authored models (see `isoStudioModel` in ./studio.ts); empty until the publication wiring lands. */
  studioModels?: readonly IsoStudioModel[];
  /** Opens the accessible building directory (the `D` key and the canvas hint). */
  onOpenDirectory?(): void;
  /** See IsoViewProps.narrowInfoCard. */
  narrowInfoCard?: boolean;
}

/**
 * The overview wired to the store, like MapStage for the map modes (§8.1):
 * selection, focus requests, the planned route and "pick on map" are shared;
 * the camera is the overview's own (an IsoController registered as the app's
 * MapController, so the zoom/reset controls keep working). Live GPS and
 * follow-me are not shown here (§8.2).
 */
export function IsoStage({
  theme,
  reducedMotion,
  padding,
  studioModels,
  onOpenDirectory,
  narrowInfoCard,
}: IsoStageProps) {
  const { data, getPlace } = useAtlas();
  const [controller, setController] = useState<IsoController | null>(null);
  const { showLabels, selectedPlaceId, focusRequest } = useAppStore(
    useShallow((s) => ({
      showLabels: s.showLabels,
      selectedPlaceId: s.selectedPlaceId,
      focusRequest: s.focusRequest,
    })),
  );
  const { alternatives, activeAlternative, progress, navigationActive } = useAppStore(
    useShallow((s) => ({
      alternatives: s.alternatives,
      activeAlternative: s.activeAlternative,
      progress: s.progress,
      navigationActive: s.navigationActive,
    })),
  );
  const route = useMemo(
    () => buildRouteOverlay(alternatives, activeAlternative, progress, navigationActive),
    [alternatives, activeAlternative, progress, navigationActive],
  );

  // A building place highlights itself; a place inside a building highlights its host; others get a pin.
  const selected = selectedPlaceId ? getPlace(selectedPlaceId) : undefined;
  const selectedId = selected
    ? selected.kind === 'building'
      ? selected.id
      : (selected.buildingId ?? null)
    : selectedPlaceId;
  const selectedPoint: LngLat | null =
    selected && selected.kind !== 'building' && !selected.buildingId ? selected.location : null;

  const onSelect = useCallback(
    (id: string | null) => {
      const s = useAppStore.getState();
      if (s.pickingOnMap) {
        const place = id ? getPlace(id) : undefined;
        const endpoint = place ? placeEndpoint(place) : null;
        if (!endpoint) return; // An empty-ground click is handled by onGroundClick.
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

  const onGroundClick = useCallback((lngLat: LngLat) => {
    const s = useAppStore.getState();
    if (!s.pickingOnMap) return;
    const endpoint = { kind: 'point' as const, label: 'Point picked on map', location: lngLat };
    if (s.pickingOnMap === 'origin') s.setOrigin(endpoint);
    else s.setDestination(endpoint);
    s.setPickingOnMap(null);
  }, []);

  const onReady = useCallback((c: IsoController) => {
    setMapController(c);
    setController(c);
  }, []);
  useEffect(() => () => setMapController(null), []);

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

  // Frame a newly planned route (as the map modes do).
  const activeCoords = alternatives[activeAlternative]?.coordinates;
  useEffect(() => {
    if (controller && activeCoords && activeCoords.length > 1 && !useAppStore.getState().navigationActive) {
      controller.fitCoordinates(activeCoords);
    }
  }, [controller, activeCoords]);

  return (
    <IsoView
      data={data}
      {...(studioModels ? { studioModels } : {})}
      theme={theme}
      reducedMotion={reducedMotion}
      showLabels={showLabels}
      selectedId={selectedId}
      selectedPoint={selectedPoint}
      route={route}
      padding={padding}
      onSelect={onSelect}
      onGroundClick={onGroundClick}
      onReady={onReady}
      {...(onOpenDirectory ? { onOpenDirectory } : {})}
      {...(narrowInfoCard !== undefined ? { narrowInfoCard } : {})}
    />
  );
}
