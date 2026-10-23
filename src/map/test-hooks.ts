/**
 * Read-only Playwright hook, installed only when the page URL carries `e2e=1`:
 *
 *   window.__ATLAS_MAP__.getCamera()                 → { center, zoom, pitch, bearing, padding }
 *   window.__ATLAS_MAP__.getSelectedId()             → selected place id or null
 *   window.__ATLAS_MAP__.getRouteCoordinateCount()   → vertices in the drawn main route (0 = none)
 *   window.__ATLAS_MAP__.isStyleLoaded()             → boolean
 *   window.__ATLAS_MAP__.queryRenderedBuildingIds()  → sorted ids of buildings on screen
 *   window.__ATLAS_MAP__.getLayerVisibility(id)      → 'visible' | 'none' | null (no such layer)
 *   window.__ATLAS_MAP__.isUserLocationShown()       → boolean
 *   window.__ATLAS_MAP__.projectToViewport(lngLat)   → { x, y } viewport CSS px of a ground point, or null
 *
 * Privacy: it deliberately exposes no user coordinates or accuracy — only
 * whether a location marker is shown. The camera centre is the map view, not
 * the user's position.
 */
import type { LngLat } from '../data/schema.ts';
import type { MapCamera } from './types.ts';

export interface AtlasMapTestHooks {
  getCamera(): MapCamera;
  getSelectedId(): string | null;
  getRouteCoordinateCount(): number;
  isStyleLoaded(): boolean;
  queryRenderedBuildingIds(): string[];
  getLayerVisibility(id: string): 'visible' | 'none' | null;
  isUserLocationShown(): boolean;
  /** Where a caller-supplied ground coordinate is drawn (viewport CSS px), so a test can click it. */
  projectToViewport(lngLat: LngLat): { x: number; y: number } | null;
}

declare global {
  interface Window {
    __ATLAS_MAP__?: Readonly<AtlasMapTestHooks>;
  }
}

export function isE2EMode(search: string): boolean {
  return new URLSearchParams(search).get('e2e') === '1';
}

/** Installs the hook when in e2e mode; returns an uninstaller (a no-op otherwise). */
export function installMapTestHooks(hooks: AtlasMapTestHooks, search = window.location.search): () => void {
  if (!isE2EMode(search)) return () => {};
  const frozen = Object.freeze({ ...hooks });
  window.__ATLAS_MAP__ = frozen;
  return () => {
    if (window.__ATLAS_MAP__ === frozen) delete window.__ATLAS_MAP__;
  };
}
