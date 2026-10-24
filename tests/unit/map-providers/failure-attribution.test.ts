/** Failure classification, the metadata probe, attribution escaping and the date line. */
import { describe, expect, it, vi } from 'vitest';
import {
  attributionHtml,
  attributionText,
  escapeHtml,
  imageryDateLine,
  safeHref,
} from '../../../src/map/providers/attribution.ts';
import {
  boundsIntersect,
  boundsOfPolygons,
  campusOutOfView,
  polygonsOf,
  polygonsTouchBounds,
  MAX_PITCH,
} from '../../../src/map/providers/camera.ts';
import { eoxSentinel2016 } from '../../../src/map/providers/eox.ts';
import { ESRI_IMAGERY_DATE, esriWorldImagery } from '../../../src/map/providers/esri.ts';
import {
  classifyImageryError,
  classifyProbeResponse,
  ImageryHealth,
  probeImagery,
} from '../../../src/map/providers/failure.ts';

const KEYED = { requiresKey: true, online: true };
const KEYLESS = { requiresKey: false, online: true };

describe('classifyImageryError', () => {
  it('maps HTTP statuses: 401/403/498/499 → auth, 429 → quota, others → network', () => {
    for (const status of [401, 403, 498, 499]) expect(classifyImageryError({ status }, KEYED)).toBe('auth');
    expect(classifyImageryError({ status: 429 }, KEYED)).toBe('quota');
    for (const status of [0, 500, 502, 503]) expect(classifyImageryError({ status }, KEYED)).toBe('network');
  });

  it('a non-image answer (Esri "Token Required" with HTTP 200) is auth for a keyed provider', () => {
    const err = {
      message: 'Could not load image. Please make sure to use a supported image type such as PNG or JPEG.',
    };
    expect(classifyImageryError(err, KEYED)).toBe('auth');
    expect(classifyImageryError(err, KEYLESS)).toBe('network');
    expect(classifyImageryError({ name: 'InvalidStateError', message: 'decode failed' }, KEYED)).toBe('auth');
  });

  it('offline is always network; unknown errors are network', () => {
    expect(classifyImageryError({ status: 403 }, { requiresKey: true, online: false })).toBe('network');
    expect(classifyImageryError(null, KEYED)).toBe('network');
    expect(classifyImageryError({ message: 'Failed to fetch' }, KEYED)).toBe('network');
  });
});

describe('classifyProbeResponse / probeImagery', () => {
  it('reads ArcGIS JSON errors that come with HTTP 200', () => {
    expect(classifyProbeResponse(200, { error: { code: 499, message: 'Token Required.' } })).toBe('auth');
    expect(classifyProbeResponse(200, { error: { code: 498, message: 'Invalid token.' } })).toBe('auth');
    expect(classifyProbeResponse(200, { error: { code: 403 } })).toBe('auth');
    expect(classifyProbeResponse(200, { error: { code: 429 } })).toBe('quota');
    expect(classifyProbeResponse(429, null)).toBe('quota');
    expect(classifyProbeResponse(503, null)).toBe('network');
    expect(classifyProbeResponse(200, { currentVersion: 10.6 })).toBeNull();
    expect(classifyProbeResponse(200, null)).toBeNull();
  });

  it('fetches without credentials or cache and reports network failures', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ currentVersion: 10.6 }), { status: 200 }));
    expect(await probeImagery('https://example.invalid/probe', { fetch: ok })).toBeNull();
    expect(ok).toHaveBeenCalledWith(
      'https://example.invalid/probe',
      expect.objectContaining({ credentials: 'omit', cache: 'no-store' }),
    );
    const denied = vi.fn(async () => new Response(JSON.stringify({ error: { code: 498 } }), { status: 200 }));
    expect(await probeImagery('https://example.invalid/probe', { fetch: denied })).toBe('auth');
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await probeImagery('https://example.invalid/probe', { fetch: down })).toBe('network');
    const html = vi.fn(async () => new Response('<html>', { status: 200 }));
    expect(await probeImagery('https://example.invalid/probe', { fetch: html })).toBeNull();
  });

  it('rethrows an abort so the caller can probe again later', async () => {
    const aborted = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(probeImagery('https://example.invalid/probe', { fetch: aborted })).rejects.toThrow(
      'aborted',
    );
  });
});

describe('ImageryHealth', () => {
  it('fails at once on auth/quota, after N network errors without a loaded tile, and only once', () => {
    const h = new ImageryHealth({ networkThreshold: 3 });
    expect(h.tileError('network')).toBeNull();
    expect(h.tileError('network')).toBeNull();
    h.tileLoaded();
    expect(h.tileError('network')).toBeNull();
    expect(h.tileError('network')).toBeNull();
    expect(h.tileError('network')).toBe('network');
    expect(h.tileError('auth')).toBeNull();
    h.reset();
    expect(h.tileError('quota')).toBe('quota');
    h.reset();
    expect(h.tileError('auth')).toBe('auth');
  });
});

describe('attribution', () => {
  it('Esri: "Powered by Esri" with a link, then the data sources', () => {
    const p = esriWorldImagery('TEST_ONLY_fake_arcgis_key_0123456789abcdef');
    expect(attributionHtml(p.attribution)).toBe(
      'Powered by <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a> | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    );
    expect(attributionText(p.attribution)).toBe(
      'Powered by Esri | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    );
  });

  it('EOX: the required credit with links', () => {
    const html = attributionHtml(eoxSentinel2016(true).attribution);
    expect(html).toContain('<a href="https://cloudless.eox.at/"');
    expect(html).toContain('by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)');
    expect(html).toContain('CC BY 4.0');
  });

  it('escapes text and drops non-https links', () => {
    const html = attributionHtml({
      parts: [
        { text: '<img src=x onerror=alert(1)>' },
        { text: 'click', href: 'javascript:alert(1)' },
        { text: 'plain', href: 'http://insecure.example' },
        { text: 'q"uote', href: 'https://ok.example/a"b' },
      ],
      requiredLogoText: null,
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('http://insecure');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="https://ok.example/a%22b"');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
  });

  it('shows the capture date only inside the verified area', () => {
    const p = esriWorldImagery('TEST_ONLY_fake_arcgis_key_0123456789abcdef');
    expect(imageryDateLine(p, [75.7032, 31.2533])).toBe(ESRI_IMAGERY_DATE.statement);
    expect(imageryDateLine(p, [75.69, 31.24])).toBe('Capture date not verified for this part of the map.');
    expect(imageryDateLine(p, null)).toBe('Capture date not verified for this part of the map.');
    expect(imageryDateLine(eoxSentinel2016(true), [75.7032, 31.2533])).toBeNull();
  });
});

describe('camera helpers', () => {
  it('keeps MapLibre’s non-experimental pitch limit', () => {
    expect(MAX_PITCH).toBe(60);
  });

  it('computes polygon bounds and whether the campus is on screen', () => {
    const campus = boundsOfPolygons({
      features: [
        {
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [75.7, 31.25],
                  [75.71, 31.25],
                  [75.71, 31.26],
                  [75.7, 31.25],
                ],
              ],
            ],
          },
        },
        { geometry: null },
      ],
    });
    expect(campus).toEqual([75.7, 31.25, 75.71, 31.26]);
    expect(boundsOfPolygons({ features: [] })).toBeNull();
    expect(boundsIntersect([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(boundsIntersect([0, 0, 1, 1], [1.1, 0, 2, 1])).toBe(false);
    const onCampus = {
      center: [75.705, 31.255] as [number, number],
      zoom: 16,
      bounds: [75.703, 31.253, 75.707, 31.257] as const,
    };
    const away = {
      center: [75.69, 31.24] as [number, number],
      zoom: 18,
      bounds: [75.689, 31.239, 75.691, 31.241] as const,
    };
    expect(campusOutOfView(onCampus, campus)).toBe(false);
    expect(campusOutOfView(away, campus)).toBe(true);
    expect(campusOutOfView(null, campus)).toBe(false);
  });

  it('uses the real outline of a concave campus, not just its bounding box', () => {
    // An L-shaped campus: the north-west quarter of its bounding box is outside it.
    const polygons = polygonsOf({
      features: [
        {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [75.7, 31.25],
                [75.71, 31.25],
                [75.71, 31.26],
                [75.705, 31.26],
                [75.705, 31.255],
                [75.7, 31.255],
                [75.7, 31.25],
              ],
            ],
          },
        },
        { geometry: null },
      ],
    });
    const campus = [75.7, 31.25, 75.71, 31.26] as const;
    const view = (bounds: readonly [number, number, number, number]) => ({
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as [number, number],
      zoom: 18,
      bounds,
    });
    // Inside the bounding box but wholly in the missing quarter: the campus is off screen.
    const notch = view([75.701, 31.2565, 75.703, 31.2585]);
    expect(polygonsTouchBounds(polygons, notch.bounds)).toBe(false);
    expect(campusOutOfView(notch, campus)).toBe(false); // bounding box only: wrongly "in view"
    expect(campusOutOfView(notch, campus, polygons)).toBe(true);
    // Wholly inside the campus (no edge on screen): in view.
    expect(campusOutOfView(view([75.706, 31.251, 75.708, 31.253]), campus, polygons)).toBe(false);
    // An edge crosses the screen: in view.
    expect(campusOutOfView(view([75.704, 31.256, 75.706, 31.258]), campus, polygons)).toBe(false);
    // Only a corner vertex inside the screen: in view.
    expect(campusOutOfView(view([75.7095, 31.2595, 75.7105, 31.2605]), campus, polygons)).toBe(false);
  });
});
