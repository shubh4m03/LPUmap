/**
 * Search docs for the owner's campus illustration
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5). Only printed text is used:
 *
 *  - an artwork-only item (approximate or unresolved) is one 'artwork' doc,
 *    titled with its exact printed label (or a neutral description), findable
 *    by every exact label, by its artwork number ("25", "Block 25",
 *    "BLOCK-25"; the illustration's own numbering, never an official LPU block
 *    number) and by its search aliases (corrected spellings live only there);
 *  - a VERIFIED item is no doc of its own: its labels and number are added to
 *    its building's place doc (artworkTerms), so one building is one result;
 *  - a label held for the owner's review, and an area with nothing printed on
 *    it, are not searchable (they would only flood generic queries).
 */
import type { DirectoryArtworkLink } from '../directory/types.ts';
import type { ArtworkOnlyEntry } from '../isometric-art/directory.ts';
import { ASSOCIATION_STATUS_TEXT } from '../isometric-art/text.ts';
import type { SearchDoc } from './types.ts';

export const ARTWORK_DOC_PREFIX = 'artwork:';

/** Subtitle words of an artwork-only result (never "match", "location" or "verified" alone). */
export const ARTWORK_STATUS_TEXT = {
  approximate: ASSOCIATION_STATUS_TEXT.approximate.label,
  unresolved: ASSOCIATION_STATUS_TEXT.unresolved.label,
} as const;

const uniq = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = v.trim().toLowerCase();
    if (k === '' || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** '25' → ['25', 'Block 25']; '9' → also '09', 'Block 09' (the artwork prints "BLOCK- 09"). */
export function artworkNumberCodes(n: string | null): string[] {
  if (!n) return [];
  const padded = /^\d$/.test(n) ? [`0${n}`, `Block 0${n}`] : [];
  return [n, `Block ${n}`, ...padded];
}

export function docsFromArtwork(entries: readonly ArtworkOnlyEntry[]): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const e of entries) {
    if (e.labelWithheld) continue;
    if (e.labels.length === 0 && e.artworkNumber === null) continue;
    const status =
      e.association.status === 'approximate'
        ? ARTWORK_STATUS_TEXT.approximate
        : ARTWORK_STATUS_TEXT.unresolved;
    const number = e.artworkNumber !== null ? `No. ${e.artworkNumber} on the illustration` : null;
    docs.push({
      id: `${ARTWORK_DOC_PREFIX}${e.id}`,
      kind: 'artwork',
      title: e.title,
      subtitle: ['Campus illustration', number, status].filter(Boolean).join(' · '),
      aliases: uniq([
        ...e.labels.filter((l) => l.role !== 'category').map((l) => l.text),
        ...e.aliases,
      ]).filter((a) => a !== e.title),
      codes: artworkNumberCodes(e.artworkNumber),
      keywords: uniq(e.labels.filter((l) => l.role === 'category').map((l) => l.text)),
      ref: e.id,
      hasLocation: false,
    });
  }
  return docs;
}

/** Extra search terms of a building from its VERIFIED artwork subjects (exact labels, aliases, numbers). */
export interface ArtworkTerms {
  labels: string[];
  aliases: string[];
  codes: string[];
}

export function artworkTermsOf(
  links: readonly DirectoryArtworkLink[],
  numberOf: (subjectId: string) => string | null,
): ArtworkTerms | undefined {
  if (links.length === 0) return undefined;
  return {
    labels: uniq(links.flatMap((l) => l.labels.filter((x) => x.role !== 'category').map((x) => x.text))),
    aliases: uniq(links.flatMap((l) => l.aliases)),
    codes: uniq(links.flatMap((l) => artworkNumberCodes(numberOf(l.subjectId)))),
  };
}
