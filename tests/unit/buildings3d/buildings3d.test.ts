import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILDING_LAYER_IDS,
  buildingExtrusionLayers,
  buildingFootprintLayers,
  buildingLegend,
  flatFillMaxZoom,
  resetWebGLSupportCache,
  setBuildingMode,
  supportsWebGL,
  type BuildingModeMap,
} from '../../../src/buildings3d/index.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { HeightSource } from '../../../src/data/schema.ts';
import { MAP_THEME_COLORS } from '../../../src/styles/map-theme-colors.ts';
import { evalProperty, toHex } from '../map/style-eval.ts';

const [extrusion] = buildingExtrusionLayers('light');
const ext = extrusion!;

describe('buildingExtrusionLayers', () => {
  it('extrudes from the data heights with a vertical gradient above the configured minzoom', () => {
    expect(ext.type).toBe('fill-extrusion');
    expect(ext.source).toBe('buildings');
    expect(ext.minzoom).toBe(APP_CONFIG.map.extrusionMinZoom);
    expect(ext.paint?.['fill-extrusion-height']).toEqual(['get', 'renderHeightM']);
    expect(ext.paint?.['fill-extrusion-base']).toEqual(['get', 'renderMinHeightM']);
    expect(ext.paint?.['fill-extrusion-vertical-gradient']).toBe(true);
  });

  it('evaluates height and base per feature', () => {
    const props = { renderHeightM: 12.8, renderMinHeightM: 3 };
    expect(
      evalProperty(ext, 'paint', 'fill-extrusion-height', { properties: props, geometryType: 'Polygon' }),
    ).toBe(12.8);
    expect(
      evalProperty(ext, 'paint', 'fill-extrusion-base', { properties: props, geometryType: 'Polygon' }),
    ).toBe(3);
  });

  it.each(['light', 'dark'] as const)(
    '%s: colours by height source and highlights the selected building',
    (theme) => {
      const [layer] = buildingExtrusionLayers(theme);
      const c = MAP_THEME_COLORS[theme];
      const colour = (heightSource: HeightSource, selected = false) =>
        toHex(
          evalProperty(layer!, 'paint', 'fill-extrusion-color', {
            properties: { renderHeightSource: heightSource },
            state: { selected },
            geometryType: 'Polygon',
          }),
        );
      expect(colour('osm-height')).toBe(c.extrusionMeasured);
      expect(colour('osm-levels-estimate')).toBe(c.extrusionEstimated);
      expect(colour('fallback')).toBe(c.extrusionUnknown);
      expect(colour('fallback', true)).toBe(c.selected);
      expect(colour('osm-height', true)).toBe(c.selected);
    },
  );

  it('honours source/minzoom overrides and initial mode', () => {
    const [l] = buildingExtrusionLayers('dark', { sourceId: 'b2', minzoom: 16, mode3d: true });
    expect(l).toMatchObject({ source: 'b2', minzoom: 16, layout: { visibility: 'visible' } });
    expect(ext.layout).toMatchObject({ visibility: 'none' });
  });
});

describe('buildingFootprintLayers', () => {
  it('draws a flat fill and outline that highlight the selected building', () => {
    const [fill, outline] = buildingFootprintLayers('light');
    expect(fill?.id).toBe(BUILDING_LAYER_IDS.fill);
    expect(outline?.id).toBe(BUILDING_LAYER_IDS.outline);
    const c = MAP_THEME_COLORS.light;
    const fillColour = (selected: boolean) =>
      toHex(evalProperty(fill!, 'paint', 'fill-color', { state: { selected }, geometryType: 'Polygon' }));
    expect(fillColour(false)).toBe(c.buildingFill);
    expect(fillColour(true)).toBe(c.selected);
  });

  it('limits the flat fill to zooms without extrusions in 3D', () => {
    expect(flatFillMaxZoom(true)).toBe(APP_CONFIG.map.extrusionMinZoom);
    expect(flatFillMaxZoom(false)).toBeGreaterThanOrEqual(APP_CONFIG.map.maxZoom);
    expect(buildingFootprintLayers('light', { mode3d: true })[0]?.maxzoom).toBe(
      APP_CONFIG.map.extrusionMinZoom,
    );
  });
});

describe('buildingLegend', () => {
  it('explains all three height sources truthfully with their map colours', () => {
    const legend = buildingLegend('dark');
    expect(legend.map((e) => e.heightSource)).toEqual(['osm-height', 'osm-levels-estimate', 'fallback']);
    expect(legend.map((e) => e.label)).toEqual([
      'Measured height',
      'Estimated from floor count',
      'Height unknown (placeholder)',
    ]);
    expect(legend[1]?.description).toContain(String(APP_CONFIG.map.metresPerLevel));
    expect(legend[2]?.description).toMatch(/placeholder/);
    expect(legend[2]?.color).toBe(MAP_THEME_COLORS.dark.extrusionUnknown);
  });
});

function modeMap(existing = true) {
  return {
    easeTo: vi.fn(),
    jumpTo: vi.fn(),
    getLayer: vi.fn(() => (existing ? {} : undefined)),
    setLayoutProperty: vi.fn(),
    setLayerZoomRange: vi.fn(),
    dragRotate: { enable: vi.fn(), disable: vi.fn() },
    touchPitch: { enable: vi.fn(), disable: vi.fn() },
  };
}

describe('setBuildingMode', () => {
  it('3D: eases to the configured pitch/bearing, shows extrusions and enables rotate/pitch', () => {
    const m = modeMap();
    setBuildingMode(m as unknown as BuildingModeMap, true, { reducedMotion: false });
    expect(m.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({
        pitch: APP_CONFIG.map.pitch3d,
        bearing: APP_CONFIG.map.bearing3d,
        // Our reducedMotion option decides; MapLibre's stale global flag must not cancel the ease.
        essential: true,
      }),
    );
    expect(m.jumpTo).not.toHaveBeenCalled();
    expect(m.setLayoutProperty).toHaveBeenCalledWith(BUILDING_LAYER_IDS.extrusion, 'visibility', 'visible');
    expect(m.setLayerZoomRange).toHaveBeenCalledWith(
      BUILDING_LAYER_IDS.fill,
      0,
      APP_CONFIG.map.extrusionMinZoom,
    );
    expect(m.dragRotate.enable).toHaveBeenCalled();
    expect(m.touchPitch.enable).toHaveBeenCalled();
  });

  it('3D on a phone (compact) tilts to the lower pitch3dCompact', () => {
    const m = modeMap();
    setBuildingMode(m as unknown as BuildingModeMap, true, { reducedMotion: true, compact: true });
    expect(m.jumpTo).toHaveBeenCalledWith({
      pitch: APP_CONFIG.map.pitch3dCompact,
      bearing: APP_CONFIG.map.bearing3d,
    });
    expect(APP_CONFIG.map.pitch3dCompact).toBeLessThan(APP_CONFIG.map.pitch3d);
  });

  it('2D with reduced motion: jumps flat and north-up, hides extrusions and disables rotate/pitch', () => {
    const m = modeMap();
    setBuildingMode(m as unknown as BuildingModeMap, false, { reducedMotion: true });
    expect(m.jumpTo).toHaveBeenCalledWith({ pitch: 0, bearing: 0 });
    expect(m.easeTo).not.toHaveBeenCalled();
    expect(m.setLayoutProperty).toHaveBeenCalledWith(BUILDING_LAYER_IDS.extrusion, 'visibility', 'none');
    expect(m.dragRotate.disable).toHaveBeenCalled();
    expect(m.touchPitch.disable).toHaveBeenCalled();
  });

  it('still moves the camera when the building layers are absent', () => {
    const m = modeMap(false);
    setBuildingMode(m as unknown as BuildingModeMap, true, { reducedMotion: false });
    expect(m.easeTo).toHaveBeenCalled();
    expect(m.setLayoutProperty).not.toHaveBeenCalled();
    expect(m.setLayerZoomRange).not.toHaveBeenCalled();
  });
});

describe('supportsWebGL', () => {
  beforeEach(() => resetWebGLSupportCache());
  afterEach(() => resetWebGLSupportCache());

  it('prefers WebGL2, releases the probe context and caches the result', () => {
    const loseContext = vi.fn();
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((type: string) =>
        type === 'webgl2' ? { getExtension: () => ({ loseContext }) } : null) as never);
    expect(supportsWebGL()).toBe(true);
    expect(supportsWebGL()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('is false on a WebGL1-only browser, because MapLibre GL JS 6 requires WebGL2', () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((type: string) =>
        type === 'webgl' ? { getExtension: () => null } : null) as never);
    expect(supportsWebGL()).toBe(false);
    expect(spy).not.toHaveBeenCalledWith('webgl');
  });

  it('is false when no context can be created or the probe throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    expect(supportsWebGL()).toBe(false);
    resetWebGLSupportCache();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(supportsWebGL()).toBe(false);
  });
});
