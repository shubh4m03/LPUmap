/** Provider configuration, registry, capability detection and fallback (src/map/providers). */
import { describe, expect, it } from 'vitest';
import { resolveViewMode, type ViewMode } from '../../../src/app/view-mode.ts';
import { parseProviderEnv } from '../../../src/map/providers/config.ts';
import { EOX_NOTICE, EOX_TILE_TEMPLATE, eoxSentinel2016 } from '../../../src/map/providers/eox.ts';
import {
  ESRI_DATA_ATTRIBUTION,
  ESRI_IMAGERY_DATE,
  ESRI_TILE_TEMPLATE,
  esriWorldImagery,
} from '../../../src/map/providers/esri.ts';
import {
  capabilityReport,
  createProviderRegistry,
  HEALTHY_RUNTIME,
  IMAGERY_ORIGINS,
  imageryForMode,
  imageryStatus,
  viewModeAvailability,
} from '../../../src/map/providers/registry.ts';
import {
  PHOTOREAL_UNAVAILABLE_REASON,
  PROVIDER_FAILURE_REASONS,
  SATELLITE_NOT_CONFIGURED_REASON,
  type ImageryProvider,
} from '../../../src/map/providers/types.ts';

/** Obviously fake, never a real key. */
const FAKE_KEY = 'TEST_ONLY_fake_arcgis_key_0123456789abcdef';

const NONE = parseProviderEnv({});
const ESRI = parseProviderEnv({ VITE_ARCGIS_API_KEY: FAKE_KEY });
const EOX = parseProviderEnv({ VITE_EOX_BACKDROP: 'true' });
const BOTH = parseProviderEnv({ VITE_ARCGIS_API_KEY: FAKE_KEY, VITE_EOX_BACKDROP: 'true' });

describe('parseProviderEnv', () => {
  it('enables nothing by default (no key, no backdrop, no warnings)', () => {
    expect(NONE).toEqual({ arcgisApiKey: null, eoxBackdrop: false, warnings: [] });
    expect(parseProviderEnv({ VITE_ARCGIS_API_KEY: '  ', VITE_EOX_BACKDROP: '' }).warnings).toEqual([]);
  });

  it('accepts a plausible key (trimmed) and the backdrop flag', () => {
    expect(parseProviderEnv({ VITE_ARCGIS_API_KEY: ` ${FAKE_KEY}\n` }).arcgisApiKey).toBe(FAKE_KEY);
    for (const v of ['true', 'TRUE', '1', 'yes', 'on'])
      expect(parseProviderEnv({ VITE_EOX_BACKDROP: v }).eoxBackdrop).toBe(true);
    for (const v of ['false', '0', 'no', 'off', ''])
      expect(parseProviderEnv({ VITE_EOX_BACKDROP: v }).eoxBackdrop).toBe(false);
  });

  it('rejects placeholders and malformed keys with a warning that never contains the value', () => {
    for (const bad of [
      'YOUR_ACCESS_TOKEN',
      'your-api-key',
      'changeme',
      'short',
      'has spaces in it but long enough',
      'a"b<script>0123456789012',
    ]) {
      const cfg = parseProviderEnv({ VITE_ARCGIS_API_KEY: bad });
      expect(cfg.arcgisApiKey, bad).toBeNull();
      expect(cfg.warnings).toHaveLength(1);
      expect(cfg.warnings[0]).not.toContain(bad);
      expect(cfg.warnings[0]).toContain('VITE_ARCGIS_API_KEY');
    }
    const eox = parseProviderEnv({ VITE_EOX_BACKDROP: 'maybe' });
    expect(eox.eoxBackdrop).toBe(false);
    expect(eox.warnings[0]).toContain('VITE_EOX_BACKDROP');
  });
});

describe('Esri World Imagery provider', () => {
  it('is not configured without a key and then requests nothing', () => {
    const p = esriWorldImagery(null);
    expect(p.configured()).toBe(false);
    expect(p.source()).toBeNull();
    expect(p.probeUrl()).toBeNull();
  });

  it('uses the documented map tile service, rows before columns, with the key as `token`', () => {
    const p = esriWorldImagery(FAKE_KEY);
    expect(ESRI_TILE_TEMPLATE).toBe(
      'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    );
    expect(p.source()).toEqual({
      kind: 'raster-tiles',
      tiles: [`${ESRI_TILE_TEMPLATE}?token=${FAKE_KEY}`],
      tileSize: 256,
    });
    expect(p.probeUrl()).toBe(
      `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer?f=json&token=${FAKE_KEY}`,
    );
    expect(p.maxZoom).toBe(19);
    expect(p.detail).toBe('high');
    expect(p.offline).toBe(false);
    expect(p.requiresKey).toBe(true);
  });

  it('URL-encodes the key so it cannot break out of the query', () => {
    const p = esriWorldImagery('abc&evil=1#frag_0123456789');
    const src = p.source();
    expect(src?.kind === 'raster-tiles' && src.tiles[0]).toContain('token=abc%26evil%3D1%23frag_0123456789');
  });

  it('carries "Powered by Esri" and the service’s data attribution', () => {
    const p = esriWorldImagery(FAKE_KEY);
    expect(p.attribution.requiredLogoText).toBe('Powered by Esri');
    expect(p.attribution.parts.map((x) => x.text)).toEqual(['Powered by ', 'Esri', ESRI_DATA_ATTRIBUTION]);
    expect(p.attribution.parts[1]?.href).toBe('https://www.esri.com');
  });

  it('states the capture date only in the verified wording, never as "live"', () => {
    expect(ESRI_IMAGERY_DATE.statement).toBe(
      'Imagery captured 2023-12-18 according to Esri World Imagery Wayback metadata (retrieved 2026-10-24).',
    );
    expect(ESRI_IMAGERY_DATE.capturedOn).toBe('2023-12-18');
    expect(ESRI_IMAGERY_DATE.checkedOn).toBe('2026-10-24');
    const p = esriWorldImagery(FAKE_KEY);
    expect(`${p.caption} ${p.label}`.toLowerCase()).not.toMatch(/\b(real-time|current|up to date)\b/);
    expect(p.caption.toLowerCase()).toContain('not live');
  });
});

describe('EOX Sentinel-2 cloudless 2016 provider', () => {
  it('is keyless, the 2016 layer only, and off unless enabled', () => {
    expect(eoxSentinel2016(false).configured()).toBe(false);
    expect(eoxSentinel2016(false).source()).toBeNull();
    const p = eoxSentinel2016(true);
    expect(p.requiresKey).toBe(false);
    expect(EOX_TILE_TEMPLATE).toBe(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    );
    // Never a 2018+ layer (those forbid commercial use of the public endpoint).
    expect(EOX_TILE_TEMPLATE).not.toMatch(/s2cloudless-20\d\d/);
    expect(p.probeUrl()).toBeNull();
  });

  it('is capped to zooms where 10 m imagery is not misleading, and says buildings are not visible', () => {
    const p = eoxSentinel2016(true);
    expect(p.detail).toBe('low');
    expect(p.maxZoom).toBe(13);
    expect(p.cameraMaxZoom).toBe(14);
    expect(p.notice).toBe('10 m imagery — buildings not visible');
    expect(EOX_NOTICE).toBe(p.notice);
    expect(p.imageryDate).toBeNull();
  });

  it('carries the attribution EOX requires (CC BY 4.0)', () => {
    const text = eoxSentinel2016(true)
      .attribution.parts.map((x) => x.text)
      .join(' ');
    expect(text).toBe(
      'EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016) CC BY 4.0',
    );
    expect(eoxSentinel2016(true).attribution.parts[0]?.href).toBe('https://cloudless.eox.at');
  });
});

describe('registry and capability detection', () => {
  it('registers only configured imagery, Esri before EOX, never a photoreal or terrain source', () => {
    expect(createProviderRegistry(NONE).imagery).toEqual([]);
    expect(createProviderRegistry(ESRI).imagery.map((p) => p.id)).toEqual(['esri-world-imagery']);
    expect(createProviderRegistry(EOX).imagery.map((p) => p.id)).toEqual(['eox-s2cloudless-2016']);
    expect(createProviderRegistry(BOTH).imagery.map((p) => p.id)).toEqual([
      'esri-world-imagery',
      'eox-s2cloudless-2016',
    ]);
    const reg = createProviderRegistry(BOTH);
    expect(reg.photoreal.status).toBe('unavailable');
    expect(reg.terrain).toBeNull();
  });

  it('every provider is third-party, never cached offline, and lists exact https origins', () => {
    const all: ImageryProvider[] = [esriWorldImagery(FAKE_KEY), eoxSentinel2016(true)];
    expect(all.flatMap((p) => p.origins).sort()).toEqual([...IMAGERY_ORIGINS].sort());
    for (const p of all) {
      expect(p.offline).toBe(false);
      for (const o of p.origins) expect(o).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      const src = p.source();
      if (src?.kind === 'raster-tiles')
        for (const t of src.tiles) expect(p.origins.some((o) => t.startsWith(`${o}/`))).toBe(true);
    }
  });

  it('availability: not configured / available / failed reasons; photoreal always unavailable', () => {
    expect(viewModeAvailability(createProviderRegistry(NONE), HEALTHY_RUNTIME)).toEqual({
      satellite: SATELLITE_NOT_CONFIGURED_REASON,
      photoreal: PHOTOREAL_UNAVAILABLE_REASON,
    });
    const esri = createProviderRegistry(ESRI);
    expect(viewModeAvailability(esri, HEALTHY_RUNTIME).satellite).toBeNull();
    for (const failure of ['auth', 'quota', 'network'] as const)
      expect(viewModeAvailability(esri, { failure, online: true }).satellite).toBe(
        PROVIDER_FAILURE_REASONS[failure],
      );
    expect(viewModeAvailability(esri, { failure: null, online: false }).satellite).toBe(
      PROVIDER_FAILURE_REASONS.network,
    );
    expect(imageryStatus(esri, HEALTHY_RUNTIME)).toEqual({
      state: 'available',
      providerId: 'esri-world-imagery',
    });
  });

  it('imageryForMode: Satellite 2D and Campus 3D use high-detail imagery; low-detail only in Satellite 2D', () => {
    const modes: ViewMode[] = ['satellite2d', 'photoreal3d', 'realistic3d', 'isometric', 'standard2d'];
    const esri = createProviderRegistry(ESRI);
    expect(modes.map((m) => imageryForMode(m, esri, HEALTHY_RUNTIME)?.id ?? null)).toEqual([
      'esri-world-imagery',
      null,
      'esri-world-imagery',
      null,
      null,
    ]);
    const eox = createProviderRegistry(EOX);
    expect(modes.map((m) => imageryForMode(m, eox, HEALTHY_RUNTIME)?.id ?? null)).toEqual([
      'eox-s2cloudless-2016',
      null,
      null,
      null,
      null,
    ]);
    for (const m of modes)
      expect(imageryForMode(m, createProviderRegistry(NONE), HEALTHY_RUNTIME)).toBeNull();
    // After a failure, or offline, nothing is drawn (the campus map shows).
    expect(imageryForMode('satellite2d', esri, { failure: 'quota', online: true })).toBeNull();
    expect(imageryForMode('realistic3d', esri, { failure: null, online: false })).toBeNull();
  });

  it('missing key / auth / quota / network fall back to the campus map (never a blank screen)', () => {
    const reg = createProviderRegistry(ESRI);
    const base = { navigationActive: false, mapUnavailable: null };
    for (const failure of ['not-configured', 'auth', 'quota', 'network'] as const) {
      const availability =
        failure === 'not-configured'
          ? viewModeAvailability(createProviderRegistry(NONE), HEALTHY_RUNTIME)
          : viewModeAvailability(reg, { failure, online: true });
      const r = resolveViewMode('satellite2d', { ...base, availability });
      expect(r.mode, failure).toBe('standard2d');
      expect(r.fallbackFrom).toBe('satellite2d');
      expect(r.reason).toBe(PROVIDER_FAILURE_REASONS[failure]);
    }
  });

  it('capabilityReport reflects WebGL, connection and the photoreal state', () => {
    const reg = createProviderRegistry(ESRI);
    const ok = capabilityReport(reg, HEALTHY_RUNTIME, true);
    expect(ok.imagery.state).toBe('available');
    expect(ok.photoreal).toMatchObject({ state: 'failed', failure: 'unavailable' });
    expect(ok.terrain).toBeNull();
    const noGl = capabilityReport(reg, HEALTHY_RUNTIME, false);
    expect(noGl.imagery).toMatchObject({ state: 'failed', failure: 'unsupported' });
    expect(capabilityReport(reg, { failure: null, online: false }, true).online).toBe(false);
  });
});
