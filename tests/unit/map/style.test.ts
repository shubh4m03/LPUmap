import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { LAYER_GROUPS, type LayerGroupId } from '../../../src/config/categories.ts';
import {
  buildMapStyle,
  glyphsUrl,
  LABEL_LAYER_IDS,
  LABEL_SORT_KEY,
  LAYER_IDS,
  poiCollection,
  routeCollection,
  SOURCE_IDS,
  userLocationCollection,
} from '../../../src/map/index.ts';
import { groupFilter } from '../../../src/map/overlay-layers.ts';
import { evalFilter } from './style-eval.ts';
import { syntheticCampusData } from './synthetic-campus-data.ts';

const ALL_GROUPS = new Set<LayerGroupId>(LAYER_GROUPS.map((g) => g.id));

function style(
  over: { showLabels?: boolean; mode3d?: boolean; groups?: Set<LayerGroupId> } = {},
): StyleSpecification {
  const data = syntheticCampusData();
  return buildMapStyle({
    data,
    theme: 'light',
    mode3d: over.mode3d ?? false,
    visibleGroups: over.groups ?? ALL_GROUPS,
    showLabels: over.showLabels ?? true,
    places: poiCollection(data.places, new Set(data.buildings.features.map((f) => f.properties.id))),
    route: routeCollection(null),
    userLocation: userLocationCollection(null),
    glyphs: glyphsUrl('/', 'http://localhost:5173/'),
  });
}

const layer = (s: StyleSpecification, id: string): LayerSpecification & { filter?: FilterSpecification } => {
  const l = s.layers.find((x) => x.id === id);
  if (!l) throw new Error(`missing layer ${id}`);
  return l;
};
const indexOf = (s: StyleSpecification, id: string) => s.layers.findIndex((l) => l.id === id);

describe('buildMapStyle', () => {
  it('is a valid MapLibre style according to the official validator', () => {
    expect(validateStyleMin(style())).toEqual([]);
    expect(validateStyleMin(style({ mode3d: true, showLabels: false, groups: new Set() }))).toEqual([]);
    // Guard against a validator that silently accepts anything.
    const broken = style();
    broken.layers.push({
      id: 'bad',
      type: 'line',
      source: 'nope',
      paint: { 'line-colour': '#000' },
    } as never);
    expect(validateStyleMin(broken).length).toBeGreaterThan(0);
  });

  it('uses only our six GeoJSON sources — no tiles, no remote URLs, no API keys', () => {
    const s = style();
    expect(Object.keys(s.sources).sort()).toEqual(Object.values(SOURCE_IDS).sort());
    for (const src of Object.values(s.sources)) {
      expect(src.type).toBe('geojson');
      expect(src).not.toHaveProperty('tiles');
      expect(src).not.toHaveProperty('url');
    }
    expect(s.sprite).toBeUndefined();
    expect(JSON.stringify(s)).not.toMatch(/key=|access_token|api\.maptiler|mapbox\.com/i);
  });

  it('self-hosts glyphs under BASE_URL', () => {
    expect(style().glyphs).toBe('http://localhost:5173/fonts/{fontstack}/{range}.pbf');
  });

  it('promotes the place id for feature-state on buildings and places', () => {
    const s = style();
    expect(s.sources[SOURCE_IDS.buildings]).toMatchObject({ promoteId: 'id' });
    expect(s.sources[SOURCE_IDS.places]).toMatchObject({ promoteId: 'id' });
  });

  it('every layer id is unique and every source reference exists', () => {
    const s = style();
    const ids = s.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of s.layers) {
      if ('source' in l && typeof l.source === 'string') expect(s.sources).toHaveProperty(l.source);
    }
  });

  it('draws layers in cartographic order', () => {
    const s = style();
    const order = [
      LAYER_IDS.background,
      LAYER_IDS.campusFill,
      LAYER_IDS.landuse,
      LAYER_IDS.green,
      LAYER_IDS.waterFill,
      LAYER_IDS.pitch,
      LAYER_IDS.parking,
      LAYER_IDS.roadCasing,
      LAYER_IDS.road,
      LAYER_IDS.path,
      LAYER_IDS.steps,
      LAYER_IDS.campusOutline,
      LAYER_IDS.buildingFill,
      LAYER_IDS.buildingOutline,
      LAYER_IDS.buildingExtrusion,
      LAYER_IDS.routeAlternative,
      LAYER_IDS.routeCasing,
      LAYER_IDS.routeCompleted,
      LAYER_IDS.routeLine,
      LAYER_IDS.userAccuracyFill,
      LAYER_IDS.poiCircle,
      LAYER_IDS.labelRoad,
      LAYER_IDS.labelPoi,
      LAYER_IDS.labelBuilding,
      LAYER_IDS.userDot,
    ];
    const positions = order.map((id) => indexOf(s, id));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(indexOf(s, LAYER_IDS.background)).toBe(0);
    // Every casing below every road fill so junctions do not show casing seams.
    const casings = [LAYER_IDS.serviceCasing, LAYER_IDS.roadCasing, LAYER_IDS.roadMajorCasing].map((id) =>
      indexOf(s, id),
    );
    const fills = [LAYER_IDS.service, LAYER_IDS.road, LAYER_IDS.roadMajor].map((id) => indexOf(s, id));
    expect(Math.max(...casings)).toBeLessThan(Math.min(...fills));
  });

  it('distinguishes paths (dashed) and steps (ladder dash) from roads', () => {
    const s = style();
    const path = layer(s, LAYER_IDS.path);
    const steps = layer(s, LAYER_IDS.steps);
    const road = layer(s, LAYER_IDS.road);
    expect(path.paint).toHaveProperty('line-dasharray');
    expect(steps.paint).toHaveProperty('line-dasharray');
    expect(road.paint).not.toHaveProperty('line-dasharray');
    expect(evalFilter(path.filter, { properties: { layer: 'path' }, geometryType: 'LineString' })).toBe(true);
    expect(evalFilter(path.filter, { properties: { layer: 'road' }, geometryType: 'LineString' })).toBe(
      false,
    );
    expect(evalFilter(steps.filter, { properties: { layer: 'steps' }, geometryType: 'LineString' })).toBe(
      true,
    );
  });

  it('fills only polygon geometry for area layers', () => {
    const green = layer(style(), LAYER_IDS.green);
    expect(evalFilter(green.filter, { properties: { layer: 'green' }, geometryType: 'Polygon' })).toBe(true);
    expect(evalFilter(green.filter, { properties: { layer: 'green' }, geometryType: 'LineString' })).toBe(
      false,
    );
  });

  it('labels: minzoom from config, collision priority buildings > POIs > roads, only named features', () => {
    const s = style();
    for (const id of LABEL_LAYER_IDS) expect(layer(s, id).minzoom).toBe(APP_CONFIG.map.labelMinZoom);
    expect(LABEL_SORT_KEY.building).toBeLessThan(LABEL_SORT_KEY.poi);
    expect(LABEL_SORT_KEY.poi).toBeLessThan(LABEL_SORT_KEY.road);
    // Placement runs top layer first, so stack order must agree with the sort keys.
    expect(indexOf(s, LAYER_IDS.labelBuilding)).toBeGreaterThan(indexOf(s, LAYER_IDS.labelPoi));
    expect(indexOf(s, LAYER_IDS.labelPoi)).toBeGreaterThan(indexOf(s, LAYER_IDS.labelRoad));
    const b = layer(s, LAYER_IDS.labelBuilding);
    expect(evalFilter(b.filter, { properties: { name: 'Test Hall Alpha' }, geometryType: 'Polygon' })).toBe(
      true,
    );
    expect(evalFilter(b.filter, { properties: { name: null }, geometryType: 'Polygon' })).toBe(false);
    expect(evalFilter(b.filter, { properties: {}, geometryType: 'Polygon' })).toBe(false);
  });

  it('toggles every label layer with showLabels', () => {
    const on = style({ showLabels: true });
    const off = style({ showLabels: false });
    for (const id of LABEL_LAYER_IDS) {
      expect(layer(on, id).layout).toMatchObject({ visibility: 'visible' });
      expect(layer(off, id).layout).toMatchObject({ visibility: 'none' });
    }
  });

  it('starts with extrusions hidden in 2D and visible in 3D', () => {
    expect(layer(style({ mode3d: false }), LAYER_IDS.buildingExtrusion).layout).toMatchObject({
      visibility: 'none',
    });
    expect(layer(style({ mode3d: true }), LAYER_IDS.buildingExtrusion).layout).toMatchObject({
      visibility: 'visible',
    });
  });

  it('filters POI markers and POI labels by visible groups', () => {
    const s = style({ groups: new Set<LayerGroupId>(['food']) });
    const circle = layer(s, LAYER_IDS.poiCircle);
    const label = layer(s, LAYER_IDS.labelPoi);
    expect(evalFilter(circle.filter, { properties: { group: 'food' } })).toBe(true);
    expect(evalFilter(circle.filter, { properties: { group: 'finance' } })).toBe(false);
    expect(evalFilter(label.filter, { properties: { group: 'food', name: 'Test Cafe' } })).toBe(true);
    expect(evalFilter(label.filter, { properties: { group: 'food' } })).toBe(false);
    expect(evalFilter(label.filter, { properties: { group: 'finance', name: 'X' } })).toBe(false);
  });
});

describe('groupFilter', () => {
  it('hides everything for an empty set and is independent of insertion order', () => {
    expect(evalFilter(groupFilter(new Set()), { properties: { group: 'food' } })).toBe(false);
    expect(groupFilter(new Set<LayerGroupId>(['food', 'health']))).toEqual(
      groupFilter(new Set<LayerGroupId>(['health', 'food'])),
    );
  });
});

describe('glyphsUrl', () => {
  it('respects BASE_URL and keeps the template tokens unencoded', () => {
    expect(glyphsUrl('/', 'https://atlas.example/')).toBe(
      'https://atlas.example/fonts/{fontstack}/{range}.pbf',
    );
    expect(glyphsUrl('/lpu-atlas/', 'https://user.github.io/lpu-atlas/?e2e=1')).toBe(
      'https://user.github.io/lpu-atlas/fonts/{fontstack}/{range}.pbf',
    );
    expect(glyphsUrl('./', 'https://h.example/a/b/index.html')).toBe(
      'https://h.example/a/b/fonts/{fontstack}/{range}.pbf',
    );
    expect(glyphsUrl('/sub', 'https://h.example/')).toBe(
      'https://h.example/sub/fonts/{fontstack}/{range}.pbf',
    );
  });
});
