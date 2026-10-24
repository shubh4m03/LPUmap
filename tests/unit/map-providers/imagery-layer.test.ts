/** applyImagery: raster under the overlays, basemap hidden, contrast overrides, zoom cap, clean removal. */
import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { LAYER_IDS } from '../../../src/map/ids.ts';
import { eoxSentinel2016 } from '../../../src/map/providers/eox.ts';
import { esriWorldImagery } from '../../../src/map/providers/esri.ts';
import {
  activeImageryId,
  applyImagery,
  HIDDEN_ON_IMAGERY,
  IMAGERY_LAYER_ID,
  IMAGERY_SOURCE_ID,
  imageryPaintOverrides,
  type ImageryMap,
} from '../../../src/map/providers/imagery-layer.ts';
import { buildLayers } from '../../../src/map/style.ts';

const FAKE_KEY = 'TEST_ONLY_fake_arcgis_key_0123456789abcdef';

function fakeMap() {
  const layers = buildLayers({
    theme: 'light',
    mode3d: true,
    visibleGroups: new Set(),
    showLabels: true,
  }).map((l) => l.id);
  const order = [...layers];
  const sources = new Map<string, Record<string, unknown>>();
  const layout = new Map<string, unknown>();
  const paint = new Map<string, unknown>();
  let maxZoom: number = APP_CONFIG.map.maxZoom;
  const map = {
    order,
    sources,
    layout,
    paint,
    get maxZoom() {
      return maxZoom;
    },
    getLayer: (id: string) => (order.includes(id) ? { id } : undefined),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, spec: Record<string, unknown>) => {
      sources.set(id, spec);
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    addLayer: vi.fn((layer: { id: string }, before?: string) => {
      const i = before ? order.indexOf(before) : -1;
      if (i >= 0) order.splice(i, 0, layer.id);
      else order.push(layer.id);
    }),
    removeLayer: vi.fn((id: string) => {
      order.splice(order.indexOf(id), 1);
    }),
    setLayoutProperty: vi.fn((id: string, name: string, v: unknown) => layout.set(`${id}.${name}`, v)),
    setPaintProperty: vi.fn((id: string, name: string, v: unknown) => paint.set(`${id}.${name}`, v)),
    setMaxZoom: vi.fn((z: number) => {
      maxZoom = z;
    }),
    setMaxBounds: vi.fn(),
  };
  return map as typeof map & ImageryMap;
}

describe('applyImagery', () => {
  it('does nothing at all when no imagery was ever shown', () => {
    const map = fakeMap();
    applyImagery(map, null, { theme: 'light', reducedMotion: false });
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
    expect(map.setMaxZoom).not.toHaveBeenCalled();
  });

  it('adds the raster directly above the background with the escaped attribution', () => {
    const map = fakeMap();
    applyImagery(map, esriWorldImagery(FAKE_KEY), { theme: 'light', reducedMotion: false });
    const spec = map.sources.get(IMAGERY_SOURCE_ID)!;
    expect(spec).toMatchObject({ type: 'raster', tileSize: 256, minzoom: 0, maxzoom: 19 });
    expect(String(spec.attribution)).toContain('Powered by <a href="https://www.esri.com/"');
    expect(String(spec.attribution)).toContain('Vantor');
    expect(map.order.indexOf(IMAGERY_LAYER_ID)).toBe(map.order.indexOf(LAYER_IDS.background) + 1);
    expect(activeImageryId(map)).toBe('esri-world-imagery');
  });

  it('hides our basemap fills and roads but keeps paths, steps, boundary and every overlay', () => {
    const map = fakeMap();
    applyImagery(map, esriWorldImagery(FAKE_KEY), { theme: 'dark', reducedMotion: false });
    for (const id of HIDDEN_ON_IMAGERY) expect(map.layout.get(`${id}.visibility`), id).toBe('none');
    for (const id of [
      LAYER_IDS.path,
      LAYER_IDS.steps,
      LAYER_IDS.campusOutline,
      LAYER_IDS.routeLine,
      LAYER_IDS.poiCircle,
      LAYER_IDS.labelPoi,
      LAYER_IDS.userDot,
      LAYER_IDS.buildingOutline,
      LAYER_IDS.buildingExtrusion,
    ])
      expect(map.layout.has(`${id}.visibility`), id).toBe(false);
  });

  it('applies the contrast overrides (light outlines, translucent fills, wider halos, neutral extrusions)', () => {
    const map = fakeMap();
    applyImagery(map, esriWorldImagery(FAKE_KEY), { theme: 'dark', reducedMotion: false });
    for (const [id, name, value] of imageryPaintOverrides('dark'))
      expect(map.paint.get(`${id}.${name}`)).toEqual(value);
    expect(map.paint.get(`${LAYER_IDS.labelPoi}.text-halo-width`)).toBe(2.25);
    // Extrusions on imagery use the light-theme neutral tones in both themes.
    expect(JSON.stringify(map.paint.get(`${LAYER_IDS.buildingExtrusion}.fill-extrusion-color`))).toContain(
      '#d6cbba',
    );
  });

  it('caps the camera zoom for low-detail imagery and restores it afterwards', () => {
    const map = fakeMap();
    applyImagery(map, eoxSentinel2016(true), { theme: 'light', reducedMotion: true });
    expect(map.maxZoom).toBe(14);
    expect(map.setMaxBounds).toHaveBeenLastCalledWith([75.62, 31.18, 75.79, 31.33]);
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ paint: { 'raster-fade-duration': 0 } }),
      LAYER_IDS.campusFill,
    );
    applyImagery(map, null, { theme: 'light', reducedMotion: true });
    expect(map.maxZoom).toBe(APP_CONFIG.map.maxZoom);
    expect(map.setMaxBounds).toHaveBeenLastCalledWith(APP_CONFIG.map.maxBounds);
  });

  it('removal restores the campus map exactly: layers visible, theme paint back, source gone', () => {
    const map = fakeMap();
    applyImagery(map, esriWorldImagery(FAKE_KEY), { theme: 'light', reducedMotion: false });
    applyImagery(map, null, { theme: 'light', reducedMotion: false });
    expect(map.sources.has(IMAGERY_SOURCE_ID)).toBe(false);
    expect(map.order).not.toContain(IMAGERY_LAYER_ID);
    for (const id of HIDDEN_ON_IMAGERY) expect(map.layout.get(`${id}.visibility`)).toBe('visible');
    const base = buildLayers({ theme: 'light', mode3d: false, visibleGroups: new Set(), showLabels: true });
    for (const [id, name] of imageryPaintOverrides('light')) {
      const layer = base.find((l) => l.id === id)!;
      expect(map.paint.get(`${id}.${name}`), `${id}.${name}`).toEqual(
        (layer.paint as Record<string, unknown>)[name],
      );
    }
    expect(activeImageryId(map)).toBeNull();
  });

  it('is idempotent for the same provider and swaps the source for another one', () => {
    const map = fakeMap();
    const esri = esriWorldImagery(FAKE_KEY);
    applyImagery(map, esri, { theme: 'light', reducedMotion: false });
    applyImagery(map, esri, { theme: 'dark', reducedMotion: false });
    expect(map.addSource).toHaveBeenCalledTimes(1);
    applyImagery(map, eoxSentinel2016(true), { theme: 'dark', reducedMotion: false });
    expect(map.removeSource).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(activeImageryId(map)).toBe('eox-s2cloudless-2016');
    expect(map.order.filter((id) => id === IMAGERY_LAYER_ID)).toHaveLength(1);
  });
});
