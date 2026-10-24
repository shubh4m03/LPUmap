/**
 * MapLibre sources and layers for map editing (pure builders). Drawn above
 * the campus layers; removed entirely when editing ends. The colours are
 * fixed, high-contrast roles (the editor's panels explain each warning in
 * text, so colour is never the only cue).
 */
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { EditHandle, EditHandleKind, EditPreviewCollection, ResizeAxis } from './types.ts';

export const EDIT_SOURCE_IDS = { preview: 'edit-preview', handles: 'edit-handles' } as const;

export const EDIT_LAYER_IDS = {
  previewFill: 'edit-preview-fill',
  previewLine: 'edit-preview-line',
  previewGuide: 'edit-preview-guide',
  previewPoint: 'edit-preview-point',
  handles: 'edit-handles',
} as const;

/** In drawing order (bottom → top). */
export const EDIT_LAYER_ORDER = [
  EDIT_LAYER_IDS.previewFill,
  EDIT_LAYER_IDS.previewGuide,
  EDIT_LAYER_IDS.previewLine,
  EDIT_LAYER_IDS.previewPoint,
  EDIT_LAYER_IDS.handles,
] as const;

export const EDIT_COLORS = {
  footprint: '#2563eb',
  invalid: '#dc2626',
  guide: '#7c3aed',
  snap: '#059669',
  warning: '#d97706',
  path: '#0e7490',
  handleFill: '#ffffff',
  handleStroke: '#111827',
  rotateFill: '#fde68a',
} as const;

const role = ['get', 'role'] as ExpressionSpecification;
const roleColor: ExpressionSpecification = [
  'match',
  role,
  'footprint-invalid',
  EDIT_COLORS.invalid,
  'guide',
  EDIT_COLORS.guide,
  'snap',
  EDIT_COLORS.snap,
  'warning',
  EDIT_COLORS.warning,
  'path',
  EDIT_COLORS.path,
  EDIT_COLORS.footprint,
];
// geometry-type may report Multi* types; match both forms.
const isPolygon: ExpressionSpecification = [
  'match',
  ['geometry-type'],
  ['Polygon', 'MultiPolygon'],
  true,
  false,
];
const isPoint: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];

export function editLayers(): Array<
  FillLayerSpecification | LineLayerSpecification | CircleLayerSpecification
> {
  return [
    {
      id: EDIT_LAYER_IDS.previewFill,
      type: 'fill',
      source: EDIT_SOURCE_IDS.preview,
      filter: [
        'all',
        isPolygon,
        ['match', role, ['footprint', 'footprint-invalid', 'warning', 'snap'], true, false],
      ],
      paint: { 'fill-color': roleColor, 'fill-opacity': 0.28 },
    },
    {
      id: EDIT_LAYER_IDS.previewGuide,
      type: 'line',
      source: EDIT_SOURCE_IDS.preview,
      filter: ['==', role, 'guide'],
      paint: { 'line-color': EDIT_COLORS.guide, 'line-width': 2, 'line-dasharray': [2, 2] },
    },
    {
      id: EDIT_LAYER_IDS.previewLine,
      type: 'line',
      source: EDIT_SOURCE_IDS.preview,
      filter: ['all', ['!', isPoint], ['!=', role, 'guide']],
      paint: { 'line-color': roleColor, 'line-width': ['match', role, 'snap', 3, 2] },
    },
    {
      id: EDIT_LAYER_IDS.previewPoint,
      type: 'circle',
      source: EDIT_SOURCE_IDS.preview,
      filter: isPoint,
      paint: {
        'circle-radius': 8,
        'circle-color': roleColor,
        'circle-stroke-color': EDIT_COLORS.handleFill,
        'circle-stroke-width': 2,
      },
    },
    {
      id: EDIT_LAYER_IDS.handles,
      type: 'circle',
      source: EDIT_SOURCE_IDS.handles,
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'move', 9, 7],
        'circle-color': ['match', ['get', 'kind'], 'rotate', EDIT_COLORS.rotateFill, EDIT_COLORS.handleFill],
        'circle-stroke-color': EDIT_COLORS.handleStroke,
        'circle-stroke-width': 2,
      },
    },
  ];
}

export interface HandleFeatureProps {
  id: string;
  kind: EditHandleKind;
  axis: ResizeAxis | '';
}

export function handleCollection(
  handles: readonly EditHandle[],
): FeatureCollection<Point, HandleFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: handles.map((h) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.position[0], h.position[1]] },
      properties: { id: h.id, kind: h.kind, axis: h.axis ?? '' },
    })),
  };
}

export const EMPTY_PREVIEW: EditPreviewCollection = { type: 'FeatureCollection', features: [] };

const RESIZE_CURSOR: Record<ResizeAxis, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** CSS cursor over a handle. (Axes are in map orientation; close enough when the map is rotated.) */
export function handleCursor(
  kind: EditHandleKind,
  axis: ResizeAxis | '' | undefined,
  dragging: boolean,
): string {
  if (kind === 'resize' && axis) return RESIZE_CURSOR[axis];
  if (kind === 'rotate') return dragging ? 'grabbing' : 'grab';
  return dragging ? 'grabbing' : 'move';
}
