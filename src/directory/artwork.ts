/**
 * The illustration layer of the building directory
 * (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5, docs/ISOMETRIC_AND_3D_DESIGN.md §7).
 * Pure, derived only from the manifest subjects and the merged associations
 * the app passes in (createArtworkDirectory output):
 *
 *  - a VERIFIED subject is no separate row: it joins the directory entry with
 *    the same stable building id (labels become extra search text there);
 *  - every other subject is an artwork-only row with its `art:` id, never
 *    routable and never located; an approximate one points at its candidate
 *    building as "Unconfirmed match" (never an identity);
 *  - groups follow the artwork's own organisation: one group per printed block
 *    caption heading (exact text, e.g. "BLOCK- 48, 49"), in file and caption
 *    order, then numbered items without a heading, scenes and unlabelled areas;
 *  - a label under `displayHold` is never shown or searchable, and neither is
 *    the vignette that prints it.
 *
 * Artwork numbers are the illustration's own numbering, never official LPU
 * block numbers (ARTWORK_NUMBER_NOTE is shown beside them by the UI).
 */
import {
  artworkNumberQuery,
  compareArtworkNumbers,
  type ArtworkJoin,
  type ArtworkOnlyEntry,
} from '../isometric-art/directory.ts';
import type { ArtSubject, ManifestAsset } from '../isometric-art/schema.ts';
import { normalizeDirectoryText } from './normalize.ts';
import type {
  ArtworkGroup,
  ArtworkSection,
  ArtworkThumbnail,
  CampusArtworkDirectory,
  DirectoryArtworkInput,
  DirectoryArtworkLink,
  DirectoryArtworkPointer,
  DirectoryEntry,
  DirectoryItem,
} from './types.ts';

export const NUMBERED_UNCAPTIONED_GROUP_LABEL = 'Numbered on the illustration, without a caption heading';
export const SCENES_GROUP_LABEL = 'Scenes of the illustration';
export const AREAS_GROUP_LABEL = 'Unlabelled areas of the illustration';

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareNumbers = compareArtworkNumbers;

/** 'iso-art-087/L12' → ['iso-art-087', 12]. */
function refParts(ref: string): [string, number] {
  const m = /^(iso-art-\d{3})\/L(\d+)$/.exec(ref);
  return m ? [m[1]!, Number(m[2])] : [ref, 0];
}

/** The contract's number parser (one implementation, src/isometric-art/directory.ts). */
export { artworkNumberQuery };

interface Built {
  artwork: CampusArtworkDirectory;
  links: ReadonlyMap<string, DirectoryArtworkLink[]>;
  pointers: ReadonlyMap<string, DirectoryArtworkPointer[]>;
  /** Search over artwork-only entries: rank 0 exact/number, 1 prefix, 2 contained. */
  searchArtwork(query: string): { entry: ArtworkOnlyEntry; rank: 0 | 1 | 2 }[];
  /** Normalized artwork search text of joined buildings (exact labels + aliases). */
  joinedText: ReadonlyMap<string, string[]>;
  /** Building ids whose verified join names this artwork number. */
  buildingsByNumber: ReadonlyMap<string, string[]>;
}

function linkOf(join: ArtworkJoin): DirectoryArtworkLink {
  return {
    subjectId: join.subjectId,
    labels: join.labels.map((l) => ({ ...l })),
    aliases: [...join.aliases],
    hotspotIds: [...join.hotspotIds],
  };
}

/**
 * Builds the illustration layer. `entryOf` resolves a building id to its
 * directory entry (verified joins and candidates outside the directory are
 * reported by mergeArtworkAssociations as building-missing before this runs).
 */
export function buildArtworkLayer(
  input: DirectoryArtworkInput,
  entryOf: (id: string) => DirectoryEntry | undefined,
): Built {
  const { directory: art, subjects } = input;
  const subjectsById = new Map(subjects.map((s) => [s.subjectId, s]));
  const assets = new Map(input.assets.map((a) => [a.assetId, a]));
  const resolveUrl = input.resolveUrl ?? ((u: string) => u);

  const byId = new Map(art.entries.map((e) => [e.id, e]));
  const links = new Map<string, DirectoryArtworkLink[]>();
  const joinedText = new Map<string, string[]>();
  const buildingsByNumber = new Map<string, string[]>();
  for (const [buildingId, joins] of art.joinsByBuilding) {
    links.set(buildingId, joins.map(linkOf));
    joinedText.set(
      buildingId,
      joins
        .flatMap((j) => [...j.labels.map((l) => l.text), ...j.aliases])
        .map(normalizeDirectoryText)
        .filter((t) => t !== ''),
    );
    for (const j of joins) {
      const n = subjectsById.get(j.subjectId)?.artworkNumber;
      if (n)
        buildingsByNumber.set(n.toLowerCase(), [
          ...(buildingsByNumber.get(n.toLowerCase()) ?? []),
          buildingId,
        ]);
    }
  }
  const pointers = new Map<string, DirectoryArtworkPointer[]>();
  for (const e of art.entries) {
    if (!e.unconfirmedMatch) continue;
    const list = pointers.get(e.unconfirmedMatch.buildingId) ?? [];
    list.push({ subjectId: e.id, title: e.title });
    pointers.set(e.unconfirmedMatch.buildingId, list);
  }

  // Every subject → the row that represents it.
  const subjectTarget = new Map<string, DirectoryItem>();
  for (const [subjectId, target] of art.bySubject) {
    if ('buildingId' in target) {
      const entry = entryOf(target.buildingId);
      if (entry) subjectTarget.set(subjectId, { kind: 'building', id: entry.id, entry });
    } else subjectTarget.set(subjectId, { kind: 'artwork', id: target.id, entry: target });
  }

  const thumbnailsOf = (subjectId: string): ArtworkThumbnail[] => {
    const s = subjectsById.get(subjectId);
    if (!s || s.displayHold) return [];
    const seen = new Set<string>();
    return s.vignetteAssetIds
      .map(thumbnailOfAsset)
      .filter((t): t is ArtworkThumbnail => t !== null && !seen.has(t.assetId) && !!seen.add(t.assetId));
  };
  const thumbnailOf = (subjectId: string): ArtworkThumbnail | null => thumbnailsOf(subjectId)[0] ?? null;
  const thumbnailOfAsset = (assetId: string): ArtworkThumbnail | null => {
    const a = assets.get(assetId);
    const canonical = a?.duplicateOf ? assets.get(a.duplicateOf) : a;
    if (!canonical?.original) return null;
    // Held labels are printed in their vignette: the image is withheld with the label.
    if (subjects.some((s) => s.displayHold && s.vignetteAssetIds.includes(canonical.assetId))) return null;
    return {
      assetId: canonical.assetId,
      url: canonical.original.url,
      src: resolveUrl(canonical.original.url),
      width: canonical.source.width,
      height: canonical.source.height,
    };
  };

  const groups = buildGroups(subjects, subjectTarget, assets, thumbnailOfAsset);

  // Index sections (exact headings printed on the overview), for the artwork category filter.
  const sectionOf = new Map<string, string | null>();
  const sectionCounts = new Map<string, ArtworkSection>();
  for (const s of subjects) {
    const c = s.displayHold ? null : s.artworkCategory;
    sectionOf.set(s.subjectId, c ? c.text : null);
    if (!c) continue;
    const cur = sectionCounts.get(c.text);
    if (cur) cur.count++;
    else sectionCounts.set(c.text, { text: c.text, ref: c.ref, count: 1 });
  }
  const sections = [...sectionCounts.values()].sort((a, b) => b.count - a.count || byString(a.text, b.text));

  const statusCounts = { verified: 0, approximate: 0, unresolved: 0 };
  for (const s of subjects) {
    const target = art.bySubject.get(s.subjectId);
    if (!target) continue;
    if ('buildingId' in target) statusCounts.verified++;
    else statusCounts[target.association.status]++;
  }

  // One artwork search (the contract's): artwork-only rows here; verified
  // joins are found through their building's own search text (joinedText).
  const searchArtwork = (query: string) =>
    art.search(query).flatMap((h) => (h.kind === 'artwork' ? [{ entry: h.entry, rank: h.rank }] : []));

  return {
    artwork: {
      entries: art.entries,
      byId,
      subjectTarget,
      subjects: subjectsById,
      groups,
      sections,
      sectionOf,
      statusCounts,
      thumbnailOf,
      thumbnailsOf,
    },
    links,
    pointers,
    searchArtwork,
    joinedText,
    buildingsByNumber,
  };
}

function buildGroups(
  subjects: readonly ArtSubject[],
  target: ReadonlyMap<string, DirectoryItem>,
  assets: ReadonlyMap<string, ManifestAsset>,
  thumbnailOfAsset: (assetId: string) => ArtworkThumbnail | null,
): ArtworkGroup[] {
  interface Caption {
    ref: string;
    heading: string;
    asset: string;
    labelIndex: number;
    offset: number;
    subjects: ArtSubject[];
  }
  const captions = new Map<string, Caption>();
  const uncaptioned: ArtSubject[] = [];
  const scenes: ArtSubject[] = [];
  const areas: ArtSubject[] = [];
  for (const s of subjects) {
    const h = s.displayHold ? null : s.visibleBlockLabel;
    if (s.kind === 'numbered' && h) {
      const key = `${h.ref}\u0000${h.text}`;
      let c = captions.get(key);
      if (!c) {
        const [asset, labelIndex] = refParts(h.ref);
        const full = assets.get(asset)?.labels.find((l) => l.labelId === h.ref)?.text ?? '';
        const offset = h.span ? Math.max(0, full.indexOf(h.text)) : 0;
        c = { ref: h.ref, heading: h.text, asset, labelIndex, offset, subjects: [] };
        captions.set(key, c);
      }
      c.subjects.push(s);
    } else if (s.kind === 'numbered') uncaptioned.push(s);
    else if (s.kind === 'scene') scenes.push(s);
    else areas.push(s);
  }

  const items = (list: readonly ArtSubject[]): DirectoryItem[] => {
    const seen = new Set<string>();
    const out: DirectoryItem[] = [];
    for (const s of list) {
      const t = target.get(s.subjectId);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  };
  const sortNumbered = (list: ArtSubject[]) =>
    [...list].sort((a, b) => compareNumbers(a.artworkNumber, b.artworkNumber));

  const groups: ArtworkGroup[] = [...captions.values()]
    .sort((a, b) => byString(a.asset, b.asset) || a.labelIndex - b.labelIndex || a.offset - b.offset)
    .map((c) => ({
      id: `caption:${c.ref}:${c.offset}`,
      kind: 'block-caption' as const,
      heading: c.heading,
      headingRef: c.ref,
      label: c.heading,
      thumbnail: thumbnailOfAsset(c.asset),
      items: items(sortNumbered(c.subjects)),
    }));
  const tail: [ArtworkGroup['kind'], string, ArtSubject[]][] = [
    ['numbered-uncaptioned', NUMBERED_UNCAPTIONED_GROUP_LABEL, sortNumbered(uncaptioned)],
    ['scenes', SCENES_GROUP_LABEL, [...scenes].sort((a, b) => byString(a.subjectId, b.subjectId))],
    ['areas', AREAS_GROUP_LABEL, [...areas].sort((a, b) => byString(a.subjectId, b.subjectId))],
  ];
  for (const [kind, label, list] of tail) {
    const rows = items(list);
    if (rows.length > 0)
      groups.push({ id: kind, kind, heading: null, headingRef: null, label, thumbnail: null, items: rows });
  }
  return groups;
}
