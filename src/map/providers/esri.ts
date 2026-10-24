/**
 * Esri World Imagery through ArcGIS Location Platform (free tier; no payment
 * method, so access simply stops when the monthly free tier is used up).
 * Facts re-checked 2026-10-24 (docs/MAP_PROVIDER_CONFIGURATION.md §Esri):
 *  - tile endpoint and token parameter: Esri's MapLibre tutorial "Display
 *    multiple basemap layers" (World Imagery map tile service);
 *  - data attribution: the service's `copyrightText`;
 *  - "Powered by Esri" text: Esri & data attribution requirements;
 *  - max zoom 19 and the 2023-12-18 capture: Esri World Imagery (Wayback)
 *    metadata at the campus centroid and four near-corner points.
 * The key comes only from the build env (VITE_ARCGIS_API_KEY) and is never
 * written here, in tests or in logs.
 */
import type { ImageryDateMetadata, ImageryProvider } from './types.ts';

export const ESRI_PROVIDER_ID = 'esri-world-imagery';
export const ESRI_ORIGIN = 'https://ibasemaps-api.arcgis.com';
const SERVICE = `${ESRI_ORIGIN}/arcgis/rest/services/World_Imagery/MapServer`;
/** Map tile service, rows before columns ({z}/{y}/{x}). */
export const ESRI_TILE_TEMPLATE = `${SERVICE}/tile/{z}/{y}/{x}`;

/** `copyrightText` of the World_Imagery service, read 2026-10-24. */
export const ESRI_DATA_ATTRIBUTION =
  'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';

/**
 * Capture date over the campus. Verified area: the boundary bbox (centroid and
 * points just inside its four corners all return the same capture).
 */
export const ESRI_IMAGERY_DATE: ImageryDateMetadata = {
  capturedOn: '2023-12-18',
  resolutionM: 0.31,
  sensor: 'WorldView-3',
  source: 'Esri World Imagery Wayback metadata (World_Imagery_Metadata_2026_r09)',
  sourceUrl: null,
  checkedOn: '2026-10-24',
  verifiedBounds: [75.6975, 31.246, 75.709, 31.2605],
  statement:
    'Imagery captured 2023-12-18 according to Esri World Imagery Wayback metadata (retrieved 2026-10-24).',
};

export function esriWorldImagery(apiKey: string | null): ImageryProvider {
  const token = apiKey ? encodeURIComponent(apiKey) : null;
  return {
    kind: 'imagery',
    id: ESRI_PROVIDER_ID,
    label: 'Esri World Imagery',
    attribution: {
      parts: [
        { text: 'Powered by ' },
        { text: 'Esri', href: 'https://www.esri.com' },
        { text: ESRI_DATA_ATTRIBUTION },
      ],
      requiredLogoText: 'Powered by Esri',
    },
    minZoom: 0,
    maxZoom: 19,
    requiresKey: true,
    configured: () => token !== null,
    source: () =>
      token === null
        ? null
        : { kind: 'raster-tiles', tiles: [`${ESRI_TILE_TEMPLATE}?token=${token}`], tileSize: 256 },
    imageryDate: ESRI_IMAGERY_DATE,
    offline: false,
    detail: 'high',
    cameraMaxZoom: null,
    cameraBounds: null,
    caption: 'Esri World Imagery — satellite imagery, not live.',
    notice: null,
    origins: [ESRI_ORIGIN],
    probeUrl: () => (token === null ? null : `${SERVICE}?f=json&token=${token}`),
  };
}
