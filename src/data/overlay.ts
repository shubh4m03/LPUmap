/**
 * Shared vocabulary of the overlays the app merges onto the base dataset at run
 * time: the owner's publication (src/community, `mergePublication`) and the
 * published Building Studio records (src/building-studio, `mergeStudioBuildings`).
 * Kept here, below both, so neither merge imports the other.
 */
import type { SourceRecord } from './schema.ts';

/** An item an overlay could not apply as published, with the reason code and a readable message. */
export interface MergeIssue {
  id: string;
  reason: string;
  message: string;
}

/** Provenance of everything the site owner publishes over the base dataset. */
export const OWNER_SOURCE: SourceRecord = {
  id: 'owner',
  name: 'Campus Atlas owner edits',
  notes:
    'Locations and corrections published by the site owner. Overlaid on the base dataset; never written into it.',
};

/** Provenance of community suggestions, published only after the owner approved them. */
export const COMMUNITY_SOURCE: SourceRecord = {
  id: 'community',
  name: 'Community suggestions (owner-approved)',
  notes: 'Submitted by visitors and published only after the site owner reviewed and approved them.',
};
