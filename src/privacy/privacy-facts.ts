/**
 * Plain statements shown in the privacy panel. Keep them literally true for
 * this build: no analytics; third-party requests only for satellite imagery,
 * and only when this build configures an imagery provider
 * (src/map/providers; docs/MAP_PROVIDER_CONFIGURATION.md §Privacy). The site
 * has its own server (Pages Functions): the app reads the owner's published
 * updates from it, and "Suggest a missing place" sends the typed fields and
 * the chosen map point to it (server/handlers/contributions.ts; the IP is
 * only an HMAC rate-limit bucket, server/auth/rate-limit.ts). Nothing else a
 * user does leaves the device unless they copy, download or open a
 * correction link themselves.
 */
import { BUILD_PROVIDERS } from '../map/providers/runtime.ts';
import type { ProviderRegistry } from '../map/providers/types.ts';

export interface PrivacyFact {
  id: string;
  title: string;
  detail: string;
}

const BASE_FACTS: readonly PrivacyFact[] = [
  {
    id: 'no-account',
    title: 'No account, no tracking',
    detail:
      'The app has no sign-in, no analytics and no advertising. It only downloads its own files from this site (the app, the campus dataset and the site owner’s published updates), and sends nothing about you unless you submit a suggestion (below).',
  },
  {
    id: 'suggestions',
    title: 'Suggestions go to the site owner',
    detail:
      '“Suggest a missing place” sends only what you type and the map point you choose to this site’s server, where the site owner reviews it; nothing appears on the public map unless it is approved. Your location fix is never attached. To limit abuse, the server counts submissions per connection using a keyed one-way hash of your IP address that changes with each counting window (at most a day); the address itself is not stored.',
  },
  {
    id: 'location-on-device',
    title: 'Location stays on your device',
    detail:
      'Your location is requested only when you tap a location button. It is processed in the browser to show your position and route progress, and is never stored or sent anywhere.',
  },
  {
    id: 'stored-favorites',
    title: 'Favourites are saved locally',
    detail: 'Places you mark as favourites are saved in this browser’s local storage as a list of place ids.',
  },
  {
    id: 'stored-recents',
    title: 'Recent places are saved locally (optional)',
    detail:
      'Recently opened places are saved in local storage so you can return to them. Turn off “Save search history” to stop this and delete the existing list.',
  },
  {
    id: 'stored-settings',
    title: 'Settings are saved locally',
    detail: 'Display preferences such as theme and your privacy choices are saved in local storage.',
  },
  {
    id: 'correction-draft',
    title: 'Correction drafts last only for this session',
    detail:
      'A half-written correction is kept in session storage so it survives a reload; it is removed when the browser session ends. Reports are only shared if you copy, download or open them yourself, and never include your location.',
  },
  {
    id: 'offline-cache',
    title: 'Offline copy',
    detail:
      'The app and campus dataset are cached by the browser so the map works offline. The cache contains no personal data.',
  },
  {
    id: 'clear',
    title: 'You can delete everything',
    detail:
      '“Clear all local data” removes favourites, recent places, settings and drafts from this browser.',
  },
];

const hostOf = (origin: string): string => origin.replace(/^https:\/\//, '');

/**
 * The imagery statement for a build: which provider receives what, and when.
 * With no provider there is no third-party request to describe.
 */
export function imageryPrivacyFact(registry: ProviderRegistry): PrivacyFact | null {
  const imagery = registry.imagery[0];
  if (!imagery) return null;
  const hosts = imagery.origins.map(hostOf).join(', ');
  const modes =
    imagery.detail === 'high'
      ? 'Satellite 2D, and Campus 3D (which shows its buildings on the imagery)'
      : 'Satellite 2D';
  return {
    id: 'satellite-imagery',
    title: `Satellite imagery comes from ${imagery.label}`,
    detail:
      `In ${modes}, your browser downloads imagery tiles directly from ${hosts}. ` +
      'Like any website, that provider receives your IP address and which part of the map you are viewing; no account, search or location fix is sent, but while the map follows your live location the area you view shows roughly where you are. ' +
      'Imagery tiles are never stored for offline use. The 2D campus map and the isometric overview make no such requests.',
  };
}

/** The privacy facts of a build (the panel shows PRIVACY_FACTS, for this build). */
export function privacyFacts(registry: ProviderRegistry): readonly PrivacyFact[] {
  const imagery = imageryPrivacyFact(registry);
  if (!imagery) return BASE_FACTS;
  return BASE_FACTS.flatMap((f): PrivacyFact[] => {
    if (f.id === 'no-account')
      return [
        {
          ...f,
          detail:
            'The app has no sign-in, no analytics and no advertising. Apart from satellite imagery (below), it only downloads its own files from this site (the app, the campus dataset and the site owner’s published updates), and sends nothing about you unless you submit a suggestion (below).',
        },
        imagery,
      ];
    return [f];
  });
}

export const PRIVACY_FACTS: readonly PrivacyFact[] = privacyFacts(BUILD_PROVIDERS);
