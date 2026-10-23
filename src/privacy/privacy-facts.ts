/**
 * Plain statements shown in the privacy panel. Keep them literally true for
 * this build: there is no backend, no analytics and no third-party requests,
 * so nothing a user does leaves the device unless they copy, download or open
 * a correction link themselves.
 */
export interface PrivacyFact {
  id: string;
  title: string;
  detail: string;
}

export const PRIVACY_FACTS: readonly PrivacyFact[] = [
  {
    id: 'no-account',
    title: 'No account, no tracking',
    detail:
      'The app has no sign-in, no analytics, no advertising and no server of its own. It only downloads its own files (the app and the campus dataset).',
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
