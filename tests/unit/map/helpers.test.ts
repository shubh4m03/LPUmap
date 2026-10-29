import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySelection,
  applyShowLabels,
  applyTheme,
  applyVisibleGroups,
  groupsKey,
  selectionTarget,
  type ApplyMap,
} from '../../../src/map/apply.ts';
import {
  classifyMapError,
  isE2EMode,
  LABEL_LAYER_IDS,
  LAYER_IDS,
  MAP_MESSAGES,
} from '../../../src/map/index.ts';
import { pickPlaceId, renderedBuildingIds, type PickMap } from '../../../src/map/picking.ts';
import { installMapTestHooks, type AtlasMapTestHooks } from '../../../src/map/test-hooks.ts';
import { MAP_THEME_COLORS } from '../../../src/styles/map-theme-colors.ts';
import { evalFilter } from './style-eval.ts';

describe('classifyMapError', () => {
  it('ignores missing glyph ranges (they only blank exotic characters)', () => {
    expect(
      classifyMapError({
        error: { message: 'Not Found', url: 'http://x/fonts/Noto Sans Regular/2304-2559.pbf' },
      }),
    ).toBeNull();
    expect(classifyMapError({ error: { message: 'Unable to load glyph range 9, 2304-2559' } })).toBeNull();
  });

  it('reports source and style errors without leaking URLs', () => {
    const msg = classifyMapError({
      error: { message: 'boom', url: 'http://secret/x.json' },
      sourceId: 'places',
    });
    expect(msg).toBe(MAP_MESSAGES.dataError);
    expect(classifyMapError({ error: { message: 'layer bad' } })).toBe(MAP_MESSAGES.styleError);
    expect(classifyMapError({})).toBe(MAP_MESSAGES.styleError);
    for (const m of Object.values(MAP_MESSAGES)) expect(m).not.toMatch(/https?:|\d+\.\d{3,}/);
  });
});

function pickMap(hits: Record<string, Array<{ properties: Record<string, unknown> }>>, layers: string[]) {
  return {
    getLayer: vi.fn((id: string) => (layers.includes(id) ? { id } : undefined)),
    queryRenderedFeatures: vi.fn((_g: unknown, opts?: { layers?: string[] }) =>
      (opts?.layers ?? (_g as { layers: string[] }).layers).flatMap((l) => hits[l] ?? []),
    ),
  };
}

describe('pickPlaceId', () => {
  const all = [LAYER_IDS.poiCircle, LAYER_IDS.buildingExtrusion, LAYER_IDS.buildingFill];

  it('prefers a POI marker over the building beneath it, using a touch-sized box', () => {
    const m = pickMap(
      {
        [LAYER_IDS.poiCircle]: [{ properties: { id: 'osm:node/1' } }],
        [LAYER_IDS.buildingFill]: [{ properties: { id: 'osm:way/2' } }],
      },
      all,
    );
    expect(pickPlaceId(m as unknown as PickMap, { x: 100, y: 50 })).toBe('osm:node/1');
    expect(m.queryRenderedFeatures.mock.calls[0]?.[0]).toEqual([
      [92, 42],
      [108, 58],
    ]);
  });

  it('falls back to buildings, then to null for empty map', () => {
    const m = pickMap({ [LAYER_IDS.buildingFill]: [{ properties: { id: 'osm:way/2' } }] }, all);
    expect(pickPlaceId(m as unknown as PickMap, { x: 1, y: 1 })).toBe('osm:way/2');
    expect(pickPlaceId(pickMap({}, all) as unknown as PickMap, { x: 1, y: 1 })).toBeNull();
  });

  it('never queries layers that do not exist and skips features without an id', () => {
    const m = pickMap(
      { [LAYER_IDS.buildingFill]: [{ properties: {} }, { properties: { id: 'osm:way/3' } }] },
      [LAYER_IDS.buildingFill],
    );
    expect(pickPlaceId(m as unknown as PickMap, { x: 1, y: 1 })).toBe('osm:way/3');
    for (const call of m.queryRenderedFeatures.mock.calls) {
      expect((call[1] as { layers: string[] }).layers).toEqual([LAYER_IDS.buildingFill]);
    }
  });

  it('renderedBuildingIds returns unique sorted ids', () => {
    const m = pickMap(
      {
        [LAYER_IDS.buildingFill]: [
          { properties: { id: 'b' } },
          { properties: { id: 'a' } },
          { properties: { id: 'b' } },
        ],
      },
      [LAYER_IDS.buildingFill],
    );
    expect(renderedBuildingIds(m as unknown as PickMap)).toEqual(['a', 'b']);
    expect(renderedBuildingIds(pickMap({}, []) as unknown as PickMap)).toEqual([]);
  });
});

function applyMap(existing: Set<string> | 'all' = 'all') {
  return {
    getLayer: vi.fn((id: string) => (existing === 'all' || existing.has(id) ? { id } : undefined)),
    getSource: vi.fn(),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
  };
}

describe('apply helpers', () => {
  it('applyTheme sets dark paint values on existing layers only', () => {
    const m = applyMap(new Set([LAYER_IDS.background, LAYER_IDS.labelBuilding]));
    applyTheme(m as unknown as ApplyMap, 'dark');
    expect(m.setPaintProperty).toHaveBeenCalledWith(
      LAYER_IDS.background,
      'background-color',
      MAP_THEME_COLORS.dark.background,
    );
    expect(m.setPaintProperty).toHaveBeenCalledWith(
      LAYER_IDS.labelBuilding,
      'text-color',
      MAP_THEME_COLORS.dark.labelText,
    );
    const touched = new Set(m.setPaintProperty.mock.calls.map((c) => c[0]));
    expect([...touched].sort()).toEqual([LAYER_IDS.background, LAYER_IDS.labelBuilding].sort());
    expect(m.setFilter).not.toHaveBeenCalled();
    expect(m.setLayoutProperty).not.toHaveBeenCalled();
  });

  it('applyVisibleGroups refilters POI circles and POI labels', () => {
    const m = applyMap();
    applyVisibleGroups(m as unknown as ApplyMap, new Set(['health']));
    expect(m.setFilter).toHaveBeenCalledTimes(2);
    const labelFilter = m.setFilter.mock.calls.find((c) => c[0] === LAYER_IDS.labelPoi)?.[1];
    expect(evalFilter(labelFilter, { properties: { group: 'health', name: 'Clinic' } })).toBe(true);
    expect(evalFilter(labelFilter, { properties: { group: 'health' } })).toBe(false);
  });

  it('applyShowLabels toggles every label layer', () => {
    const m = applyMap();
    applyShowLabels(m as unknown as ApplyMap, false);
    expect(m.setLayoutProperty.mock.calls).toEqual(LABEL_LAYER_IDS.map((id) => [id, 'visibility', 'none']));
  });

  it('applySelection clears the previous feature-state before setting the next', () => {
    const m = applyMap();
    const a = { source: 'buildings', id: 'osm:way/1' };
    const b = { source: 'places', id: 'osm:node/2' };
    applySelection(m as unknown as ApplyMap, null, a);
    applySelection(m as unknown as ApplyMap, a, b);
    applySelection(m as unknown as ApplyMap, b, null);
    expect(m.setFeatureState.mock.calls).toEqual([
      [a, { selected: true }],
      [b, { selected: true }],
    ]);
    expect(m.removeFeatureState.mock.calls).toEqual([
      [a, 'selected'],
      [b, 'selected'],
    ]);
  });

  it('selectionTarget resolves footprint, marker, then containing building, else nothing', () => {
    const idx = {
      footprintIds: new Set(['osm:way/1']),
      poiIds: new Set(['osm:node/2']),
      containingBuilding: new Map([
        ['cur:dept', 'osm:way/1'],
        ['cur:orphan', 'osm:way/999'],
      ]),
    };
    expect(selectionTarget('osm:way/1', idx)).toEqual({ source: 'buildings', id: 'osm:way/1' });
    expect(selectionTarget('osm:node/2', idx)).toEqual({ source: 'places', id: 'osm:node/2' });
    expect(selectionTarget('cur:dept', idx)).toEqual({ source: 'buildings', id: 'osm:way/1' });
    // A building id that has no footprint on the map is never highlighted.
    expect(selectionTarget('cur:orphan', idx)).toBeNull();
    expect(selectionTarget('cur:unknown', idx)).toBeNull();
    expect(selectionTarget(null, idx)).toBeNull();
    // An anchored organisation without its own marker highlights its host marker.
    const anchored = { ...idx, containingBuilding: new Map([['cur:school', 'osm:node/2']]) };
    expect(selectionTarget('cur:school', anchored)).toEqual({ source: 'places', id: 'osm:node/2' });
  });

  it('groupsKey ignores insertion order', () => {
    expect(groupsKey(new Set(['food', 'health']))).toBe(groupsKey(new Set(['health', 'food'])));
    expect(groupsKey(new Set())).toBe('');
  });
});

describe('e2e test hooks', () => {
  const hooks: AtlasMapTestHooks = {
    getCamera: () => ({
      center: [0, 0],
      zoom: 1,
      pitch: 0,
      bearing: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
    getSelectedId: () => null,
    getRouteCoordinateCount: () => 0,
    isStyleLoaded: () => true,
    queryRenderedBuildingIds: () => [],
    getLayerVisibility: () => null,
    isUserLocationShown: () => false,
    projectToViewport: () => null,
    getRealistic3D: () => null,
  };
  afterEach(() => {
    delete window.__ATLAS_MAP__;
  });

  it('only activates with the e2e=1 query flag', () => {
    expect(isE2EMode('?e2e=1')).toBe(true);
    expect(isE2EMode('?x=2&e2e=1')).toBe(true);
    expect(isE2EMode('?e2e=0')).toBe(false);
    expect(isE2EMode('')).toBe(false);
    installMapTestHooks(hooks, '');
    expect(window.__ATLAS_MAP__).toBeUndefined();
  });

  it('installs a frozen, read-only object with no location data, and uninstalls it', () => {
    const uninstall = installMapTestHooks(hooks, '?e2e=1');
    const api = window.__ATLAS_MAP__;
    expect(api).toBeDefined();
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api!).sort()).toEqual(
      [
        'getCamera',
        'getLayerVisibility',
        'getRealistic3D',
        'getRouteCoordinateCount',
        'getSelectedId',
        'isStyleLoaded',
        'isUserLocationShown',
        'projectToViewport',
        'queryRenderedBuildingIds',
      ].sort(),
    );
    uninstall();
    expect(window.__ATLAS_MAP__).toBeUndefined();
  });
});
