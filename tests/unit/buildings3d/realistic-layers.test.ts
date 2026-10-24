import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { VERIFICATION_LABELS } from '../../../src/building-studio/schema.ts';
import {
  BUILDING_LAYER_IDS,
  buildingExtrusionLayers,
  buildingLegend,
  extrusionFilter,
  LIGHT_AZIMUTH_DEG,
  LIGHT_POLAR_DEG,
  lightSpecification,
  REALISTIC_3D_COLORS,
  STUDIO_HEIGHT_SOURCE,
  studioPickLayer,
  UNVERIFIED_MODEL_LABEL,
} from '../../../src/buildings3d/index.ts';
import { maybeAddModelLayer } from '../../../src/buildings3d/models/maybe-add-model-layer.ts';
import { MODEL_REGISTRY, type ModelEntry } from '../../../src/buildings3d/models/registry.ts';
import {
  detectionAttributionHtml,
  detectionLayers,
  outsideBadgeLayer,
} from '../../../src/buildings3d/optional-layers.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { manifestSchema, type SourceRecord } from '../../../src/data/schema.ts';
import { buildMapStyle } from '../../../src/map/style.ts';
import { contrastRatio } from '../../../src/map/contrast.ts';
import { MAP_THEME_COLORS } from '../../../src/map/theme-colors.ts';
import { evalFilter, evalProperty, toHex } from '../map/style-eval.ts';
import { syntheticCampusData } from '../map/synthetic-campus-data.ts';

const THEMES = ['light', 'dark'] as const;
const props = (over: Record<string, unknown> = {}) => ({
  properties: { id: 'osm:way/1', inCampusInventory: true, ...over },
  geometryType: 'Polygon' as const,
});

describe('campus-inventory extrusion and the studio exclusion', () => {
  it('extrudes campus-inventory footprints only (never uncertain ones)', () => {
    const [layer] = buildingExtrusionLayers('light');
    expect(evalFilter(layer!.filter, props())).toBe(true);
    expect(evalFilter(layer!.filter, props({ inCampusInventory: false }))).toBe(false);
  });

  it('leaves out the ids the custom layer draws, and only those', () => {
    const f = extrusionFilter(['stu:b', 'osm:way/2']);
    expect(evalFilter(f, props({ id: 'osm:way/2' }))).toBe(false);
    expect(evalFilter(f, props({ id: 'stu:b' }))).toBe(false);
    expect(evalFilter(f, props({ id: 'osm:way/3' }))).toBe(true);
    expect(evalFilter(f, props({ id: 'osm:way/3', inCampusInventory: false }))).toBe(false);
    expect(extrusionFilter([])).toEqual(['==', ['get', 'inCampusInventory'], true]);
  });

  it('keeps studio buildings pickable through an invisible footprint extrusion', () => {
    const pick = studioPickLayer(['stu:b'], { mode3d: true });
    expect(pick).toMatchObject({
      id: BUILDING_LAYER_IDS.studioPick,
      type: 'fill-extrusion',
      source: 'buildings',
    });
    expect(pick.paint?.['fill-extrusion-opacity']).toBe(0);
    expect(evalFilter(pick.filter, props({ id: 'stu:b' }))).toBe(true);
    expect(evalFilter(pick.filter, props({ id: 'osm:way/1' }))).toBe(false);
    expect(studioPickLayer(['stu:b'], { mode3d: false }).layout).toEqual({ visibility: 'none' });
  });

  it.each(THEMES)('%s: a studio model drawn as a fallback block has its own honest colour', (theme) => {
    const [layer] = buildingExtrusionLayers(theme);
    const colour = toHex(
      evalProperty(layer!, 'paint', 'fill-extrusion-color', {
        properties: { renderHeightSource: STUDIO_HEIGHT_SOURCE },
        geometryType: 'Polygon',
      }),
    );
    const c = MAP_THEME_COLORS[theme];
    expect(colour).toBe(REALISTIC_3D_COLORS[theme].extrusionStudio);
    expect([c.extrusionMeasured, c.extrusionEstimated, c.extrusionUnknown]).not.toContain(colour);
  });
});

describe('fidelity legend', () => {
  it('calls only an OSM height tag measured; estimates and placeholders say so', () => {
    const entries = buildingLegend('light');
    expect(entries.map((e) => e.key)).toEqual(['osm-height', 'osm-levels-estimate', 'fallback']);
    expect(entries.filter((e) => /measured/i.test(e.label)).map((e) => e.key)).toEqual(['osm-height']);
    expect(entries[1]!.description).toMatch(/estimate, not a measurement/);
    expect(entries[2]!.description).toMatch(/placeholder/);
  });

  it('labels studio models with the S3 public label and detections as unverified, when present', () => {
    const entries = buildingLegend('dark', { studioModels: true, detectedFootprints: true });
    const studio = entries.find((e) => e.key === STUDIO_HEIGHT_SOURCE)!;
    expect(studio.description).toContain(VERIFICATION_LABELS.unverified);
    expect(studio.description).toMatch(/illustrative, not measurements/);
    const det = entries.find((e) => e.key === 'detected-footprint')!;
    expect(det).toMatchObject({ swatch: 'dashed', heightSource: null });
    expect(det.description).toMatch(/not part of the campus building list/);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
  });

  it('keeps its copy of the S3 label in step with the studio schema', () => {
    expect(UNVERIFIED_MODEL_LABEL).toBe(VERIFICATION_LABELS.unverified);
  });
});

describe('map-anchored light', () => {
  it('is anchored to the map, inside the design ranges, dimmer in dark mode', () => {
    for (const theme of THEMES) {
      const l = lightSpecification(theme);
      expect(l.anchor).toBe('map');
      expect(LIGHT_AZIMUTH_DEG).toBeGreaterThanOrEqual(200);
      expect(LIGHT_AZIMUTH_DEG).toBeLessThanOrEqual(225);
      expect(LIGHT_POLAR_DEG).toBeGreaterThanOrEqual(30);
      expect(LIGHT_POLAR_DEG).toBeLessThanOrEqual(40);
    }
    expect(lightSpecification('light').intensity).toBe(0.5);
    expect(lightSpecification('dark').intensity).toBe(0.35);
  });

  it('is part of the map style', () => {
    const style = buildMapStyle({
      data: syntheticCampusData(),
      theme: 'dark',
      mode3d: true,
      visibleGroups: new Set(),
      showLabels: true,
      places: { type: 'FeatureCollection', features: [] },
      route: { type: 'FeatureCollection', features: [] },
      userLocation: { type: 'FeatureCollection', features: [] },
      glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf',
    });
    expect(style.light).toEqual(lightSpecification('dark'));
  });
});

describe('"Unverified detected footprints" layer', () => {
  it('is flat and dashed: no extrusion, a dashed outline, hollow rings for points', () => {
    const layers = detectionLayers('light');
    expect(layers.map((l) => l.type)).toEqual(['fill', 'line', 'circle']);
    const line = layers[1]!;
    expect(line.type === 'line' && line.paint?.['line-dasharray']).toEqual([2, 1.5]);
    expect(evalFilter(layers[0]!.filter, { geometryType: 'Polygon' })).toBe(true);
    expect(evalFilter(layers[0]!.filter, { geometryType: 'Point' })).toBe(false);
    expect(evalFilter(layers[2]!.filter, { geometryType: 'Point' })).toBe(true);
  });

  it('builds attribution links from the shipped manifest (Microsoft CDLA Permissive 2.0, Google Open Buildings ODbL)', () => {
    const manifest = manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.resolve('public/data/manifest.json'), 'utf8')),
    );
    const html = detectionAttributionHtml(manifest.sources);
    expect(html).toContain('href="https://cdla.dev/permissive-2-0/"');
    expect(html).toContain('Microsoft');
    expect(html).toContain('href="https://opendatacommons.org/licenses/odbl/1-0/"');
    expect(html).toContain('Google Open Buildings');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes text and never links an unsafe URL', () => {
    const sources: SourceRecord[] = [
      {
        id: 'microsoft-ml-buildings',
        name: 'MS',
        url: 'javascript:alert(1)',
        license: 'X',
        attribution: '<img src=x onerror=alert(1)>',
        retrievedAt: '2026-01-01',
      } as SourceRecord,
    ];
    const html = detectionAttributionHtml(sources);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href');
    expect(html).toContain('&lt;img');
  });
});

describe('"Nearby, outside campus" badge', () => {
  it('shows the configured badge under off-campus markers only', () => {
    const layer = outsideBadgeLayer('light');
    expect(layer.source).toBe('places');
    expect(evalFilter(layer.filter, { properties: { offCampus: true } })).toBe(true);
    expect(evalFilter(layer.filter, { properties: { offCampus: false } })).toBe(false);
    expect(String(evalProperty(layer, 'layout', 'text-field', { properties: {} }))).toBe(
      APP_CONFIG.optionalLayers.nearbyOutsideCampus.badge,
    );
  });
});

describe('palette contrast', () => {
  it.each(THEMES)(
    '%s: detection outline ≥ 3:1 on the campus ground; badge text ≥ 4.5:1 on its halo',
    (theme) => {
      const r = REALISTIC_3D_COLORS[theme];
      const c = MAP_THEME_COLORS[theme];
      expect(contrastRatio(r.detectionOutline, c.campusFill)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.detectionOutline, c.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(r.badgeText, r.badgeHalo)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('GLB model registry seam (D3)', () => {
  it('is empty and loads nothing', async () => {
    expect(MODEL_REGISTRY).toEqual([]);
    const map = { addLayer: vi.fn(), getLayer: vi.fn() };
    const loader = vi.fn();
    expect(await maybeAddModelLayer(map, MODEL_REGISTRY, loader)).toBe('empty');
    expect(loader).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('never adds a layer without an adopted loader, and adds below-extrusion when one exists', async () => {
    const entry: ModelEntry = {
      buildingId: 'osm:way/1',
      url: '/models/x.glb',
      bytes: 1,
      sha256: '0'.repeat(64),
      anchor: [75.7, 31.25],
      rotationDeg: 0,
      scale: 1,
      licence: 'test',
      sourceId: 'test',
      verifiedAt: '2026-01-01',
    };
    const map = { addLayer: vi.fn(), getLayer: vi.fn(() => ({}) as never) };
    expect(await maybeAddModelLayer(map, [entry], null)).toBe('not-adopted');
    expect(map.addLayer).not.toHaveBeenCalled();
    const layer = { id: 'models', type: 'custom' as const, render: () => {} };
    expect(await maybeAddModelLayer(map, [entry], async () => () => layer)).toBe('added');
    expect(map.addLayer).toHaveBeenCalledWith(layer, BUILDING_LAYER_IDS.extrusion);
  });
});
