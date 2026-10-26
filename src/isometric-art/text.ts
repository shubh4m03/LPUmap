/**
 * User-facing wording of the campus illustration, in ONE place
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §3, §5). Zod-free on purpose: the
 * directory, search and place panels import it without pulling the schema
 * chunk into the first screen. src/isometric-art/schema.ts re-exports the
 * constants, so contract code keeps importing them from there.
 */

/** Shown wherever the illustrated overview is shown (and announced on entering it). */
export const ILLUSTRATION_DISCLAIMER =
  'Schematic illustration of the campus. It is not geographically exact: positions, sizes and distances are not to scale.';
/** Label of an approximate association (a candidate footprint): never "match", "location" or "verified". */
export const UNCONFIRMED_MATCH_LABEL = 'Unconfirmed match';
/** Shown next to every artwork number or "BLOCK-…" text taken from the artwork. */
export const ARTWORK_NUMBER_NOTE = 'Number as printed on the illustration; not an official LPU block number.';

export const ASSOCIATION_STATUSES = ['verified', 'approximate', 'unresolved'] as const;
export type AssociationStatusName = (typeof ASSOCIATION_STATUSES)[number];

export type StatusTone = 'success' | 'warning' | 'neutral';

export interface StatusText {
  label: string;
  tone: StatusTone;
  description: string;
}

/**
 * Status of an ILLUSTRATION ITEM's link to the map (detail card, directory
 * rows, search subtitles). Text is always shown; colour is never the only signal.
 */
export const ASSOCIATION_STATUS_TEXT: Readonly<Record<AssociationStatusName, StatusText>> = {
  verified: {
    label: 'Verified link to the map',
    tone: 'success',
    description: 'Linked to a map building with recorded owner or official evidence.',
  },
  approximate: {
    label: UNCONFIRMED_MATCH_LABEL,
    tone: 'warning',
    description:
      'A reviewed candidate map building, found by comparing shapes. It is not confirmed on site or by an official source, so it is never used for directions.',
  },
  unresolved: {
    label: 'Not linked to a map building',
    tone: 'neutral',
    description: 'Shown on the illustration only. It has no map position and cannot be routed to.',
  },
};

/** The same verified link seen from a map BUILDING (directory row, place details). */
export const BUILDING_VERIFIED_ARTWORK_TEXT: StatusText = {
  label: 'Verified link to the illustration',
  tone: 'success',
  description: 'This map building is linked to the illustration with recorded owner or official evidence.',
};
