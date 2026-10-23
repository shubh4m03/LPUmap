import { CORRECTION_KIND_LABELS, isHttpUrl } from './correction.ts';
import type { CorrectionDraft } from './correction.ts';

/** Browsers and issue trackers reject very long URLs; keep well below common limits. */
export const ISSUE_URL_MAX_LENGTH = 6000;
const TITLE_MAX = 120;
const DETAILS_TRUNCATION_NOTE =
  '\n\n[Details truncated to fit in a link. Use "Copy report" for the full text.]';
const REPORT_TRUNCATION_NOTE =
  '\n\n[Report truncated to fit in a link. Use "Copy report" for the full text.]';

function reportText(d: CorrectionDraft, datasetVersion: string, details: string): string {
  return [
    'LPU Campus Atlas — data correction',
    '',
    `Type: ${CORRECTION_KIND_LABELS[d.kind]}`,
    `Place: ${d.placeName ?? '(not specified)'}`,
    `Place id: ${d.placeId ?? '(not specified)'}`,
    '',
    'Details:',
    details,
    '',
    `Source: ${d.sourceUrl ?? '(none given)'}`,
    `Dataset version: ${datasetVersion.trim() || 'unknown'}`,
  ].join('\n');
}

/**
 * Plain-text report. Contains only what the user entered plus the dataset
 * version — never the user's location, device or browser details.
 */
export function correctionToText(d: CorrectionDraft, datasetVersion: string): string {
  return reportText(d, datasetVersion, d.details.trim());
}

export function correctionTitle(d: CorrectionDraft): string {
  const title = `[Correction] ${CORRECTION_KIND_LABELS[d.kind]}: ${d.placeName ?? d.placeId ?? 'General'}`;
  const chars = Array.from(title);
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX - 1).join('')}…` : title;
}

function readConfiguredUrl(): string | undefined {
  const value: unknown = import.meta.env.VITE_CORRECTIONS_URL;
  return typeof value === 'string' ? value : undefined;
}

/** The configured corrections URL if it is a valid https URL, else null. */
export function correctionsBaseUrl(raw: string | undefined = readConfiguredUrl()): URL | null {
  const trimmed = raw?.trim();
  if (!trimmed || !isHttpUrl(trimmed)) return null;
  const url = new URL(trimmed);
  return url.protocol === 'https:' ? url : null;
}

function buildUrl(base: URL, title: string, body: string): string {
  const url = new URL(base.href);
  url.searchParams.set('title', title);
  url.searchParams.set('body', body);
  return url.href;
}

/**
 * Largest prefix (in code points, so multi-byte characters are never split) of
 * `text` whose link fits; URL length grows monotonically with the prefix, so a
 * binary search finds it. Returns null when even an empty prefix does not fit.
 */
function fitPrefix(text: string, toUrl: (prefix: string) => string): string | null {
  const chars = Array.from(text);
  const urlFor = (n: number): string => toUrl(chars.slice(0, n).join(''));
  if (urlFor(0).length > ISSUE_URL_MAX_LENGTH) return null;
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (urlFor(mid).length <= ISSUE_URL_MAX_LENGTH) lo = mid;
    else hi = mid - 1;
  }
  return urlFor(lo);
}

/**
 * Prefilled "new issue" style link (`?title=…&body=…`) for the configured
 * corrections tracker, or null when none is configured (the UI then offers
 * copy/download only). To stay within ISSUE_URL_MAX_LENGTH the details are
 * shortened first, so the place, source and dataset version survive; only if
 * those alone are too long is the whole body cut. The third parameter exists
 * for tests.
 */
export function correctionIssueUrl(
  d: CorrectionDraft,
  datasetVersion: string,
  configuredUrl: string | undefined = readConfiguredUrl(),
): string | null {
  const base = correctionsBaseUrl(configuredUrl);
  if (!base) return null;
  const title = correctionTitle(d);
  const full = buildUrl(base, title, correctionToText(d, datasetVersion));
  if (full.length <= ISSUE_URL_MAX_LENGTH) return full;

  return (
    fitPrefix(d.details.trim(), (details) =>
      buildUrl(base, title, reportText(d, datasetVersion, details + DETAILS_TRUNCATION_NOTE)),
    ) ??
    // Only reachable with very long place/source fields or an absurdly long base URL.
    fitPrefix(correctionToText(d, datasetVersion), (body) =>
      buildUrl(base, title, body + REPORT_TRUNCATION_NOTE),
    )
  );
}
