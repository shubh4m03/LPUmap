/** Pure helpers for the directions panel: wording, eligibility and preference relevance. */
import { MY_LOCATION_LABEL } from '../../app/store/route-slice.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { formatSpeed } from '../../distance/index.ts';
import type { GeoStatus } from '../../geolocation/index.ts';
import type {
  RouteEndpoint,
  RoutePreference,
  RouteProfileId,
  RouteResult,
  Router,
} from '../../routing/index.ts';
import type { IconName } from '../ui/index.ts';

export interface ProfileCopy {
  label: string;
  icon: IconName;
  /** One line shown under the travel-mode control. */
  description: string;
}

export const PROFILE_COPY: Record<RouteProfileId, ProfileCopy> = {
  walk: {
    label: 'Walk',
    icon: 'walk',
    description: 'Footpaths, roads and mapped steps where walking is allowed.',
  },
  cycle: {
    label: 'Cycle',
    icon: 'bike',
    description: 'Rides where cycling is allowed; walks the bike where the map says to push.',
  },
  'step-free': {
    label: 'Step-free',
    icon: 'wheelchair',
    description: 'Avoids mapped steps only — the accessibility of most paths is not recorded.',
  },
};

export const PROFILE_ORDER: readonly RouteProfileId[] = ['walk', 'cycle', 'step-free'];

export const PREFERENCE_COPY: Record<RouteProfileId, string> = {
  walk: 'Least time counts mapped steps as slower to climb.',
  cycle: 'Least time favours riding over stretches where you push the bike.',
  'step-free': '',
};

const R = APP_CONFIG.routing;

/** Footnote naming the speed every duration is estimated from. */
export function paceFootnote(profile: RouteProfileId): string {
  if (profile === 'cycle') {
    return `Times estimated at ${formatSpeed(R.cycleSpeedMps)} riding and ${formatSpeed(R.pushBikeSpeedMps)} where you push the bike.`;
  }
  return `Times estimated at ${formatSpeed(R.walkSpeedMps)} walking pace.`;
}

/** Why live location cannot be used right now, or null when it can be requested. */
export function locationBlockReason(status: GeoStatus): string | null {
  if (status === 'denied') {
    return "Location access is blocked for this site. Allow it in your browser's site settings, then try again.";
  }
  if (status === 'unsupported') {
    return 'Location is not available in this browser (it needs location support and a secure https connection).';
  }
  return null;
}

/**
 * True when 'shortest' and 'least time' give different routes for this
 * request. They only differ where costs are not proportional to length
 * (walking steps, pushing a bike), so the control is hidden otherwise.
 */
export function preferenceMatters(
  router: Router,
  from: RouteEndpoint,
  to: RouteEndpoint,
  profile: RouteProfileId,
): boolean {
  if (profile === 'step-free') return false;
  const route = (preference: RoutePreference) => router.route({ from, to, profile, preference });
  const a = route('shortest');
  const b = route('fastest');
  if (!a.ok || !b.ok) return false;
  return a.edgeIds.length !== b.edgeIds.length || a.edgeIds.some((id, i) => id !== b.edgeIds[i]);
}

/**
 * Extra advice after a failed request — only suggestions that are true for
 * this request and not already part of the router's own message.
 */
export function failureAdvice(
  result: RouteResult,
  profile: RouteProfileId,
  origin: RouteEndpoint | null = null,
  destination: RouteEndpoint | null = null,
): string | null {
  if (result.ok) return null;
  if (result.reason === 'no-path' && profile === 'step-free') {
    return 'Try Walk: the step-free network leaves out every mapped step, so it is smaller than the walking one.';
  }
  const mine = (e: RouteEndpoint | null) => e?.kind === 'point' && e.label === MY_LOCATION_LABEL;
  if (
    (result.reason === 'origin-unsnappable' && mine(origin)) ||
    (result.reason === 'destination-unsnappable' && mine(destination))
  ) {
    return 'Your current position is far from the mapped paths (for example, off campus). Search for a place or choose a point on the map instead.';
  }
  return null;
}

export function endpointRoleLabel(role: 'origin' | 'destination'): string {
  return role === 'origin' ? 'start' : 'destination';
}
