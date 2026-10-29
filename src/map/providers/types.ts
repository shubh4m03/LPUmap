/**
 * Map-provider contract (docs/MAP_PROVIDER_CONFIGURATION.md §modes). Owner
 * decisions 2026-10-24: free sources only, no billing account. Therefore:
 *  - satellite imagery comes only from a provider that needs no billing; with
 *    no key configured, Satellite 2D is shown as "not configured" (never faked);
 *  - Photorealistic 3D has NO provider: Google Photorealistic 3D Tiles need a
 *    billing account and their coverage at LPU is unverified (likely absent).
 *    The mode exists only as a clearly unavailable option, and it is never
 *    imitated with our own extruded buildings;
 *  - Google Maps / Earth / Street View are never a data source;
 *  - third-party tiles are never precached or cached for offline use
 *    (`offline: false` is part of the type).
 *
 * This file holds types and the fixed facts every implementation must share.
 * Implementations (registry, capability detection, MapLibre wiring) live in
 * the rest of src/map/providers/ (owned by map-providers).
 */
import type { LngLat } from '../../data/index.ts';

// ---------------------------------------------------------------------------
// Attribution (rendered as text nodes and links — never as HTML)
// ---------------------------------------------------------------------------

/** One attribution fragment. Rendered with textContent; `href` (https only) becomes a link. */
export interface AttributionPart {
  text: string;
  href?: string;
}

export interface ProviderAttribution {
  /** In display order, e.g. [{text:'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'}]. */
  parts: readonly AttributionPart[];
  /**
   * Text the provider requires to be visible whenever its content is shown
   * (e.g. "Powered by Esri"), or null. Shown as text unless a self-hosted,
   * licence-approved logo asset is added later.
   */
  requiredLogoText: string | null;
}

// ---------------------------------------------------------------------------
// Imagery date (never "live")
// ---------------------------------------------------------------------------

/**
 * When the imagery over the campus was captured, as the provider officially
 * states it. Only a published capture date qualifies — a year inside a
 * copyright notice is NOT a capture date. Null when unknown.
 */
export interface ImageryDateMetadata {
  /** Capture date, YYYY-MM-DD. */
  capturedOn: string;
  /** Ground resolution in metres, when stated. */
  resolutionM: number | null;
  /** Sensor / product, when stated (e.g. 'WorldView-3'). */
  sensor: string | null;
  /** Where the date comes from (e.g. 'Esri World Imagery metadata service, queried 2026-10-24'). */
  source: string;
  /** Link to the source or our record of it (docs/IMAGERY_COVERAGE_AND_FRESHNESS.md). */
  sourceUrl: string | null;
  /** Date the metadata was checked, YYYY-MM-DD (imagery can be replaced after this). */
  checkedOn: string;
  /**
   * The area where this date was actually verified, [west, south, east, north]. The date is shown
   * only while the view centre is inside it; elsewhere the UI says the date is not verified.
   */
  verifiedBounds: readonly [number, number, number, number];
  /** The one sentence the UI shows (exact wording; never "live"). */
  statement: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/** Raster XYZ tiles (MapLibre `raster` source) or a complete style URL. */
export type ImagerySource =
  | {
      kind: 'raster-tiles';
      /** Tile URL templates with {z}/{x}/{y}; a key is appended at runtime, never written into code. */
      tiles: readonly string[];
      tileSize: 256 | 512;
    }
  | { kind: 'style'; styleUrl: string };

export interface ImageryProvider {
  readonly kind: 'imagery';
  /** Stable id, e.g. 'esri-world-imagery'. */
  readonly id: string;
  /** User-facing name, e.g. 'Esri World Imagery'. */
  readonly label: string;
  readonly attribution: ProviderAttribution;
  readonly minZoom: number;
  /** Highest zoom with real imagery at LPU (over-zoom beyond it, never request it). */
  readonly maxZoom: number;
  /** The provider needs an API key (supplied only through .env.local / build env). */
  readonly requiresKey: boolean;
  /** True when everything needed (e.g. the key) is present in this build. Pure; no network. */
  configured(): boolean;
  /** The tile source, or null when not configured. */
  source(): ImagerySource | null;
  /** Official capture date over the campus, or null when the provider publishes none. */
  readonly imageryDate: ImageryDateMetadata | null;
  /** Third-party imagery is never cached for offline use (licences forbid it; PWA rules exclude it). */
  readonly offline: false;
  /**
   * 'high': individual campus buildings are recognisable (usable under Campus 3D);
   * 'low': context only (e.g. 10 m Sentinel-2), never shown at building zooms.
   */
  readonly detail: 'high' | 'low';
  /** Highest camera zoom while this imagery is shown (null = the app's normal limit). */
  readonly cameraMaxZoom: number | null;
  /**
   * Panning limit [w, s, e, n] while this imagery is shown (null = APP_CONFIG.map.maxBounds).
   * A low-zoom backdrop needs room: the campus limit keeps a wide screen above its zoom cap.
   */
  readonly cameraBounds: readonly [number, number, number, number] | null;
  /** One line shown with the imagery (what it is; never "live"). */
  readonly caption: string;
  /** A warning that must stay visible with the imagery (e.g. '10 m imagery — buildings not visible'), or null. */
  readonly notice: string | null;
  /** Exact https origins the browser contacts (CSP connect-src; tests keep public/_headers in step). */
  readonly origins: readonly string[];
  /** Optional one-request capability check (service metadata, no imagery), or null. */
  probeUrl(): string | null;
}

/** Photorealistic 3D: no billing-free provider exists, so the only state is 'unavailable'. */
export interface PhotorealProvider {
  readonly kind: 'photoreal';
  readonly id: 'none';
  readonly label: string;
  readonly status: 'unavailable';
  /** One sentence for the mode switcher. */
  readonly reason: string;
  /** Longer explanation for an info dialog. */
  readonly detail: string;
}

/** Optional elevation (e.g. self-hosted terrarium tiles); none is configured today. */
export interface TerrainProvider {
  readonly kind: 'terrain';
  readonly id: string;
  readonly label: string;
  readonly attribution: ProviderAttribution;
  readonly encoding: 'terrarium' | 'mapbox';
  readonly tiles: readonly string[];
  readonly tileSize: 256 | 512;
  readonly maxZoom: number;
  readonly requiresKey: boolean;
  configured(): boolean;
  /** Self-hosted terrain may be precached; third-party terrain may not. */
  readonly offline: boolean;
}

export interface ProviderRegistry {
  /** In preference order; the first available one is used. */
  imagery: readonly ImageryProvider[];
  photoreal: PhotorealProvider;
  terrain: TerrainProvider | null;
}

// ---------------------------------------------------------------------------
// Capability detection and fallback
// ---------------------------------------------------------------------------

/** Why a provider cannot be used right now. Each has a user-facing reason. */
export type ProviderFailure =
  /** No key / not set up in this build. */
  | 'not-configured'
  /** No provider exists (Photorealistic 3D). */
  | 'unavailable'
  /** The provider refused the key (401/403). */
  | 'auth'
  /** Quota or rate limit (429, quota errors). */
  | 'quota'
  /** Offline or the provider could not be reached. */
  | 'network'
  /** This browser cannot draw it (no WebGL). */
  | 'unsupported';

export type ProviderStatus =
  | { state: 'available'; providerId: string }
  /** Checking at runtime (first tiles not yet loaded). */
  | { state: 'checking'; providerId: string }
  | { state: 'failed'; failure: ProviderFailure; reason: string; providerId: string | null };

/** What this build + browser + network can show; drives the mode switcher and fallbacks. */
export interface CapabilityReport {
  webgl: boolean;
  online: boolean;
  imagery: ProviderStatus;
  photoreal: ProviderStatus & { state: 'failed'; failure: 'unavailable' };
  terrain: ProviderStatus | null;
}

/** Camera pose shared across MapLibre modes (the isometric overview converts it; see map-controller.ts). */
export interface ProviderCamera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

/**
 * For each provider-backed view mode (src/app/view-mode.ts): null when it can be
 * shown, else the user-facing reason. Filled by `viewModeAvailability`.
 */
export interface ViewModeAvailability {
  satellite: string | null;
  photoreal: string | null;
}

// ---------------------------------------------------------------------------
// Fixed facts and reasons (truthful; reused by view-mode.ts and the UI)
// ---------------------------------------------------------------------------

export const PHOTOREAL_UNAVAILABLE_REASON = 'Not available: no free photorealistic 3D source covers LPU.';

export const PHOTOREAL_UNAVAILABLE_DETAIL =
  'Photorealistic 3D needs Google Photorealistic 3D Tiles, which require a Google Cloud billing account. ' +
  'This site uses free sources only, and Google’s 3D coverage of LPU is unverified and likely absent. ' +
  // Not "verified": the campus buildings are imported OpenStreetMap footprints and owner-placed models.
  'The 3D map shows our own campus buildings instead (mapped footprints and owner-placed models); it is not photorealistic.';

export const PHOTOREAL_PROVIDER: PhotorealProvider = {
  kind: 'photoreal',
  id: 'none',
  label: 'Photorealistic 3D',
  status: 'unavailable',
  reason: PHOTOREAL_UNAVAILABLE_REASON,
  detail: PHOTOREAL_UNAVAILABLE_DETAIL,
};

export const SATELLITE_NOT_CONFIGURED_REASON =
  'Not configured: this site has no satellite imagery source set up.';

/** User-facing reason for each failure (the provider label is prepended by the UI when useful). */
export const PROVIDER_FAILURE_REASONS: Readonly<Record<ProviderFailure, string>> = {
  'not-configured': SATELLITE_NOT_CONFIGURED_REASON,
  unavailable: PHOTOREAL_UNAVAILABLE_REASON,
  auth: 'The imagery provider refused this site’s key. Showing the campus map instead.',
  quota: 'The imagery provider’s free limit has been reached for now. Showing the campus map instead.',
  network: 'Satellite imagery could not be loaded (offline or unreachable). Showing the campus map instead.',
  unsupported: 'This browser cannot draw the interactive map (no WebGL). The overview works without it.',
};
