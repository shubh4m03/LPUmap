/**
 * Licence and attribution of publishers that curated records cite (G-07).
 * Every source in manifest.sources must state both; a curated entry may state
 * them itself (`license`, `attribution`, optional `licenseUrl`), otherwise its
 * URL must belong to a publisher listed here, otherwise the build fails.
 *
 * Only add a publisher after reading its terms, and quote where they are
 * recorded (docs/GEODATA_SOURCES_AND_LICENSES.md).
 */
export interface SourceTerms {
  license: string;
  attribution: string;
  licenseUrl?: string;
}

/**
 * www.lpu.in. Its terms (https://www.lpu.in/terms-conditions.php, recorded in
 * docs/GEODATA_SOURCES_AND_LICENSES.md §13 and docs/research/LPU_PUBLIC_SOURCES.md)
 * reserve all rights and allow personal, non-commercial viewing only. The atlas
 * cites a page to identify an official name; it reproduces no content (no prose,
 * images, logos or maps), so no licence is claimed.
 */
export const LPU_TERMS: SourceTerms = {
  license: 'All rights reserved (© Lovely Professional University); facts cited, no content reproduced',
  attribution: 'Cited for identification only; © Lovely Professional University (www.lpu.in)',
  licenseUrl: 'https://www.lpu.in/terms-conditions.php',
};

const PUBLISHERS: ReadonlyArray<{ host: string; terms: SourceTerms }> = [
  { host: 'lpu.in', terms: LPU_TERMS },
];

/** Terms of the publisher that hosts `url` (the host itself or a subdomain), or null. */
export function publisherTerms(url: string | undefined): SourceTerms | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return PUBLISHERS.find((p) => host === p.host || host.endsWith(`.${p.host}`))?.terms ?? null;
}
