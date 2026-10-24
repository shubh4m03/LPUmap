import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setBuildingMode, supportsWebGL } from '../buildings3d/index.ts';
import { detectionAttributionHtml } from '../buildings3d/optional-layers.ts';
import { attachRealistic3D, type Realistic3DHandle, type RenderNotice } from '../buildings3d/realistic3d.ts';
import type { StudioRenderSource } from '../building-studio/render/maplibre/index.ts';
import { ToastContext } from '../components/ui/toast-context.ts';
import { APP_CONFIG } from '../config/index.ts';
import { isValidLngLat } from '../distance/geodesic.ts';
import {
  applySelection,
  applyShowLabels,
  applyTheme,
  applyVisibleGroups,
  groupsKey,
  selectionTarget,
  setSourceData,
  type SelectionTarget,
} from './apply.ts';
import { createMapController } from './controller.ts';
import { classifyMapError, MAP_MESSAGES } from './errors.ts';
import {
  anchoredOrganizations,
  poiCollection,
  routeCollection,
  routeCoordinateCount,
  userLocationCollection,
} from './geojson.ts';
import { BUILDING_PICK_LAYER_IDS, POI_LAYER_IDS, SOURCE_IDS } from './ids.ts';
import { pickPlaceId, renderedBuildingIds } from './picking.ts';
import { buildMapStyle, glyphsUrl, OSM_ATTRIBUTION_HTML } from './style.ts';
import { installMapTestHooks } from './test-hooks.ts';
import type { MapViewProps } from './types.ts';

const NO_STUDIO_MODELS: readonly StudioRenderSource[] = [];

/** Device pixel ratio cap: phones with DPR 3 would otherwise render 2.25× the pixels of DPR 2 (D1 item 6). */
export const MAX_PIXEL_RATIO = 2;

export const MAP_ARIA_LABEL =
  'Interactive campus map. Use arrow keys to pan and plus or minus to zoom. Every place on it can also be found with search and the place list.';

/**
 * The campus map. Created once per mount; later prop changes are applied
 * incrementally (setData, feature-state, paint/filter/layout setters), so a
 * route or location update never rebuilds the style and never re-renders
 * React per animation frame.
 */
export function MapView(props: MapViewProps) {
  const {
    data,
    theme,
    mode3d,
    reducedMotion,
    visibleGroups,
    showLabels,
    selectedPlaceId,
    route,
    userLocation,
    studioModels = NO_STUDIO_MODELS,
    studioOpen = false,
    showDetectedFootprints = false,
    detections = null,
    showNearbyOutsideCampus = false,
    contextPlaces,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [r3d, setR3d] = useState<Realistic3DHandle | null>(null);
  const [inlineNotice, setInlineNotice] = useState<RenderNotice | null>(null);
  const toast = useContext(ToastContext);

  const footprintIds = useMemo(
    () => new Set(data.buildings.features.map((f) => f.properties.id)),
    [data.buildings],
  );
  const anchored = useMemo(
    () => anchoredOrganizations(data.places, data.relations),
    [data.places, data.relations],
  );
  // Off-campus places join the markers only while "Nearby, outside campus" is on (owner decision 2).
  const places = useMemo(
    () =>
      poiCollection(
        showNearbyOutsideCampus && contextPlaces ? [...data.places, ...contextPlaces] : data.places,
        footprintIds,
        anchored,
        { includeOffCampus: showNearbyOutsideCampus },
      ),
    [data.places, contextPlaces, showNearbyOutsideCampus, footprintIds, anchored],
  );
  const detectionAttribution = useMemo(
    () => detectionAttributionHtml(data.manifest.sources),
    [data.manifest.sources],
  );
  const poiIds = useMemo(() => new Set(places.features.map((f) => f.properties.id)), [places]);
  // Selecting a place without its own marker highlights the building / place it is in.
  const containingBuilding = useMemo(() => {
    const m = new Map<string, string>(anchored);
    for (const p of data.places) if (p.buildingId) m.set(p.id, p.buildingId);
    return m;
  }, [data.places, anchored]);
  const routeGeo = useMemo(() => routeCollection(route), [route]);
  const userGeo = useMemo(() => userLocationCollection(userLocation), [userLocation]);
  const groupKey = groupsKey(visibleGroups);

  // Realistic-3D degradation notices: the parent's handler, else a toast, else an inline notice.
  const showNotice = (notice: RenderNotice) => {
    const p = latest.current.props;
    if (p.onRenderNotice) p.onRenderNotice(notice);
    else if (toast) toast.show({ message: notice.message, tone: 'warning', durationMs: 10000 });
    else setInlineNotice(notice);
  };

  // Latest props/derivations for event handlers registered once at creation.
  const latest = useRef({ props, places, routeGeo, userGeo, showNotice });
  useEffect(() => {
    latest.current = { props, places, routeGeo, userGeo, showNotice };
  });

  // What the live map currently shows, so each effect only touches the map on a real change.
  const applied = useRef({
    boundary: data.boundary as unknown,
    basemap: data.basemap as unknown,
    buildings: data.buildings as unknown,
    places: places as unknown,
    route: routeGeo as unknown,
    user: userGeo as unknown,
    theme,
    mode3d,
    groupKey,
    showLabels,
    selection: null as SelectionTarget | null,
  });

  useEffect(() => {
    const container = containerRef.current;
    const { props: p, places: initialPlaces, routeGeo: initialRoute, userGeo: initialUser } = latest.current;
    if (!container) return;
    if (!supportsWebGL()) {
      p.onError?.(MAP_MESSAGES.webglUnavailable);
      return;
    }
    // The style built below is the new baseline for incremental updates.
    applied.current = {
      boundary: p.data.boundary,
      basemap: p.data.basemap,
      buildings: p.data.buildings,
      places: initialPlaces,
      route: initialRoute,
      user: initialUser,
      theme: p.theme,
      mode3d: p.mode3d,
      groupKey: groupsKey(p.visibleGroups),
      showLabels: p.showLabels,
      selection: null,
    };
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container,
        style: buildMapStyle({
          data: p.data,
          theme: p.theme,
          mode3d: p.mode3d,
          visibleGroups: p.visibleGroups,
          showLabels: p.showLabels,
          places: initialPlaces,
          route: initialRoute,
          userLocation: initialUser,
          glyphs: glyphsUrl(import.meta.env.BASE_URL, window.location.href),
        }),
        center: APP_CONFIG.map.center,
        zoom: APP_CONFIG.map.zoom,
        minZoom: APP_CONFIG.map.minZoom,
        maxZoom: APP_CONFIG.map.maxZoom,
        maxBounds: APP_CONFIG.map.maxBounds,
        pixelRatio: Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
        pitch: p.mode3d ? APP_CONFIG.map.pitch3d : 0,
        bearing: p.mode3d ? APP_CONFIG.map.bearing3d : 0,
        dragRotate: p.mode3d,
        touchPitch: p.mode3d,
        // Only governs gesture inertia: MapLibre stores it as a process-wide flag at construction.
        // Camera moves follow the live reducedMotion prop instead (controller / setBuildingMode).
        reduceMotion: p.reducedMotion,
        attributionControl: { customAttribution: OSM_ATTRIBUTION_HTML },
        locale: { 'Map.Title': MAP_ARIA_LABEL },
      });
    } catch {
      p.onError?.(MAP_MESSAGES.webglUnavailable);
      return;
    }

    const report = (message: string | null) => {
      if (message) latest.current.props.onError?.(message);
    };
    instance.on('error', (e) => report(classifyMapError(e as Parameters<typeof classifyMapError>[0])));
    instance.on('webglcontextlost', () => report(MAP_MESSAGES.contextLost));

    instance.on('click', (e) => {
      const cb = latest.current.props;
      const id = pickPlaceId(instance, e.point);
      if (id) {
        cb.onSelectPlace(id);
        return;
      }
      cb.onSelectPlace(null);
      cb.onMapClick?.([e.lngLat.lng, e.lngLat.lat]);
    });
    // Only gestures carry an originalEvent; programmatic camera moves (follow-me) do not.
    instance.on('dragstart', () => latest.current.props.onUserPan?.());
    instance.on('movestart', (e: { originalEvent?: Event }) => {
      const ev = e.originalEvent;
      if (ev instanceof KeyboardEvent && ev.key.startsWith('Arrow')) latest.current.props.onUserPan?.();
    });
    const canvas = instance.getCanvas();
    const pickable = [...POI_LAYER_IDS, ...BUILDING_PICK_LAYER_IDS];
    instance.on('mouseenter', pickable, () => {
      canvas.style.cursor = 'pointer';
    });
    instance.on('mouseleave', pickable, () => {
      canvas.style.cursor = '';
    });

    let uninstallHooks = () => {};
    let realistic: Realistic3DHandle | null = null;
    instance.once('load', () => {
      realistic = attachRealistic3D(instance, {
        theme: latest.current.props.theme,
        mode3d: latest.current.props.mode3d,
        onNotice: (n) => latest.current.showNotice(n),
      });
      const controller = createMapController(instance, {
        reducedMotion: () => latest.current.props.reducedMotion,
        mode3d: () => latest.current.props.mode3d,
      });
      uninstallHooks = installMapTestHooks({
        getCamera: () => controller.getCamera(),
        getSelectedId: () => latest.current.props.selectedPlaceId,
        getRouteCoordinateCount: () => routeCoordinateCount(latest.current.props.route),
        isStyleLoaded: () => Boolean(instance.isStyleLoaded()),
        queryRenderedBuildingIds: () => renderedBuildingIds(instance),
        getLayerVisibility: (id) =>
          instance.getLayer(id)
            ? instance.getLayoutProperty(id, 'visibility') === 'none'
              ? 'none'
              : 'visible'
            : null,
        isUserLocationShown: () => {
          const loc = latest.current.props.userLocation;
          return loc !== null && isValidLngLat(loc.lngLat);
        },
        projectToViewport: (lngLat) => {
          if (!isValidLngLat(lngLat)) return null;
          const point = instance.project(lngLat);
          const rect = instance.getCanvas().getBoundingClientRect();
          return { x: rect.left + point.x, y: rect.top + point.y };
        },
        getRealistic3D: () => realistic?.debug() ?? null,
      });
      setR3d(realistic);
      setMap(instance);
      latest.current.props.onReady?.(controller);
    });

    return () => {
      uninstallHooks();
      realistic?.dispose();
      setR3d(null);
      setMap(null);
      instance.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const a = applied.current;
    const updates: Array<[keyof typeof a, string, unknown]> = [
      ['boundary', SOURCE_IDS.boundary, data.boundary],
      ['basemap', SOURCE_IDS.basemap, data.basemap],
      ['buildings', SOURCE_IDS.buildings, data.buildings],
      ['places', SOURCE_IDS.places, places],
      ['route', SOURCE_IDS.route, routeGeo],
      ['user', SOURCE_IDS.userLocation, userGeo],
    ];
    for (const [key, sourceId, value] of updates) {
      if (a[key] === value) continue;
      setSourceData(map, sourceId, value);
      (a as Record<string, unknown>)[key] = value;
    }
  }, [map, data.boundary, data.basemap, data.buildings, places, routeGeo, userGeo]);

  useEffect(() => {
    const a = applied.current;
    if (!map || a.theme === theme) return;
    applyTheme(map, theme);
    r3d?.setTheme(theme);
    a.theme = theme;
  }, [map, r3d, theme]);

  useEffect(() => {
    const a = applied.current;
    if (!map || a.groupKey === groupKey) return;
    // groupKey stands for visibleGroups, so a new Set with equal members is a no-op.
    applyVisibleGroups(map, latest.current.props.visibleGroups);
    a.groupKey = groupKey;
  }, [map, groupKey]);

  useEffect(() => {
    const a = applied.current;
    if (!map || a.showLabels === showLabels) return;
    applyShowLabels(map, showLabels);
    a.showLabels = showLabels;
  }, [map, showLabels]);

  useEffect(() => {
    const a = applied.current;
    if (!map || a.mode3d === mode3d) return;
    setBuildingMode(map, mode3d, { reducedMotion });
    r3d?.setMode3d(mode3d);
    a.mode3d = mode3d;
  }, [map, r3d, mode3d, reducedMotion]);

  // Realistic 3D: studio models, opt-in layers, selection highlight on the custom layer.
  useEffect(() => {
    r3d?.setStudioModels(studioModels);
  }, [r3d, studioModels]);
  useEffect(() => {
    r3d?.setStudioOpen(studioOpen);
  }, [r3d, studioOpen]);
  useEffect(() => {
    r3d?.setSelected(selectedPlaceId);
  }, [r3d, selectedPlaceId]);
  useEffect(() => {
    r3d?.setDetections(showDetectedFootprints && detections !== null, detections, detectionAttribution);
  }, [r3d, showDetectedFootprints, detections, detectionAttribution]);
  useEffect(() => {
    r3d?.setNearbyOutsideCampus(showNearbyOutsideCampus);
  }, [r3d, showNearbyOutsideCampus]);

  useEffect(() => {
    if (!map) return;
    const a = applied.current;
    const next = selectionTarget(selectedPlaceId, { footprintIds, poiIds, containingBuilding });
    if (a.selection?.source === next?.source && a.selection?.id === next?.id) return;
    applySelection(map, a.selection, next);
    a.selection = next;
  }, [map, selectedPlaceId, footprintIds, poiIds, containingBuilding]);

  return (
    <div className={props.className ?? 'relative h-full w-full'}>
      <div ref={containerRef} className="h-full w-full" data-testid="atlas-map" />
      {inlineNotice ? (
        <div
          role="status"
          className="absolute inset-x-3 top-3 z-(--ds-z-controls) mx-auto flex max-w-md items-start gap-2 rounded-lg border border-border bg-surface-raised p-3 text-sm text-text shadow-2"
        >
          <p className="min-w-0 flex-1">{inlineNotice.message}</p>
          <button
            type="button"
            className="min-h-11 rounded-md px-2 font-medium text-muted focus-visible:outline-2 focus-visible:outline-focus"
            onClick={() => setInlineNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
