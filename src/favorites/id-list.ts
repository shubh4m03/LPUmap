import { z } from 'zod';

/**
 * Lenient id-list schema: keeps non-empty string ids, drops anything else,
 * removes duplicates (first occurrence wins) and enforces a maximum length,
 * so one bad element does not throw away a user's whole list.
 */
export function idListSchema(max: number) {
  return z.array(z.unknown()).transform((items) => normalizeIds(items, max));
}

export function normalizeIds(items: readonly unknown[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Maps stored ids to current records, dropping ids that no longer exist in the
 * dataset (e.g. a place removed upstream). Order is preserved.
 */
export function resolveIds<T>(ids: readonly string[], getPlace: (id: string) => T | undefined | null): T[] {
  const out: T[] = [];
  for (const id of ids) {
    const place = getPlace(id);
    if (place !== undefined && place !== null) out.push(place);
  }
  return out;
}
