/**
 * The public publication layer (GET /api/locations): ACTIVE owner/community
 * locations and all overrides, in deterministic id order, with no private data
 * (no notes, actors, suggestion links or statuses). `generatedAt` is the time
 * of the last public change (not the request time), so identical
 * publicationVersions always produce identical bodies.
 */
import {
  PUBLICATION_SCHEMA_VERSION,
  publishedLocationSchema,
  publishedOverrideSchema,
  type Publication,
} from '../../src/community/schema.ts';
import { listLocationRows } from '../db/locations.ts';
import { getPublicationState } from '../db/meta.ts';
import { listOverrideRows } from '../db/overrides.ts';
import { toPublishedLocation, toPublishedOverride } from '../db/records.ts';
import type { SqlDatabase } from '../db/types.ts';

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export async function getPublication(db: SqlDatabase): Promise<Publication> {
  const [state, locations, overrides] = await Promise.all([
    getPublicationState(db),
    listLocationRows(db, { status: 'active' }),
    listOverrideRows(db),
  ]);
  // Every record is re-checked against the public schema; a row that would not validate is never published.
  const pubLocations = locations
    .map(toPublishedLocation)
    .filter((l) => publishedLocationSchema.safeParse(l).success)
    .sort((a, b) => byString(a.id, b.id));
  const pubOverrides = overrides
    .map(toPublishedOverride)
    .filter((o) => publishedOverrideSchema.safeParse(o).success)
    .sort((a, b) => byString(a.targetId, b.targetId));
  return {
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    publicationVersion: state.version,
    generatedAt: state.updatedAt,
    locations: pubLocations,
    overrides: pubOverrides,
  };
}
