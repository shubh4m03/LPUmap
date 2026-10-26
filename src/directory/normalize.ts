/** Directory text matching (shared by the building directory and its illustration layer). */

/** Lower-case, strip diacritics, collapse everything but letters/digits to single spaces. */
export function normalizeDirectoryText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
