/**
 * The current campus building set an artwork subject may be linked to
 * (ArtworkDomainContext.buildingExists): every base footprint in the campus
 * inventory (public/data/buildings.geojson, `inCampusInventory`) plus every
 * PUBLISHED studio building (D1 `studio_buildings`, status 'published').
 * Drafts and archived studio records are not campus buildings for this
 * purpose, and nothing is ever guessed: an id outside this set is refused.
 */
import { isArtworkBuildingId } from '../../../src/isometric-art/index.ts';
import type { StudioBaseData } from '../../base-data.ts';
import { stmt } from '../../db/sql.ts';
import type { SqlDatabase } from '../../db/types.ts';

/** Ids of published (non-archived) studio buildings, bounded like the publication query. */
export async function publishedStudioBuildingIds(db: SqlDatabase): Promise<string[]> {
  const { results } = await stmt(
    db,
    "SELECT id FROM studio_buildings WHERE status = 'published' ORDER BY id LIMIT 5000",
  ).all();
  return results.map((r) => String(r.id));
}

export function campusBuildingIdSet(
  base: Pick<StudioBaseData, 'buildingsById'>,
  publishedStudioIds: readonly string[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [id, f] of base.buildingsById) if (f.properties.inCampusInventory) ids.add(id);
  for (const id of publishedStudioIds) ids.add(id);
  return ids;
}

/** buildingExists for ArtworkDomainContext: a well-formed id in the current campus building set. */
export const buildingExistsIn =
  (ids: ReadonlySet<string>) =>
  (buildingId: string): boolean =>
    isArtworkBuildingId(buildingId) && ids.has(buildingId);
