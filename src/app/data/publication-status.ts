/**
 * The state of the owner's publication layer and its user-facing wording
 * (kept apart from ./publication.ts so panels can show it without the schema).
 */

export type PublicationFailure = 'offline' | 'timeout' | 'network' | 'http' | 'invalid';

export type PublicationStatus =
  | { kind: 'live'; publicationVersion: number; generatedAt: string; buildings: number }
  | {
      kind: 'saved';
      publicationVersion: number;
      generatedAt: string;
      buildings: number;
      savedAt: string;
      reason: PublicationFailure;
    }
  | { kind: 'unavailable' }
  | { kind: 'failed'; reason: PublicationFailure };

const FAILURE_TEXT: Record<PublicationFailure, string> = {
  offline: 'you are offline',
  timeout: 'the server did not answer in time',
  network: 'the server could not be reached',
  http: 'the server reported an error',
  invalid: 'the server sent data this version cannot read',
};

/** "24 Oct 2026, 10:30 am" in campus time; the raw text when it cannot be parsed. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

const buildingsText = (n: number) =>
  n === 0 ? '' : ` · ${n} owner-placed ${n === 1 ? 'building' : 'buildings'}`;

/**
 * One truthful line for the About panel: when the owner's corrections and
 * additions last changed, whether this is a saved copy, or why only the base
 * dataset is shown. `studioSkipped` = published buildings that could not be
 * re-checked against the campus boundary and are therefore not shown.
 */
export function publicationStatusText(status: PublicationStatus, studioSkipped = 0): string {
  const skipped =
    studioSkipped > 0
      ? ` ${studioSkipped} owner-placed ${studioSkipped === 1 ? 'building is' : 'buildings are'} not shown: the campus boundary review could not be loaded.`
      : '';
  switch (status.kind) {
    case 'live':
      return status.publicationVersion === 0
        ? 'None published yet.'
        : `Last updated ${formatDateTime(status.generatedAt)}${buildingsText(status.buildings)}.${skipped}`;
    case 'saved':
      return `Saved copy from ${formatDateTime(status.savedAt)} (last updated ${formatDateTime(status.generatedAt)}${buildingsText(status.buildings)}): could not refresh because ${FAILURE_TEXT[status.reason]}.${skipped}`;
    case 'unavailable':
      return 'Not available on this site: showing the base dataset only.';
    case 'failed':
      return `Could not be loaded because ${FAILURE_TEXT[status.reason]}: showing the base dataset only.`;
  }
}
