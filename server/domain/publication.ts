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
 * v3 (artwork verification, docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §4.3):
 * `artworkAssociations` = every owner decision (artwork_associations) in
 * subject order, public columns only (the note and actors are never selected), each
 * re-checked against publishedArtworkAssociationSchema. Every decision change
 * bumps publication_version in the same batch.
 *
 * All five reads run in ONE db.batch (a D1 transaction), so the body is a
 * consistent snapshot: its rows always belong to its publicationVersion and
 * a write landing mid-read can never pair new rows with an old version (or
 * the reverse), which would make the ETag lie.
 */
import {
  PUBLICATION_SCHEMA_VERSION,
  publishedLocationSchema,
  publishedOverrideSchema,
  type Publication,
} from '../../src/community/index.ts';
import { publishedArtworkAssociationSchema } from '../../src/isometric-art/index.ts';
import {
  publishedArtworkAssociationsStmt,
  rowToPublishedArtworkAssociation,
} from '../db/artwork-associations.ts';
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
  const [stateRes, locationRes, overrideRes, studioRes, artworkRes] = await db.batch([
    publicationStateStmt(db),
    activeLocationsStmt(db),
    listOverridesStmt(db),
    publishedStudioVersionsStmt(db),
    publishedArtworkAssociationsStmt(db),
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
  const artworkAssociations = (artworkRes?.results ?? [])
    .map(rowToPublishedArtworkAssociation)
    .filter((a) => publishedArtworkAssociationSchema.safeParse(a).success)
    .sort((a, b) => byString(a.subjectId, b.subjectId));
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    publicationVersion: state.version,
    generatedAt: state.updatedAt,
    locations: pubLocations,
    overrides: pubOverrides,
    buildings,
    artworkAssociations,
  };
}
