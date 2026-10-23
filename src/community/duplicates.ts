/**
 * Possible-duplicate detection for suggestions and published locations. Pure
 * and deterministic; shared by server (submission, moderation, quality view)
 * and tests.
 *
 * Name similarity: names are normalised with the search module's `normalize`
 * (lower-case, diacritics stripped, '&' → 'and', punctuation → space), spaces
 * removed, then compared with the Sørensen–Dice coefficient over character
 * bigrams (2·|A∩B| / (|A|+|B|), multiset intersection). Identical normalised
 * names score 1; single-character names score 1 only when equal.
 *
 * A candidate is reported when ANY rule holds:
 *  1. within `radiusM` and name similarity ≥ `threshold`;
 *  2. same category within `sameCategoryRadiusM` (15 m), regardless of name;
 *  3. identical normalised name anywhere inside APP_CONFIG.map.maxBounds.
 */
import { APP_CONFIG } from '../config/index.ts';
import type { LngLat } from '../data/schema.ts';
import { haversineM } from '../distance/geodesic.ts';
import { normalize } from '../search/normalize.ts';
import type { DuplicateCandidate } from './schema.ts';
import { insideContributionArea } from './geo.ts';

export const SAME_CATEGORY_RADIUS_M = 15;
export const MAX_DUPLICATES = 10;

export interface DuplicateSubject {
  name: string;
  categoryId: string;
  location: LngLat;
}

export interface DuplicateSource {
  id: string;
  kind: DuplicateCandidate['kind'];
  name: string | null;
  categoryId: string;
  location: LngLat | null;
}

export interface DuplicateOptions {
  radiusM?: number;
  threshold?: number;
  sameCategoryRadiusM?: number;
  /** Ids never reported (e.g. the subject itself). */
  excludeIds?: ReadonlySet<string>;
  limit?: number;
}

export const nameKey = (name: string): string => normalize(name).replace(/ /g, '');

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of two already-normalised keys, 0..1. */
export function keySimilarity(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let shared = 0;
  for (const [g, n] of ba) shared += Math.min(n, bb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

export function nameSimilarity(a: string, b: string): number {
  return keySimilarity(nameKey(a), nameKey(b));
}

export function findPossibleDuplicates(
  subject: DuplicateSubject,
  sources: Iterable<DuplicateSource>,
  opts: DuplicateOptions = {},
): DuplicateCandidate[] {
  const radiusM = opts.radiusM ?? APP_CONFIG.contributions.duplicateRadiusM;
  const threshold = opts.threshold ?? APP_CONFIG.contributions.nameSimilarityThreshold;
  const sameCatM = opts.sameCategoryRadiusM ?? SAME_CATEGORY_RADIUS_M;
  const key = nameKey(subject.name);
  const found: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    if (!src.location || seen.has(src.id) || opts.excludeIds?.has(src.id)) continue;
    const distanceM = haversineM(subject.location, src.location);
    const srcKey = src.name ? nameKey(src.name) : '';
    let reason: string | null = null;
    if (srcKey && distanceM <= radiusM) {
      const sim = keySimilarity(key, srcKey);
      if (sim >= threshold)
        reason = `Similar name (${Math.round(sim * 100)}% match) ${Math.round(distanceM)} m away`;
    }
    if (!reason && src.categoryId === subject.categoryId && distanceM <= sameCatM) {
      reason = `Same category ${Math.round(distanceM)} m away`;
    }
    if (!reason && srcKey && srcKey === key && insideContributionArea(src.location)) {
      reason = `Same name ${Math.round(distanceM)} m away`;
    }
    if (!reason) continue;
    seen.add(src.id);
    found.push({
      id: src.id,
      kind: src.kind,
      name: src.name ?? src.id,
      distanceM: Math.round(distanceM * 10) / 10,
      reason,
    });
  }
  found.sort((a, b) => a.distanceM - b.distanceM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return found.slice(0, opts.limit ?? MAX_DUPLICATES);
}
