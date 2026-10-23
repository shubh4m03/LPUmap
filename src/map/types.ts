import type { LayerGroupId } from '../config/categories.ts';
import type { CampusData } from '../data/campus-data.ts';
import type { LngLat } from '../data/schema.ts';
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
  onReady?(controller: MapController): void;
  onError?(message: string): void;
  className?: string;
}
