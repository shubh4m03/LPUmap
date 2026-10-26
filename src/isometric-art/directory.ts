/**
 * How artwork subjects join the shared building directory (src/directory)
 * and search. Pure. Contract (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5):
 *
 *  - VERIFIED subject → no separate entry. It joins the existing directory
 *    entry whose stable id equals its `buildingId`; that entry gains the
 *    artwork labels (exact) as extra search text and a link to the
 *    illustration. One building, one entry, one id in every view.
 *  - Any other subject → an artwork-only entry with its stable `art:` id. It
 *    is searchable by its exact printed labels and by its aliases, is NEVER
 *    routable, and NEVER has coordinates. An approximate association adds an
 *    "Unconfirmed match" pointer to the candidate building (show its outline
 *    on the map, labelled as unconfirmed; never route to it, never merge it).
 *  - A label under `displayHold` is neither shown nor searchable.
 */
import { normalizeDirectoryText } from '../directory/normalize.ts';
import type { EffectiveArtworkAssociation } from './associations.ts';
import type { ArtSubject, LabelQuote } from './schema.ts';
import { ARTWORK_NUMBER_NOTE, UNCONFIRMED_MATCH_LABEL } from './text.ts';

export type ArtworkLabelRole = 'display' | 'visible-block' | 'other' | 'category';

export interface ArtworkLabelView {
  role: ArtworkLabelRole;
  /** Exact printed text. */
  text: string;
  ref: string;
}

export interface ArtworkJoin {
  /** The verified canonical building id (an existing directory / studio id). */
  buildingId: string;
  subjectId: string;
  labels: ArtworkLabelView[];
  aliases: string[];
  hotspotIds: string[];
}

export const ARTWORK_NOT_ROUTABLE_NOTE =
  'Not routable: this item from the campus illustration is not linked to a verified map building.';

export interface ArtworkOnlyEntry {
  /** Stable `art:` id (URL, favourites). */
  id: string;
  subjectKind: ArtSubject['kind'];
  /** Exact display label, else the exact block heading, else a neutral non-name ("Illustration pin 25"). */
  title: string;
  subtitle: string;
  artworkNumber: string | null;
  /** Shown beside any artwork number. */
  artworkNumberNote: string | null;
  labels: ArtworkLabelView[];
  aliases: string[];
  labelWithheld: boolean;
  association: EffectiveArtworkAssociation;
  /** Approximate only: candidate building to outline as "Unconfirmed match" (never routed). */
  unconfirmedMatch: { buildingId: string; label: string } | null;
  routable: false;
  routableNote: string;
  location: null;
  hotspotIds: string[];
  vignetteAssetIds: string[];
}

export interface ArtworkDirectory {
  /** Artwork-only entries, in subject id order. */
  readonly entries: readonly ArtworkOnlyEntry[];
  /** Verified joins, by building id (a building may be depicted by several subjects). */
  readonly joinsByBuilding: ReadonlyMap<string, readonly ArtworkJoin[]>;
  readonly bySubject: ReadonlyMap<string, ArtworkOnlyEntry | ArtworkJoin>;
  /**
   * Artwork-only entries and joined building ids matching a query on exact
   * labels, aliases and the printed artwork number
   * (case/diacritic/punctuation-insensitive). Rank 0: the artwork number the
   * query names ("25", "Block 25", "BLOCK-25", "block25") or an exact
   * label/alias; 1: a label/alias prefix; 2: contained, or every query word
   * contained. Then artwork-number order, then id. The ONLY artwork search:
   * the building directory (src/directory/artwork.ts) uses it.
   */
  search(query: string): ArtworkSearchHit[];
}

export type ArtworkSearchHit =
  | { kind: 'artwork'; id: string; entry: ArtworkOnlyEntry; rank: 0 | 1 | 2 }
  | { kind: 'building'; id: string; join: ArtworkJoin; rank: 0 | 1 | 2 };

const SUBTITLE = 'On the campus illustration (schematic, not geographically exact)';

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Query → the artwork number it names, when it names one: '25', '025',
 * 'Block 25', 'BLOCK-25', 'block25', '21a' → '25' / '21a'. Null otherwise.
 * (The illustration's own numbering, never an official LPU block number.)
 */
export function artworkNumberQuery(query: string): string | null {
  const q = normalizeDirectoryText(query).replace(/\s+/g, '');
  const m = /^(?:block|blk|b)?0*(\d{1,3}[a-z]?)$/.exec(q);
  return m ? m[1]! : null;
}

/** '25' → [25, ''], '21A' → [21, 'a']: numeric order of artwork numbers. */
function numberKey(n: string | null): [number, string] {
  const m = /^(\d+)([A-Za-z]?)$/.exec(n ?? '');
  return m ? [Number(m[1]), m[2]!.toLowerCase()] : [Number.MAX_SAFE_INTEGER, n ?? ''];
}

/** Numeric order of printed artwork numbers ('9' < '21' < '21A' < '25'; none last). */
export function compareArtworkNumbers(a: string | null, b: string | null): number {
  const [na, sa] = numberKey(a);
  const [nb, sb] = numberKey(b);
  return na - nb || byString(sa, sb);
}

function labelViews(s: ArtSubject): ArtworkLabelView[] {
  if (s.displayHold) return [];
  const view = (role: ArtworkLabelRole, q: LabelQuote | null): ArtworkLabelView[] =>
    q ? [{ role, text: q.text, ref: q.ref }] : [];
  return [
    ...view('display', s.displayLabel),
    ...view('visible-block', s.visibleBlockLabel),
    ...s.otherLabels.flatMap((q) => view('other', q)),
    ...view('category', s.artworkCategory),
  ];
}

function titleFor(s: ArtSubject): string {
  if (s.displayHold) return 'Illustrated item (label withheld pending owner review)';
  if (s.displayLabel) return s.displayLabel.text;
  if (s.visibleBlockLabel) return s.visibleBlockLabel.text;
  if (s.artworkNumber !== null) return `Illustration pin ${s.artworkNumber}`;
  return 'Unlabelled area on the illustration';
}

export function createArtworkDirectory(
  subjects: readonly ArtSubject[],
  associations: ReadonlyMap<string, EffectiveArtworkAssociation>,
): ArtworkDirectory {
  const entries: ArtworkOnlyEntry[] = [];
  const joins = new Map<string, ArtworkJoin[]>();
  const bySubject = new Map<string, ArtworkOnlyEntry | ArtworkJoin>();
  const sorted = [...subjects].sort((a, b) =>
    a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0,
  );
  for (const s of sorted) {
    const assoc = associations.get(s.subjectId);
    if (!assoc) throw new Error(`No effective association for ${s.subjectId}`);
    const labels = labelViews(s);
    const aliases = s.displayHold ? [] : [...s.aliases];
    if (assoc.status === 'verified' && assoc.buildingId !== null) {
      const join: ArtworkJoin = {
        buildingId: assoc.buildingId,
        subjectId: s.subjectId,
        labels,
        aliases,
        hotspotIds: [...s.hotspotIds],
      };
      joins.set(assoc.buildingId, [...(joins.get(assoc.buildingId) ?? []), join]);
      bySubject.set(s.subjectId, join);
      continue;
    }
    const entry: ArtworkOnlyEntry = {
      id: s.subjectId,
      subjectKind: s.kind,
      title: titleFor(s),
      subtitle: SUBTITLE,
      artworkNumber: s.artworkNumber,
      artworkNumberNote: s.artworkNumber !== null ? ARTWORK_NUMBER_NOTE : null,
      labels,
      aliases,
      labelWithheld: s.displayHold !== null,
      association: assoc,
      unconfirmedMatch:
        assoc.status === 'approximate' && assoc.unconfirmedMatchId !== null
          ? { buildingId: assoc.unconfirmedMatchId, label: UNCONFIRMED_MATCH_LABEL }
          : null,
      routable: false,
      routableNote: ARTWORK_NOT_ROUTABLE_NOTE,
      location: null,
      hotspotIds: [...s.hotspotIds],
      vignetteAssetIds: [...s.vignetteAssetIds],
    };
    entries.push(entry);
    bySubject.set(s.subjectId, entry);
  }

  const numberOf = new Map(sorted.map((s) => [s.subjectId, s.displayHold ? null : s.artworkNumber]));
  const texts = (labels: readonly ArtworkLabelView[], aliases: readonly string[]) =>
    [...labels.map((l) => l.text), ...aliases].map(normalizeDirectoryText).filter((t) => t !== '');
  const entryTexts = new Map(entries.map((e) => [e.id, texts(e.labels, e.aliases)]));
  const joinList = [...joins.values()].flat();
  const joinTexts = new Map(joinList.map((j) => [j.subjectId, texts(j.labels, j.aliases)]));

  return {
    entries,
    joinsByBuilding: joins,
    bySubject,
    search(query: string): ArtworkSearchHit[] {
      const q = normalizeDirectoryText(query);
      if (q === '') return [];
      const num = artworkNumberQuery(query);
      const tokens = q.split(' ');
      const rankOf = (subjectId: string, haystack: readonly string[]): 0 | 1 | 2 | null => {
        if (num !== null && numberOf.get(subjectId)?.toLowerCase() === num) return 0;
        if (haystack.includes(q)) return 0;
        if (haystack.some((t) => t.startsWith(q))) return 1;
        if (haystack.some((t) => t.includes(q))) return 2;
        if (tokens.every((tk) => haystack.some((t) => t.includes(tk)))) return 2;
        return null;
      };
      const hits: { hit: ArtworkSearchHit; number: string | null }[] = [];
      for (const e of entries) {
        if (e.labelWithheld) continue;
        const rank = rankOf(e.id, entryTexts.get(e.id) ?? []);
        if (rank !== null)
          hits.push({ hit: { kind: 'artwork', id: e.id, entry: e, rank }, number: e.artworkNumber });
      }
      for (const j of joinList) {
        const rank = rankOf(j.subjectId, joinTexts.get(j.subjectId) ?? []);
        if (rank !== null)
          hits.push({
            hit: { kind: 'building', id: j.buildingId, join: j, rank },
            number: numberOf.get(j.subjectId) ?? null,
          });
      }
      return hits
        .sort(
          (a, b) =>
            a.hit.rank - b.hit.rank ||
            compareArtworkNumbers(a.number, b.number) ||
            byString(a.hit.id, b.hit.id),
        )
        .map((x) => x.hit);
    },
  };
}
