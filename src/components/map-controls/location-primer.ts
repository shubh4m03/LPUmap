/**
 * The explanation shown before the browser's own location permission prompt
 * (G-15): why the atlas asks, and what it never does with the location.
 */
export const LOCATION_PRIMER_TITLE = 'Show your location?';
export const LOCATION_PRIMER_TEXT =
  'Campus Atlas uses your location only on this device, to show where you are on the campus map and follow your route. It is never stored or sent anywhere. Your browser will ask for permission next.';
export const LOCATION_PRIMER_STOP = 'You can turn it off at any time with the same button.';

/** The purpose is explained at most once per page session (the browser remembers its own answer). */
let explained = false;

export function markLocationPrimerShown(): void {
  explained = true;
}

/** Test seam: forget that the explanation was shown. */
export function resetLocationPrimer(): void {
  explained = false;
}

/**
 * True when the browser is about to show its permission prompt: the
 * Permissions API says 'prompt', or cannot tell (no API, or it throws).
 * Already granted or already blocked → no explanation first (a block is
 * explained by the watcher's 'denied' message, which says how to allow it).
 * No geolocation at all → none either (the watcher reports 'unsupported').
 */
export async function locationPromptExpected(): Promise<boolean> {
  if (explained) return false;
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return false;
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' });
    return !status || status.state === 'prompt';
  } catch {
    return true;
  }
}
