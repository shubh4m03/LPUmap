/**
 * View model of the illustrated overview: hotspots with their subject, exact
 * title, accessible name, keyboard order and effective association. Pure.
 *
 * Titles come from the directory contract (createArtworkDirectory), so the
 * illustration, the directory and search show the SAME exact label for a
 * subject. Nothing here names anything from position or appearance: an
 * outline with no printed label is called an unlabelled area/building, with a
 * running number only to tell them apart.
 */
import type { EffectiveArtworkAssociation } from './associations.ts';
import { createArtworkDirectory } from './directory.ts';
import { prepareHotspot, unionBBox, type PreparedHotspot } from './hotspot-geometry.ts';
import type { ArtSubject, IsometricArtManifest, ManifestAsset, ManifestHotspot } from './schema.ts';
import type { ArtRect, ArtSourceSpace } from './viewport.ts';

export interface ArtSubjectView {
  subject: ArtSubject;
  /** Exact printed label, or a neutral non-name (directory rule). */
  title: string;
  /** True when `title` is printed text from the artwork (not a neutral placeholder). */
  titleIsPrinted: boolean;
  association: EffectiveArtworkAssociation;
  hotspotIds: readonly string[];
}

export interface HotspotView {
  hotspot: ManifestHotspot;
  geometry: PreparedHotspot;
  subjectId: string;
  /** Accessible name: contains the subject's exact printed label when it has one. */
  name: string;
  /** Position in keyboard (Tab) order, 0-based. */
  order: number;
  needsReview: boolean;
}

export interface ArtModel {
  space: ArtSourceSpace;
  master: ManifestAsset;
  /** In keyboard order. */
  hotspots: readonly HotspotView[];
  byHotspot: ReadonlyMap<string, HotspotView>;
  bySubject: ReadonlyMap<string, ArtSubjectView>;
  /** Verified joins only: building id → subject ids depicting it. */
  subjectsByBuilding: ReadonlyMap<string, readonly string[]>;
  /** Union of all outlines (source px): the traced campus area the overview opens on. */
  focusRect: ArtRect;
  assets: ReadonlyMap<string, ManifestAsset>;
}

const UNRESOLVED_FOR_TITLES = (subjectId: string): EffectiveArtworkAssociation => ({
  subjectId,
  status: 'unresolved',
  buildingId: null,
  unconfirmedMatchId: null,
  evidence: [],
  candidateFootprints: [],
  reason: null,
  source: 'default',
  revision: null,
  updatedAt: null,
});

/**
 * The directory's title of every subject (exact label, else the exact block
 * heading, else a neutral "Illustration pin N" / "Unlabelled area…", or the
 * withheld-label text). Computed with every subject unlinked so verified ones
 * get a title too; titles never depend on the association.
 */
export function subjectTitles(subjects: readonly ArtSubject[]): Map<string, string> {
  const unlinked = new Map(subjects.map((s) => [s.subjectId, UNRESOLVED_FOR_TITLES(s.subjectId)]));
  const dir = createArtworkDirectory(subjects, unlinked);
  return new Map(dir.entries.map((e) => [e.id, e.title]));
}

/** '21A' → [21, 'A'] for numeric ordering of artwork numbers. */
function numberKey(n: string | null): [number, string] {
  if (n === null) return [Number.POSITIVE_INFINITY, ''];
  const m = /^(\d+)([A-Z]?)$/.exec(n);
  return m ? [Number(m[1]), m[2] ?? ''] : [Number.POSITIVE_INFINITY, n];
}

const KIND_RANK: Record<ManifestHotspot['kind'], number> = {
  'pin-structure': 0,
  'unassigned-structure': 1,
  'unpinned-structure': 2,
  'printed-text': 3,
  scene: 4,
};

/**
 * Keyboard order: numbered pins by their printed number (1, 2, … 58, as in the
 * artwork's own index), then the other outlines by kind, each top-to-bottom,
 * left-to-right by their label anchor.
 */
export function compareHotspots(
  a: { hotspot: ManifestHotspot; geometry: PreparedHotspot },
  b: { hotspot: ManifestHotspot; geometry: PreparedHotspot },
): number {
  const ka = KIND_RANK[a.hotspot.kind];
  const kb = KIND_RANK[b.hotspot.kind];
  if (ka !== kb) return ka - kb;
  if (a.hotspot.kind === 'pin-structure') {
    const [na, sa] = numberKey(a.hotspot.printedLabel);
    const [nb, sb] = numberKey(b.hotspot.printedLabel);
    if (na !== nb) return na - nb;
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  const dy = a.geometry.anchor.y - b.geometry.anchor.y;
  if (Math.abs(dy) > 1e-9) return dy;
  const dx = a.geometry.anchor.x - b.geometry.anchor.x;
  if (Math.abs(dx) > 1e-9) return dx;
  return a.hotspot.hotspotId < b.hotspot.hotspotId ? -1 : 1;
}

function candidateNumbers(subject: ArtSubject, subjects: ReadonlyMap<string, ArtSubject>): string[] {
  return subject.relations
    .filter((r) => r.relation === 'candidate-part-of')
    .map((r) => subjects.get(r.subjectId)?.artworkNumber ?? null)
    .filter((n): n is string => n !== null)
    .sort((x, y) => {
      const [a, sa] = numberKey(x);
      const [b, sb] = numberKey(y);
      return a - b || (sa < sb ? -1 : sa > sb ? 1 : 0);
    });
}

const list = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;

/**
 * Accessible name of an outline. A printed label is quoted exactly; numbers
 * are said to be the illustration's own pins.
 */
export function hotspotAccessibleName(
  hotspot: ManifestHotspot,
  subject: ArtSubject,
  title: string,
  titleIsPrinted: boolean,
  subjects: ReadonlyMap<string, ArtSubject>,
  ordinal: number,
): string {
  switch (hotspot.kind) {
    case 'pin-structure': {
      const pin = hotspot.printedLabel ?? subject.artworkNumber;
      if (!titleIsPrinted) return title;
      return pin ? `${title}, pin ${pin}` : title;
    }
    case 'unassigned-structure': {
      const nums = candidateNumbers(subject, subjects);
      return nums.length > 0
        ? `Unlabelled part of the building group with pins ${list(nums)}`
        : `Unlabelled building part ${ordinal} on the illustration`;
    }
    case 'unpinned-structure':
      return `Unlabelled building ${ordinal} on the illustration (no pin printed)`;
    case 'printed-text':
      return titleIsPrinted ? `${title} (letters printed on the illustration)` : title;
    case 'scene':
      return titleIsPrinted ? title : `Unlabelled area ${ordinal} on the illustration`;
  }
}

/** Neutral titles of the directory contract (anything else is printed text). */
function isPrintedTitle(subject: ArtSubject): boolean {
  if (subject.displayHold) return false;
  return subject.displayLabel !== null || subject.visibleBlockLabel !== null;
}

/**
 * `associations` is the EFFECTIVE association per subject (the app merges the
 * curated baseline with the owner's decisions once: src/app/data/artwork.ts,
 * mergeArtworkAssociations). A subject missing from it counts as unresolved.
 */
export function buildArtModel(
  manifest: IsometricArtManifest,
  associations: ReadonlyMap<string, EffectiveArtworkAssociation>,
): ArtModel {
  const space: ArtSourceSpace = {
    width: manifest.coordinateSpace.width,
    height: manifest.coordinateSpace.height,
  };
  const assets = new Map(manifest.assets.map((a) => [a.assetId, a]));
  const master = assets.get(manifest.coordinateSpace.assetId);
  if (!master) throw new Error(`Manifest has no asset ${manifest.coordinateSpace.assetId}`);
  const subjects = new Map(manifest.subjects.map((s) => [s.subjectId, s]));
  const titles = subjectTitles(manifest.subjects);

  const subjectViews = new Map<string, ArtSubjectView>();
  const subjectsByBuilding = new Map<string, string[]>();
  for (const s of manifest.subjects) {
    const association = associations.get(s.subjectId) ?? UNRESOLVED_FOR_TITLES(s.subjectId);
    subjectViews.set(s.subjectId, {
      subject: s,
      title: titles.get(s.subjectId) ?? 'Unlabelled area on the illustration',
      titleIsPrinted: isPrintedTitle(s),
      association,
      hotspotIds: [...s.hotspotIds],
    });
    if (association.status === 'verified' && association.buildingId !== null)
      subjectsByBuilding.set(association.buildingId, [
        ...(subjectsByBuilding.get(association.buildingId) ?? []),
        s.subjectId,
      ]);
  }

  const prepared = manifest.hotspots
    .filter((h) => subjectViews.has(h.subjectId))
    .map((h) => ({ hotspot: h, geometry: prepareHotspot(h, space) }))
    .sort(compareHotspots);
  const ordinals = new Map<ManifestHotspot['kind'], number>();
  const hotspots: HotspotView[] = prepared.map((p, order) => {
    const n = (ordinals.get(p.hotspot.kind) ?? 0) + 1;
    ordinals.set(p.hotspot.kind, n);
    const sv = subjectViews.get(p.hotspot.subjectId)!;
    return {
      hotspot: p.hotspot,
      geometry: p.geometry,
      subjectId: p.hotspot.subjectId,
      name: hotspotAccessibleName(p.hotspot, sv.subject, sv.title, sv.titleIsPrinted, subjects, n),
      order,
      needsReview: p.hotspot.reviewStatus === 'needs-manual-verification',
    };
  });
  const focusRect = unionBBox(hotspots.map((h) => h.geometry)) ?? {
    x: 0,
    y: 0,
    width: space.width,
    height: space.height,
  };
  return {
    space,
    master,
    hotspots,
    byHotspot: new Map(hotspots.map((h) => [h.hotspot.hotspotId, h])),
    bySubject: subjectViews,
    subjectsByBuilding,
    focusRect,
    assets,
  };
}

/** Hotspot views of a subject, in keyboard order. */
export function hotspotsOfSubject(model: ArtModel, subjectId: string): HotspotView[] {
  const ids = new Set(model.bySubject.get(subjectId)?.hotspotIds ?? []);
  return model.hotspots.filter((h) => ids.has(h.hotspot.hotspotId));
}

/**
 * The subjects an app selection refers to: an `art:` subject id itself, or
 * the subjects VERIFIED to depict a selected building (approximate links never
 * join identities).
 */
export function subjectsForSelection(model: ArtModel, selectedId: string | null): string[] {
  if (selectedId === null) return [];
  if (model.bySubject.has(selectedId)) return [selectedId];
  return [...(model.subjectsByBuilding.get(selectedId) ?? [])];
}

/** Legend labels of the master, exact as printed (from the inventory via the manifest). */
export function legendLabels(master: ManifestAsset): string[] {
  return master.labels.filter((l) => l.kind === 'legend').map((l) => l.text);
}
