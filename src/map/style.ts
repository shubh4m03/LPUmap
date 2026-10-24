/**
 * Assembles the complete MapLibre style from our own GeoJSON. Built once when
 * the map is created; afterwards MapView updates sources with setData and
 * individual properties with setters, never by rebuilding the style.
 */
import type { FeatureCollection } from 'geojson';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import {
  buildingExtrusionLayers,
  buildingFootprintLayers,
  lightSpecification,
} from '../buildings3d/index.ts';
import type { LayerGroupId } from '../config/categories.ts';
import type { CampusData } from '../data/campus-data.ts';
import { basemapLayers } from './basemap-layers.ts';
import { SOURCE_IDS } from './ids.ts';
import { overlayLayers } from './overlay-layers.ts';
import type { MapTheme } from './theme-colors.ts';

export const OSM_ATTRIBUTION_HTML =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors (ODbL)</a>';

/**
 * Self-hosted glyph URL template. Resolved to an absolute URL because glyph
 * requests may be issued from a worker, where a relative URL would resolve
 * against the worker's blob: URL. Braces are appended after resolution so
 * URL parsing cannot percent-encode the `{fontstack}`/`{range}` tokens.
 */
export function glyphsUrl(baseUrl: string, pageHref: string): string {
  const base = new URL(baseUrl, pageHref).href;
  return `${base.endsWith('/') ? base : `${base}/`}fonts/{fontstack}/{range}.pbf`;
}

export interface StyleLayerOptions {
  theme: MapTheme;
  mode3d: boolean;
  visibleGroups: ReadonlySet<LayerGroupId>;
  showLabels: boolean;
}

/** Every layer in drawing order (bottom first). */
export function buildLayers(opts: StyleLayerOptions): LayerSpecification[] {
  return [
    ...basemapLayers(opts.theme),
    ...buildingFootprintLayers(opts.theme, { mode3d: opts.mode3d }),
    ...buildingExtrusionLayers(opts.theme, { mode3d: opts.mode3d }),
    ...overlayLayers(opts.theme, opts),
  ];
}

export interface StyleSourceData {
  data: CampusData;
  places: FeatureCollection;
  route: FeatureCollection;
  userLocation: FeatureCollection;
}

export function buildMapStyle(
  opts: StyleLayerOptions & StyleSourceData & { glyphs: string },
): StyleSpecification {
  const { data } = opts;
  return {
    version: 8,
    name: 'LPU Campus Atlas',
    glyphs: opts.glyphs,
    // Map-anchored light: façade shading stays tied to the ground while the camera rotates (D1).
    light: lightSpecification(opts.theme),
    sources: {
      [SOURCE_IDS.boundary]: { type: 'geojson', data: data.boundary as FeatureCollection },
      [SOURCE_IDS.basemap]: { type: 'geojson', data: data.basemap as FeatureCollection },
      [SOURCE_IDS.buildings]: { type: 'geojson', data: data.buildings as FeatureCollection, promoteId: 'id' },
      [SOURCE_IDS.places]: { type: 'geojson', data: opts.places, promoteId: 'id' },
      [SOURCE_IDS.route]: { type: 'geojson', data: opts.route },
      [SOURCE_IDS.userLocation]: { type: 'geojson', data: opts.userLocation },
    },
    layers: buildLayers(opts),
  };
}
