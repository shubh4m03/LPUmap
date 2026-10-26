/**
 * Building directory contract (docs/ISOMETRIC_AND_3D_DESIGN.md §7, Decision
 * D5): the single list of campus buildings shared by Realistic 3D, the
 * isometric overview, Standard 2D and the accessible list.
 *
 * Eligibility: building features with `inCampusInventory === true`
 * (campusStatus 'inside' or 'crossing'). 'uncertain' footprints, detections
 * and context places are never directory entries.
 */
import type { ArtworkDirectory, ArtworkOnlyEntry } from '../isometric-art/directory.ts';
import type { ArtSubject, ManifestAsset } from '../isometric-art/schema.ts';
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
  /**
   * VERIFIED artwork subjects that depict this building (owner/official
   * evidence recorded). Their exact printed labels are extra search text of
   * this one entry: one building, one entry, one id in every view.
   */
  artwork: DirectoryArtworkLink[];
  /**
   * APPROXIMATE artwork subjects whose reviewed candidate footprint is this
   * building. A pointer only ("Unconfirmed match"): never an identity, never
   * search text of this entry, never a reason to route.
   */
  unconfirmedArtwork: DirectoryArtworkPointer[];
}

/** A verified artwork subject joined to a directory building. */
export interface DirectoryArtworkLink {
  subjectId: string;
  /** Exact printed labels (display, block heading, index rows, index section), in that order. */
  labels: { role: 'display' | 'visible-block' | 'other' | 'category'; text: string; ref: string }[];
  aliases: string[];
  hotspotIds: string[];
}

/** An approximate artwork subject pointing at this building as its unconfirmed candidate. */
export interface DirectoryArtworkPointer {
  subjectId: string;
  /** Title of the artwork entry (exact label, or a neutral description). */
  title: string;
}

/** Artwork inputs of the directory: built by the app from the manifest + publication. */
export interface DirectoryArtworkInput {
  /** createArtworkDirectory(manifest.subjects, merged associations). */
  directory: ArtworkDirectory;
  subjects: readonly ArtSubject[];
  /** Manifest assets (labels for caption order, vignette originals for thumbnails). */
  assets: readonly ManifestAsset[];
  /** Manifest-relative file → app URL (artworkUrl); identity when absent. */
  resolveUrl?: (relative: string) => string;
}

/** One row of the combined directory: a map building, or an artwork-only item. */
export type DirectoryItem =
  | { kind: 'building'; id: string; entry: DirectoryEntry }
  | { kind: 'artwork'; id: string; entry: ArtworkOnlyEntry };

export type ArtworkGroupKind = 'block-caption' | 'numbered-uncaptioned' | 'scenes' | 'areas';

/** A vignette shown as a group thumbnail (the unchanged original, scaled to fit, never cropped). */
export interface ArtworkThumbnail {
  assetId: string;
  /** Manifest-relative URL ('original/<file>'). */
  url: string;
  /** App URL of the unchanged original (DirectoryArtworkInput.resolveUrl applied). */
  src: string;
  width: number;
  height: number;
}

/**
 * A group of the illustration's own organisation: one per printed block
 * caption heading (e.g. "BLOCK- 48, 49", exactly as printed), then numbered
 * items without a caption heading, scenes, and unlabelled areas.
 */
export interface ArtworkGroup {
  id: string;
  kind: ArtworkGroupKind;
  /** The exact printed heading ('block-caption' only), else null. */
  heading: string | null;
  /** Inventory label the heading comes from ('block-caption' only). */
  headingRef: string | null;
  /** Visible group label: the exact heading, or a neutral description. */
  label: string;
  thumbnail: ArtworkThumbnail | null;
  /** Rows in the artwork's order; a verified subject is its building's directory entry. */
  items: DirectoryItem[];
}

/** An index section heading printed on the overview (e.g. "EDUCATION"), exact. */
export interface ArtworkSection {
  text: string;
  ref: string;
  count: number;
}

export interface CampusArtworkDirectory {
  /** Artwork-only entries (approximate and unresolved subjects), in subject id order. */
  readonly entries: readonly ArtworkOnlyEntry[];
  readonly byId: ReadonlyMap<string, ArtworkOnlyEntry>;
  /** Every subject, by id: an artwork-only entry, or the building id of its verified join. */
  readonly subjectTarget: ReadonlyMap<string, DirectoryItem>;
  readonly subjects: ReadonlyMap<string, ArtSubject>;
  readonly groups: readonly ArtworkGroup[];
  readonly sections: readonly ArtworkSection[];
  /** Index section text (exact) of each subject; null when it has none or its label is held. */
  readonly sectionOf: ReadonlyMap<string, string | null>;
  /** Number of subjects per association status (after the merge). */
  readonly statusCounts: Readonly<Record<'verified' | 'approximate' | 'unresolved', number>>;
  /** Vignette thumbnail of a subject (null for a held label or no vignette). */
  thumbnailOf(subjectId: string): ArtworkThumbnail | null;
  /** Every vignette that depicts the subject (canonical originals, file order; none for a held label). */
  thumbnailsOf(subjectId: string): ArtworkThumbnail[];
}

export interface DirectoryInput {
  buildings: BuildingsFile;
  /** Campus places (places.json); context places are never passed here. */
  places: readonly Place[];
  relations: readonly Relation[];
  /**
   * Ids left out of the directory although drawn on the map: published studio
   * buildings with directoryVisible false (docs/BUILDING_STUDIO_DESIGN.md change C2).
   */
  exclude?: ReadonlySet<string>;
  /** The owner's campus illustration (absent: artwork not loaded; buildings only). */
  artwork?: DirectoryArtworkInput | null;
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
  /** The illustration layer, or null when the artwork is not loaded. */
  readonly artwork: CampusArtworkDirectory | null;
  /**
   * Buildings AND artwork-only items for a query: map keys, names, exact
   * artwork labels, artwork numbers ("25", "Block 25", "BLOCK-25") and search
   * aliases. Best first; at equal rank a map building comes first.
   */
  find(query: string): DirectoryItem[];
  /** A row by id: a building id or an `art:` id (a verified subject id resolves to its building). */
  item(id: string): DirectoryItem | undefined;
}

export const ROUTABILITY_NOTES: Record<RoutabilityReason, string> = {
  routable: 'Directions available.',
  'no-place-record': 'Not routable: this building has no place record.',
  'no-location': 'Not routable: no dependable map position.',
  'not-connected': 'Not routable yet: no mapped path reaches this building. Use "Show on map".',
};
