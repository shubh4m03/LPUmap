/**
 * Building layers: flat footprints (2D) and native MapLibre fill-extrusion
 * (3D). Native extrusion renders every footprint as a lit 3D prism in the same
 * WebGL pass as the basemap, which satisfies the 3D-buildings requirement
 * without a second renderer such as Three.js (no extra bundle weight, no
 * camera synchronisation, picking and feature-state for free).
 *
 * Owner-placed studio models (S1) are the one exception: while the studio
 * custom layer is healthy it draws them, `building-extrusion` leaves their
 * ids out and an invisible `studio-extrusion-pick` layer keeps them pickable.
 * When the custom layer is unavailable they fall back to this extrusion as
 * footprint × body height, in their own honest colour class.
 */
import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';
import { APP_CONFIG } from '../config/index.ts';
import type { HeightSource } from '../data/schema.ts';
import { mapThemeColors, type MapTheme, type MapThemeColors } from '../map/theme-colors.ts';
import { realistic3dColors } from './palette.ts';

export const BUILDINGS_SOURCE_ID = 'buildings';

export const BUILDING_LAYER_IDS = {
  fill: 'building-fill',
  outline: 'building-outline',
  extrusion: 'building-extrusion',
  /**
   * Invisible (opacity 0) extrusion of the studio buildings the custom layer
   * draws, so they stay pickable through footprint × body height (S1: picking
   * never uses the custom layer).
   */
  studioPick: 'studio-extrusion-pick',
} as const;

/** renderHeightSource of an owner-placed studio model (change C1 adds it to the data schema). */
export const STUDIO_HEIGHT_SOURCE = 'studio-model';

/**
 * S3 public label of an unverified studio model. Equal to
 * VERIFICATION_LABELS.unverified in src/building-studio/schema.ts (a test keeps
 * them in step); copied so the map chunk does not pull in the studio schemas.
 */
export const UNVERIFIED_MODEL_LABEL = 'Illustrative model placed by the site owner — not verified';

export interface BuildingLayerOptions {
  sourceId?: string;
  /** Initial mode; setBuildingMode() switches it later without rebuilding the style. */
  mode3d?: boolean;
  minzoom?: number;
  /** Building ids drawn by the studio custom layer instead (left out of the extrusion). */
  excludeIds?: readonly string[];
}

const SELECTED: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

/**
 * Extrusion colour per renderHeightSource (v2 render-only prop), so placeholder
 * heights are visibly different from data, and an owner-placed studio model
 * drawn as a fallback block is visibly different from both.
 */
export function extrusionColorExpression(c: MapThemeColors, studioColor: string): ExpressionSpecification {
  return [
    'case',
    SELECTED,
    c.selected,
    [
      'match',
      ['get', 'renderHeightSource'],
      'osm-height',
      c.extrusionMeasured,
      'osm-levels-estimate',
      c.extrusionEstimated,
      STUDIO_HEIGHT_SOURCE,
      studioColor,
      c.extrusionUnknown,
    ],
  ];
}

/**
 * Campus inventory only (never 'uncertain'; outside footprints and machine
 * detections are not in this source at all), minus the buildings the studio
 * custom layer draws.
 */
export function extrusionFilter(excludeIds: readonly string[] = []): FilterSpecification {
  const inventory: ExpressionSpecification = ['==', ['get', 'inCampusInventory'], true];
  if (excludeIds.length === 0) return inventory;
  return ['all', inventory, ['!', ['in', ['get', 'id'], ['literal', [...excludeIds].sort()]]]];
}

export function buildingExtrusionLayers(
  theme: MapTheme,
  opts: BuildingLayerOptions = {},
): FillExtrusionLayerSpecification[] {
  const c = mapThemeColors(theme);
  return [
    {
      id: BUILDING_LAYER_IDS.extrusion,
      type: 'fill-extrusion',
      source: opts.sourceId ?? BUILDINGS_SOURCE_ID,
      minzoom: opts.minzoom ?? APP_CONFIG.map.extrusionMinZoom,
      filter: extrusionFilter(opts.excludeIds),
      layout: { visibility: opts.mode3d ? 'visible' : 'none' },
      paint: {
        'fill-extrusion-color': extrusionColorExpression(c, realistic3dColors(theme).extrusionStudio),
        'fill-extrusion-height': ['get', 'renderHeightM'],
        'fill-extrusion-base': ['get', 'renderMinHeightM'],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },
  ];
}

/** Invisible, pickable extrusion of the studio buildings drawn by the custom layer. */
export function studioPickLayer(
  ids: readonly string[],
  opts: Pick<BuildingLayerOptions, 'sourceId' | 'minzoom' | 'mode3d'> = {},
): FillExtrusionLayerSpecification {
  return {
    id: BUILDING_LAYER_IDS.studioPick,
    type: 'fill-extrusion',
    source: opts.sourceId ?? BUILDINGS_SOURCE_ID,
    minzoom: opts.minzoom ?? APP_CONFIG.map.extrusionMinZoom,
    filter: ['in', ['get', 'id'], ['literal', [...ids].sort()]],
    layout: { visibility: opts.mode3d === false ? 'none' : 'visible' },
    paint: {
      'fill-extrusion-color': '#000000',
      'fill-extrusion-height': ['get', 'renderHeightM'],
      'fill-extrusion-base': ['get', 'renderMinHeightM'],
      // MapLibre skips drawing a layer at opacity 0, but it stays queryable (picking).
      'fill-extrusion-opacity': 0,
    },
  };
}

/**
 * Max zoom of the flat fill. In 3D the flat fill only covers zooms where
 * extrusions are hidden by their minzoom; in 2D it is shown at every zoom.
 */
export function flatFillMaxZoom(mode3d: boolean): number {
  return mode3d ? APP_CONFIG.map.extrusionMinZoom : 24;
}

export function buildingFootprintLayers(
  theme: MapTheme,
  opts: BuildingLayerOptions = {},
): Array<FillLayerSpecification | LineLayerSpecification> {
  const c = mapThemeColors(theme);
  const source = opts.sourceId ?? BUILDINGS_SOURCE_ID;
  return [
    {
      id: BUILDING_LAYER_IDS.fill,
      type: 'fill',
      source,
      maxzoom: flatFillMaxZoom(opts.mode3d ?? false),
      paint: {
        'fill-color': ['case', SELECTED, c.selected, c.buildingFill],
        'fill-opacity': ['case', SELECTED, 0.85, 1],
      },
    },
    {
      id: BUILDING_LAYER_IDS.outline,
      type: 'line',
      source,
      minzoom: 15,
      paint: {
        'line-color': ['case', SELECTED, c.selectedOutline, c.buildingOutline],
        'line-width': ['case', SELECTED, 2, 0.75],
      },
    },
  ];
}

export type BuildingLegendKey = HeightSource | typeof STUDIO_HEIGHT_SOURCE | 'detected-footprint';

export interface BuildingLegendEntry {
  /** Unique per entry (use it as the React key). */
  key: BuildingLegendKey;
  /** The data value the colour encodes; null for entries that are not a height source. */
  heightSource: HeightSource | null;
  label: string;
  description: string;
  color: string;
  /** Solid swatch, or a dashed outline (flat, unverified detections). */
  swatch: 'solid' | 'dashed';
}

export interface BuildingLegendOptions {
  /** Add the owner-placed model class (when studio buildings are published). */
  studioModels?: boolean;
  /** Add the "Unverified detected footprints" class (while that layer is on). */
  detectedFootprints?: boolean;
}

/**
 * Fidelity legend: how much of each drawn building is evidence. Only an OSM
 * `height` tag is ever called measured; floor-count heights are estimates and
 * placeholders say so. Studio models carry the S3 public label.
 */
export function buildingLegend(theme: MapTheme, opts: BuildingLegendOptions = {}): BuildingLegendEntry[] {
  const c = mapThemeColors(theme);
  const r = realistic3dColors(theme);
  const entries: BuildingLegendEntry[] = [
    {
      key: 'osm-height',
      heightSource: 'osm-height',
      label: 'Measured height',
      description: 'Height taken from the OpenStreetMap height tag.',
      color: c.extrusionMeasured,
      swatch: 'solid',
    },
    {
      key: 'osm-levels-estimate',
      heightSource: 'osm-levels-estimate',
      label: 'Estimated from floor count',
      description: `Mapped floor count × ${APP_CONFIG.map.metresPerLevel} m per floor — an estimate, not a measurement.`,
      color: c.extrusionEstimated,
      swatch: 'solid',
    },
    {
      key: 'fallback',
      heightSource: 'fallback',
      label: 'Height unknown (placeholder)',
      description: `No height or floor count is mapped; drawn at a placeholder ${APP_CONFIG.map.fallbackBuildingHeightM} m.`,
      color: c.extrusionUnknown,
      swatch: 'solid',
    },
  ];
  if (opts.studioModels)
    entries.push({
      key: STUDIO_HEIGHT_SOURCE,
      heightSource: null,
      label: 'Owner-placed model',
      description: `${UNVERIFIED_MODEL_LABEL}, unless its details say otherwise. Shape, height, roof and colours are illustrative, not measurements.`,
      color: r.extrusionStudio,
      swatch: 'solid',
    });
  if (opts.detectedFootprints)
    entries.push({
      key: 'detected-footprint',
      heightSource: null,
      label: 'Unverified detected footprint',
      description:
        'Outline detected by machine learning in imagery (Microsoft Global ML Building Footprints, Google Open Buildings). Flat, not checked on the ground and not part of the campus building list.',
      color: r.detectionOutline,
      swatch: 'dashed',
    });
  return entries;
}
