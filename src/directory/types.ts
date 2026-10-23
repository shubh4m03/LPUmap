/**
 * Building directory contract (docs/ISOMETRIC_AND_3D_DESIGN.md §7, Decision
 * D5): the single list of campus buildings shared by Realistic 3D, the
 * isometric overview, Standard 2D and the accessible list.
 *
 * Eligibility: building features with `inCampusInventory === true`
 * (campusStatus 'inside' or 'crossing'). 'uncertain' footprints, detections
 * and context places are never directory entries.
 */
import type {
  BuildingsFile,
  CampusStatus,
  DirectoryKeysLock,
  HeightSource,
  LngLat,
  Place,
  Provenance,
  Relation,
} from '../data/schema.ts';

export type { DirectoryKeysLock };

/** A map key such as `C4-07` (validated by DIRECTORY_KEY_RE in src/data/schema.ts). */
export type DirectoryKey = string;

/** An official block label — only from a curated alias citing a source for this exact footprint. */
export interface OfficialBlockLabel {
  label: string;
  sourceId: string;
}

export type RoutabilityReason = 'routable' | 'no-place-record' | 'no-location' | 'not-connected';

export interface DirectoryEntry {
  /** Stable id (`osm:way/…`, `cur:…`): URL, favourites, relations. */
  id: string;
  /** Map key, or null (small structure, or not yet keyed). */
  key: DirectoryKey | null;
  /** Grid cell of the key, e.g. 'C4'. */
  cell: string | null;
  /** Honest title: name ?? `Building <key>` ?? displayName. Never an invented name. */
  title: string;
  /** Honest secondary line (the pipeline label for unnamed buildings, or the key wording). */
  subtitle: string;
  name: string | null;
  displayName: string;
  officialBlock: OfficialBlockLabel | null;
  categoryId: string;
  campusStatus: Extract<CampusStatus, 'inside' | 'crossing'>;
  insideFraction: number | null;
  /** Point-on-surface anchor from the building feature. */
  location: LngLat;
  /** Footprint by reference; the geometry stays in buildings.geojson. */
  footprint: { file: 'buildings.geojson'; featureId: string };
  areaM2: number | null;
  levels: number | null;
  /** Render-only height and how it was chosen (shown with legend wording, never as a measurement unless 'osm-height'). */
  renderHeightM: number;
  renderHeightSource: HeightSource;
  /** Places with a located_in / part_of relation to this building (non-organizations). */
  facilityIds: string[];
  /** Organizations with a located_in / part_of relation to this building. */
  organizationIds: string[];
  routable: boolean;
  routableReason: RoutabilityReason;
  /** User-facing explanation of `routableReason`. */
  routableNote: string;
  provenance: Provenance;
}

export interface DirectoryInput {
  buildings: BuildingsFile;
  /** Campus places (places.json); context places are never passed here. */
  places: readonly Place[];
  relations: readonly Relation[];
}

export interface CampusDirectory {
  /** Keyed entries by key order, then unkeyed entries by title, then id. */
  readonly entries: readonly DirectoryEntry[];
  readonly byKey: ReadonlyMap<DirectoryKey, DirectoryEntry>;
  readonly byId: ReadonlyMap<string, DirectoryEntry>;
  /** Case/diacritic-insensitive. An exact key match ranks first, then title prefix, then other matches. */
  search(query: string): DirectoryEntry[];
  /** Entries in any of the given categories (empty list → all entries). */
  filter(categoryIds: readonly string[]): DirectoryEntry[];
}

export const ROUTABILITY_NOTES: Record<RoutabilityReason, string> = {
  routable: 'Directions available.',
  'no-place-record': 'Not routable: this building has no place record.',
  'no-location': 'Not routable: no dependable map position.',
  'not-connected': 'Not routable yet: no mapped path reaches this building. Use "Show on map".',
};
