import type { RenderNotice } from '../buildings3d/realistic3d.ts';
import type { StudioRenderSource } from '../building-studio/render/maplibre/index.ts';
import type { LayerGroupId } from '../config/categories.ts';
import type { CampusData } from '../data/campus-data.ts';
import type { DetectionsFile, LngLat, Place } from '../data/schema.ts';
import type { MapTheme } from './theme-colors.ts';

export interface MapRouteOverlay {
  coordinates: LngLat[];
  /** Portion already walked; drawn muted underneath the remaining route. */
  completed?: LngLat[];
  alternatives?: LngLat[][];
}

export interface MapUserLocation {
  lngLat: LngLat;
  accuracyM: number;
  stale: boolean;
}

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapController {
  flyTo(lngLat: LngLat, zoom?: number): void;
  /** Re-centres on a moving position (follow-me), keeping zoom, pitch and bearing. */
  follow(lngLat: LngLat): void;
  fitCoordinates(coords: LngLat[], padding?: number): void;
  resetView(): void;
  zoomIn(): void;
  zoomOut(): void;
  resetNorth(): void;
  setPadding(p: MapPadding): void;
}

export interface MapCamera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
  padding: MapPadding;
}

/** Controller plus a camera read-out used by tests and the e2e hook. */
export interface MapControllerWithCamera extends MapController {
  getCamera(): MapCamera;
}

export interface MapViewProps {
  data: CampusData;
  theme: MapTheme;
  mode3d: boolean;
  reducedMotion: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>;
  showLabels: boolean;
  selectedPlaceId: string | null;
  route: MapRouteOverlay | null;
  userLocation: MapUserLocation | null;
  onSelectPlace(id: string | null): void;
  onMapClick?(lngLat: LngLat): void;
  /** The user moved the map themselves (drag or arrow keys), e.g. to stop follow-me. */
  onUserPan?(): void;
  onReady?(controller: MapController): void;
  onError?(message: string): void;
  className?: string;

  // --- Realistic 3D (all optional; absent = today's behaviour) ---
  /**
   * Published studio buildings, plus a Studio preview (preview: true). Each publicId must also be a
   * feature of the buildings source (the merge adds it), which 2D, picking and the fallback use.
   */
  studioModels?: readonly StudioRenderSource[];
  /** The Studio is open: preload the studio renderer chunk. */
  studioOpen?: boolean;
  /** Opt-in "Unverified detected footprints" layer; drawn only while true AND detections are loaded. */
  showDetectedFootprints?: boolean;
  detections?: DetectionsFile | null;
  /** Opt-in "Nearby, outside campus" layer: contextPlaces become markers with the "Outside campus" badge. */
  showNearbyOutsideCampus?: boolean;
  contextPlaces?: readonly Place[];
  /** Degradation notices (slow frames, studio fallback). Without it MapView shows a toast or an inline notice. */
  onRenderNotice?(notice: RenderNotice): void;
}
