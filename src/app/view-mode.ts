/**
 * View modes (docs/ISOMETRIC_AND_3D_DESIGN.md §8, Decision D7;
 * docs/MAP_PROVIDER_CONFIGURATION.md §modes). Pure helpers: the `?view=`
 * deep-link parameter, the per-mode capability matrix with user-facing
 * reasons, provider availability and fallbacks, and the derived `mode3d`
 * kept for backward compatibility.
 *
 * Five modes, one flat list (the simplest model that gives five clearly
 * labelled options; the basemap is a property of the mode, not a second axis):
 *
 *   id            ?view=      renderer   imagery                   availability
 *   satellite2d   satellite   MapLibre   required                  only with a configured free imagery provider
 *   photoreal3d   earth       —          —                         never today (no billing-free source)
 *   realistic3d   3d          MapLibre   optional (when available) always (WebGL)
 *   isometric     iso         Canvas2D   none                      always
 *   standard2d    2d          MapLibre   none                      always (WebGL)
 */
import { PHOTOREAL_UNAVAILABLE_REASON, SATELLITE_NOT_CONFIGURED_REASON } from '../map/providers/types.ts';

export type ViewMode = 'realistic3d' | 'isometric' | 'standard2d' | 'satellite2d' | 'photoreal3d';
/** Modes rendered by MapLibre (live GPS works only here). */
export type MapViewMode = 'realistic3d' | 'standard2d' | 'satellite2d';
/** Why the mode changed (for announcements and analytics-free debugging). */
export type ViewModeChangeReason = 'user' | 'deep-link' | 'navigation' | 'fallback';

/**
 * The three modes the current switcher shows (unchanged). The five-option
 * switcher uses VIEW_MODE_OPTIONS.
 */
export const VIEW_MODES: readonly ViewMode[] = ['realistic3d', 'isometric', 'standard2d'];

/** All five modes in the owner's order, for the full switcher (unavailable ones stay visible with a reason). */
export const VIEW_MODE_OPTIONS: readonly ViewMode[] = [
  'satellite2d',
  'photoreal3d',
  'realistic3d',
  'isometric',
  'standard2d',
];

/** Short visible labels (under the switcher icons). */
export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  realistic3d: '3D',
  isometric: 'Overview',
  standard2d: '2D',
  satellite2d: 'Satellite',
  photoreal3d: 'Photoreal',
};

/** Accessible names of the mode switcher options (the visible labels stay short). */
export const VIEW_MODE_NAMES: Record<ViewMode, string> = {
  realistic3d: '3D map',
  isometric: 'Isometric overview',
  standard2d: '2D map',
  satellite2d: 'Satellite map',
  photoreal3d: 'Photorealistic 3D',
};

/** The owner's five option titles (menus, settings, docs). */
export const VIEW_MODE_TITLES: Record<ViewMode, string> = {
  satellite2d: 'Satellite 2D',
  photoreal3d: 'Photorealistic 3D',
  realistic3d: 'Campus 3D',
  isometric: 'Isometric overview',
  standard2d: 'Campus map 2D',
};

/** One-line truthful description of what each mode shows. */
export const VIEW_MODE_DESCRIPTIONS: Record<ViewMode, string> = {
  satellite2d: 'Satellite imagery with the campus places and paths on top. Imagery is not live.',
  photoreal3d: 'Photorealistic 3D scenery. Not available for LPU (no free source).',
  realistic3d:
    'Our verified campus buildings and owner-made models in 3D, on satellite imagery when it is configured.',
  isometric: 'An illustrated overview of the campus buildings.',
  standard2d: 'The flat campus map drawn from open data.',
};

/** How a mode uses satellite imagery. */
export type ImageryUse = 'required' | 'optional' | 'none';
export const VIEW_MODE_IMAGERY: Readonly<Record<ViewMode, ImageryUse>> = {
  satellite2d: 'required',
  realistic3d: 'optional',
  photoreal3d: 'none',
  isometric: 'none',
  standard2d: 'none',
};

const MAP_VIEW_MODES: ReadonlySet<ViewMode> = new Set<ViewMode>(['realistic3d', 'standard2d', 'satellite2d']);
export const isMapViewMode = (m: ViewMode): m is MapViewMode => MAP_VIEW_MODES.has(m);
/** Backward-compatible `mode3d`: true only in Realistic 3D. */
export const mode3dFor = (m: ViewMode): boolean => m === 'realistic3d';

// ---------------------------------------------------------------------------
// ?view=3d|iso|2d|satellite|earth
// ---------------------------------------------------------------------------

export const VIEW_PARAM = 'view';
const PARAM_TO_MODE: Record<string, ViewMode> = {
  '3d': 'realistic3d',
  iso: 'isometric',
  '2d': 'standard2d',
  satellite: 'satellite2d',
  earth: 'photoreal3d',
};
const MODE_TO_PARAM: Record<ViewMode, string> = {
  realistic3d: '3d',
  isometric: 'iso',
  standard2d: '2d',
  satellite2d: 'satellite',
  photoreal3d: 'earth',
};

/** The view mode in a query string, or null when absent or unknown (unknown values are ignored). */
export function parseViewParam(search: string): ViewMode | null {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get(VIEW_PARAM);
  } catch {
    return null;
  }
  if (value === null) return null;
  return PARAM_TO_MODE[value.trim().toLowerCase()] ?? null;
}

export const viewModeToParam = (m: ViewMode): string => MODE_TO_PARAM[m];

/** `href` with `?view=` set (or removed when null); other params and the hash are kept. */
export function buildViewUrl(href: string, mode: ViewMode | null): string {
  const url = new URL(href);
  if (mode === null) url.searchParams.delete(VIEW_PARAM);
  else url.searchParams.set(VIEW_PARAM, viewModeToParam(mode));
  return url.toString();
}

// ---------------------------------------------------------------------------
// Provider availability (src/map/providers fills it at runtime)
// ---------------------------------------------------------------------------

/** For each provider-backed mode: null when it can be shown, else the user-facing reason. */
export interface ViewModeAvailability {
  satellite: string | null;
  photoreal: string | null;
}

/**
 * Until the provider registry reports otherwise: no imagery is configured and
 * photorealistic 3D has no source. Fail-safe: a mode is never offered on a guess.
 */
export const DEFAULT_VIEW_MODE_AVAILABILITY: ViewModeAvailability = {
  satellite: SATELLITE_NOT_CONFIGURED_REASON,
  photoreal: PHOTOREAL_UNAVAILABLE_REASON,
};

/** Why a provider-backed mode cannot be used, or null (modes without a provider are never blocked here). */
export function providerBlockedReason(
  mode: ViewMode,
  availability: ViewModeAvailability = DEFAULT_VIEW_MODE_AVAILABILITY,
): string | null {
  if (mode === 'photoreal3d') return availability.photoreal ?? null;
  if (mode === 'satellite2d') return availability.satellite;
  return null;
}

/**
 * The mode a `?view=` link asks for, or null when absent, unknown or not
 * available in this build (the device default then applies; the link never
 * opens a mode that would have to be faked).
 */
export function deepLinkViewMode(
  search: string,
  availability: ViewModeAvailability = DEFAULT_VIEW_MODE_AVAILABILITY,
): ViewMode | null {
  const mode = parseViewParam(search);
  if (mode === null || providerBlockedReason(mode, availability) !== null) return null;
  return mode;
}

// ---------------------------------------------------------------------------
// Capability matrix (§8.2)
// ---------------------------------------------------------------------------

export type ViewCapability =
  | 'select'
  | 'search'
  | 'directory'
  | 'route-plan'
  | 'pick-endpoint'
  | 'live-location'
  | 'live-navigation'
  | 'follow-me'
  | 'free-rotate'
  | 'pitch';

export interface CapabilitySupport {
  supported: boolean;
  /** User-facing sentence when unsupported (shown/announced, never silently hidden). */
  reason: string | null;
}

const yes: CapabilitySupport = { supported: true, reason: null };
const no = (reason: string): CapabilitySupport => ({ supported: false, reason });

const LIVE_IN_MAP = 'Live location and navigation use the map view. Switch to 3D or 2D.';
const NOT_AVAILABLE = no(PHOTOREAL_UNAVAILABLE_REASON);

const FLAT_MAP: Readonly<Record<ViewCapability, CapabilitySupport>> = {
  select: yes,
  search: yes,
  directory: yes,
  'route-plan': yes,
  'pick-endpoint': yes,
  'live-location': yes,
  'live-navigation': yes,
  'follow-me': yes,
  'free-rotate': no('The 2D map stays north-up. Switch to 3D to rotate.'),
  pitch: no('The 2D map is flat. Switch to 3D to tilt.'),
};

export const VIEW_MODE_SUPPORT: Readonly<
  Record<ViewMode, Readonly<Record<ViewCapability, CapabilitySupport>>>
> = {
  realistic3d: {
    select: yes,
    search: yes,
    directory: yes,
    'route-plan': yes,
    'pick-endpoint': yes,
    'live-location': yes,
    'live-navigation': yes,
    'follow-me': yes,
    'free-rotate': yes,
    pitch: yes,
  },
  isometric: {
    select: yes,
    search: yes,
    directory: yes,
    'route-plan': yes,
    'pick-endpoint': yes,
    'live-location': no(LIVE_IN_MAP),
    'live-navigation': no(LIVE_IN_MAP),
    'follow-me': no(LIVE_IN_MAP),
    'free-rotate': no('The overview rotates in 90° steps.'),
    pitch: no('The overview uses a fixed viewing angle.'),
  },
  standard2d: FLAT_MAP,
  satellite2d: FLAT_MAP,
  // The mode cannot be entered; every capability says why.
  photoreal3d: {
    select: NOT_AVAILABLE,
    search: NOT_AVAILABLE,
    directory: NOT_AVAILABLE,
    'route-plan': NOT_AVAILABLE,
    'pick-endpoint': NOT_AVAILABLE,
    'live-location': NOT_AVAILABLE,
    'live-navigation': NOT_AVAILABLE,
    'follow-me': NOT_AVAILABLE,
    'free-rotate': NOT_AVAILABLE,
    pitch: NOT_AVAILABLE,
  },
};

export const supports = (mode: ViewMode, cap: ViewCapability): CapabilitySupport =>
  VIEW_MODE_SUPPORT[mode][cap];

/** Shown on the disabled overview option while live navigation runs. */
export const ISOMETRIC_DURING_NAVIGATION_REASON = 'Not available during live navigation';

/** Why the map modes are disabled when this browser cannot draw the map (no WebGL). */
export const MAP_UNAVAILABLE_REASON =
  'This browser cannot draw the interactive map (no WebGL). The overview works without it.';

/** Announcement when the overview replaces a map that cannot run. */
export const OVERVIEW_FALLBACK_ANNOUNCEMENT =
  'The interactive map cannot run in this browser. Showing the isometric overview instead.';

/** Announcement when live location starts in the overview (it has no live GPS, §8.2). */
export function locationSwitchAnnouncement(to: MapViewMode): string {
  return `Live location uses the map view. Switched to ${VIEW_MODE_NAMES[to]}.`;
}

/** Announcement when navigation forces a map mode. */
export function navigationSwitchAnnouncement(to: MapViewMode): string {
  return `Live navigation uses the map view. Switched to ${VIEW_MODE_NAMES[to]}.`;
}

/**
 * True when this browser can draw the Canvas2D overview (the fallback when
 * WebGL is missing). False in non-browser environments.
 */
export function supportsCanvas2D(): boolean {
  if (typeof document === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

export interface ViewModeBlockState {
  navigationActive: boolean;
  mapUnavailable: string | null;
  /** Provider availability; defaults to DEFAULT_VIEW_MODE_AVAILABILITY (nothing configured). */
  availability?: ViewModeAvailability;
}

/** Why `mode` cannot be chosen right now, or null when it can (shown, never silently hidden). */
export function viewModeBlockedReason(mode: ViewMode, state: ViewModeBlockState): string | null {
  if (mode === 'photoreal3d') return providerBlockedReason(mode, state.availability);
  if (mode === 'isometric' && state.navigationActive) return ISOMETRIC_DURING_NAVIGATION_REASON;
  if (isMapViewMode(mode) && state.mapUnavailable !== null) return state.mapUnavailable;
  return providerBlockedReason(mode, state.availability);
}

// ---------------------------------------------------------------------------
// Fallbacks (missing key, quota, network, no WebGL — never a blank screen)
// ---------------------------------------------------------------------------

/** Where each mode falls back to, in order, when it cannot be shown. */
export const VIEW_MODE_FALLBACKS: Readonly<Record<ViewMode, readonly ViewMode[]>> = {
  photoreal3d: ['realistic3d', 'standard2d', 'isometric'],
  satellite2d: ['standard2d', 'isometric'],
  realistic3d: ['standard2d', 'isometric'],
  standard2d: ['isometric'],
  isometric: [],
};

export interface ResolvedViewMode {
  /** The mode to show. */
  mode: ViewMode;
  /** The requested mode when a fallback was used, else null. */
  fallbackFrom: ViewMode | null;
  /** Why the requested mode could not be shown (announce it), else null. */
  reason: string | null;
}

/**
 * The first showable mode of `requested` and its fallback chain. When nothing
 * in the chain is showable (e.g. no WebGL during navigation) the overview is
 * returned: it needs neither WebGL nor a provider.
 */
export function resolveViewMode(requested: ViewMode, state: ViewModeBlockState): ResolvedViewMode {
  const reason = viewModeBlockedReason(requested, state);
  if (reason === null) return { mode: requested, fallbackFrom: null, reason: null };
  for (const m of VIEW_MODE_FALLBACKS[requested]) {
    if (viewModeBlockedReason(m, state) === null) return { mode: m, fallbackFrom: requested, reason };
  }
  return { mode: 'isometric', fallbackFrom: requested, reason };
}
