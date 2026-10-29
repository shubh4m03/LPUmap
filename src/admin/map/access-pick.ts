/**
 * Choosing an access point by clicking on the map (pure). A click never
 * chooses: it LISTS the already-validated candidates (walkable path nodes
 * within the server's distance limit) that lie near the click, and the owner
 * picks one of them explicitly. Nodes that are not candidates are never
 * offered, however close to the click they are.
 */
import type { LngLat } from '../../data/index.ts';
import { haversineM } from '../../distance/index.ts';

/** How far from the click a candidate may be to be listed, metres. */
export const ACCESS_PICK_RADIUS_M = 25;
/** At most this many candidates are listed for one click. */
export const ACCESS_PICK_LIMIT = 4;

export type NearClick<T> = T & { fromClickM: number };

/** The candidates within `radiusM` of the click, nearest to the click first (ties by node id). */
export function candidatesNearClick<T extends { nodeId: number; position: LngLat }>(
  candidates: readonly T[],
  click: LngLat,
  radiusM = ACCESS_PICK_RADIUS_M,
  limit = ACCESS_PICK_LIMIT,
): NearClick<T>[] {
  const out: NearClick<T>[] = [];
  for (const c of candidates) {
    const d = haversineM(click, c.position);
    if (d <= radiusM) out.push({ ...c, fromClickM: Math.round(d * 10) / 10 });
  }
  out.sort((a, b) => a.fromClickM - b.fromClickM || a.nodeId - b.nodeId);
  return out.slice(0, limit);
}

/** What a click found, as one sentence (for the picker's live status). */
export function nearClickSummary(count: number, radiusM = ACCESS_PICK_RADIUS_M): string {
  if (count === 0)
    return `No valid path node within ${radiusM} m of that spot. Only the highlighted nodes can be chosen; click closer to one.`;
  return count === 1
    ? `1 valid path node near that spot. Choose it to use it as the access point.`
    : `${count} valid path nodes near that spot. Choose one to use it as the access point.`;
}
