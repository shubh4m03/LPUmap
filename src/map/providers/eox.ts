/**
 * EOX Sentinel-2 cloudless, 2016 vintage: keyless, CC BY 4.0. Terms re-checked
 * 2026-10-24 (https://cloudless.eox.at/documentation/faq): the 2016 layer may be
 * used "as an embedded basemap in commercial mobile apps, B2B portals, video
 * templates, and websites" with the required attribution, no SLA and a fair use
 * policy, and commercial apps "may access the free 2016 endpoint under CC BY
 * 4.0, provided traffic is reasonable". 2018+ layers are NOT usable here.
 *
 * 10 m pixels cannot show buildings, so it is a low-zoom backdrop only: tiles
 * are requested up to z13 (≈16 m/px at LPU's latitude) and the camera stops at
 * z14 (≈8 m/px), where one image pixel is still about one screen pixel.
 */
import type { ImageryProvider } from './types.ts';

export const EOX_PROVIDER_ID = 'eox-s2cloudless-2016';
export const EOX_ORIGIN = 'https://tiles.maps.eox.at';
/** WMTS layer `s2cloudless_3857` ("Sentinel-2 cloudless layer for 2016 by EOX - 3857"), matrix set `g`. */
export const EOX_TILE_TEMPLATE = `${EOX_ORIGIN}/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`;
export const EOX_NOTICE = '10 m imagery — buildings not visible';
export const EOX_SOURCE_MAX_ZOOM = 13;
export const EOX_CAMERA_MAX_ZOOM = 14;
/**
 * About ±8 km around the campus. The campus panning limit (APP_CONFIG.map.maxBounds) is so tight
 * that a 1440 px wide window cannot zoom out below ≈14.6 inside it — above the cap — so the
 * backdrop gets a wider limit (it is context imagery; there is nothing to misread at this scale).
 */
export const EOX_CAMERA_BOUNDS = [75.62, 31.18, 75.79, 31.33] as const;

export function eoxSentinel2016(enabled: boolean): ImageryProvider {
  return {
    kind: 'imagery',
    id: EOX_PROVIDER_ID,
    label: 'EOX Sentinel-2 cloudless 2016',
    attribution: {
      // Required text: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH
      // (Contains modified Copernicus Sentinel data “year”)".
      parts: [
        { text: 'EOxCloudless', href: 'https://cloudless.eox.at' },
        { text: 'by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)' },
        { text: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' },
      ],
      requiredLogoText: null,
    },
    minZoom: 0,
    maxZoom: EOX_SOURCE_MAX_ZOOM,
    requiresKey: false,
    configured: () => enabled,
    source: () => (enabled ? { kind: 'raster-tiles', tiles: [EOX_TILE_TEMPLATE], tileSize: 256 } : null),
    // A yearly mosaic of many acquisitions: there is no single capture date.
    imageryDate: null,
    offline: false,
    detail: 'low',
    cameraMaxZoom: EOX_CAMERA_MAX_ZOOM,
    cameraBounds: EOX_CAMERA_BOUNDS,
    caption: 'Sentinel-2 cloudless mosaic, 2016 (EOX).',
    notice: EOX_NOTICE,
    origins: [EOX_ORIGIN],
    probeUrl: () => null,
  };
}
