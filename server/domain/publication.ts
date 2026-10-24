/**
 * The public publication layer (GET /api/locations): ACTIVE owner/community
 * locations and all overrides, in deterministic id order, with no private data
 * (no notes, actors, suggestion links or statuses). `generatedAt` is the time
 * of the last public change (not the request time), so identical
 * publicationVersions always produce identical bodies.
 *
 * v2 (Building Studio): `buildings` = the latest published version of every
 * PUBLISHED (non-archived) studio building, in id order — never drafts,
 * archived records, private notes, actors, acknowledgements, validation or
 * change summaries. Every studio change that alters this list bumps
 * publication_version in the same batch, so the ETag stays exact. The list
 * does not depend on the base dataset (a record whose base target vanished is
 * reported as an orphan by the client merge and the admin quality view).
 *
 * All four reads run in ONE db.batch (a D1 transaction), so the body is a
 * consistent snapshot: its rows always belong to its publicationVersion and
 * a write landing mid-read can never pair new rows with an old version (or
 * the reverse), which would make the ETag lie.
 */
import {
  PUBLICATION_SCHEMA_VERSION,
  publishedLocationSchema,
  publishedOverrideSchema,
  type Publication,
} from '../../src/community/schema.ts';
import { activeLocationsStmt } from '../db/locations.ts';
import { getPublicationState, publicationStateStmt, toPublicationState } from '../db/meta.ts';
import { listOverridesStmt } from '../db/overrides.ts';
import { rowToLocation, rowToOverride, toPublishedLocation, toPublishedOverride } from '../db/records.ts';
import { publishedStudioVersionsStmt, rowToPublishedStudioVersion } from '../db/studio-buildings.ts';
import type { SqlDatabase } from '../db/types.ts';
import { toPublishedStudioBuilding } from './studio/records.ts';

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The current publication version alone (one indexed read): lets
 * GET /api/locations answer If-None-Match with 304 before building the body.
 */
export async function getPublicationVersion(db: SqlDatabase): Promise<number> {
  return (await getPublicationState(db)).version;
}

export async function getPublication(db: SqlDatabase): Promise<Publication> {
  const [stateRes, locationRes, overrideRes, studioRes] = await db.batch([
    publicationStateStmt(db),
    activeLocationsStmt(db),
    listOverridesStmt(db),
    publishedStudioVersionsStmt(db),
  ]);
  const state = toPublicationState(stateRes?.results ?? []);
  const locations = (locationRes?.results ?? []).map(rowToLocation);
  const overrides = (overrideRes?.results ?? []).map(rowToOverride);
  const studio = (studioRes?.results ?? []).map(rowToPublishedStudioVersion);
  // Every record is re-checked against the public schema; a row that would not validate is never published.
  const pubLocations = locations
    .map(toPublishedLocation)
    .filter((l) => publishedLocationSchema.safeParse(l).success)
    .sort((a, b) => byString(a.id, b.id));
  const pubOverrides = overrides
    .map(toPublishedOverride)
    .filter((o) => publishedOverrideSchema.safeParse(o).success)
    .sort((a, b) => byString(a.targetId, b.targetId));
  // toPublishedStudioBuilding re-checks each record against publishedStudioBuildingSchema (null = not published).
  const buildings = studio
    .map((s) => toPublishedStudioBuilding(s.version, s.targetId))
    .filter((b) => b !== null)
    .sort((a, b) => byString(a.id, b.id));
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    publicationVersion: state.version,
    generatedAt: state.updatedAt,
    locations: pubLocations,
    overrides: pubOverrides,
    buildings,
  };
}
