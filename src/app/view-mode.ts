/**
 * View modes (docs/ISOMETRIC_AND_3D_DESIGN.md §8, Decision D7). Pure helpers:
 * the `?view=` deep-link parameter, the per-mode capability matrix with
 * user-facing reasons, and the derived `mode3d` kept for backward compatibility.
 */

export type ViewMode = 'realistic3d' | 'isometric' | 'standard2d';
/** Modes rendered by MapLibre (live GPS works only here). */
export type MapViewMode = Exclude<ViewMode, 'isometric'>;
/** Why the mode changed (for announcements and analytics-free debugging). */
export type ViewModeChangeReason = 'user' | 'deep-link' | 'navigation' | 'fallback';

export const VIEW_MODES: readonly ViewMode[] = ['realistic3d', 'isometric', 'standard2d'];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  realistic3d: '3D',
  isometric: 'Overview',
  standard2d: '2D',
};

/** Accessible names of the mode switcher options (the visible labels stay short). */
export const VIEW_MODE_NAMES: Record<ViewMode, string> = {
  realistic3d: '3D map',
  isometric: 'Isometric overview',
  standard2d: '2D map',
};

export const isMapViewMode = (m: ViewMode): m is MapViewMode => m !== 'isometric';
/** Backward-compatible `mode3d`: true only in Realistic 3D. */
export const mode3dFor = (m: ViewMode): boolean => m === 'realistic3d';

// ---------------------------------------------------------------------------
// ?view=3d|iso|2d
// ---------------------------------------------------------------------------

export const VIEW_PARAM = 'view';
const PARAM_TO_MODE: Record<string, ViewMode> = { '3d': 'realistic3d', iso: 'isometric', '2d': 'standard2d' };
const MODE_TO_PARAM: Record<ViewMode, string> = { realistic3d: '3d', isometric: 'iso', standard2d: '2d' };

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
  standard2d: {
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
  return `Live location uses the map view. Switched to ${to === 'realistic3d' ? '3D map' : '2D map'}.`;
}

/** Announcement when navigation forces a map mode. */
export function navigationSwitchAnnouncement(to: MapViewMode): string {
  return `Live navigation uses the map view. Switched to ${to === 'realistic3d' ? '3D map' : '2D map'}.`;
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

/** Why `mode` cannot be chosen right now, or null when it can (shown, never silently hidden). */
export function viewModeBlockedReason(
  mode: ViewMode,
  state: { navigationActive: boolean; mapUnavailable: string | null },
): string | null {
  if (mode === 'isometric' && state.navigationActive) return ISOMETRIC_DURING_NAVIGATION_REASON;
  if (isMapViewMode(mode) && state.mapUnavailable !== null) return state.mapUnavailable;
  return null;
}
