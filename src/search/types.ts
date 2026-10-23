export type SearchDocKind = 'place' | 'category' | 'layer' | 'command';

export interface SearchDoc {
  id: string;
  kind: SearchDocKind;
  title: string;
  subtitle?: string;
  /**
   * Set only when another doc has the same title: what tells them apart (kind and, when
   * known, the place it is in), e.g. 'Department or office · in School of Design'.
   * Already part of `subtitle`; UIs that build their own subtitle append it.
   */
  qualifier?: string;
  aliases: string[];
  codes: string[];
  keywords: string[];
  categoryId?: string;
  ref: string;
  boost?: number;
  hasLocation: boolean;
}

export type MatchKind = 'exact' | 'alias' | 'code' | 'prefix' | 'word' | 'multiword' | 'synonym' | 'fuzzy';

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  matchKind: MatchKind;
  /** Half-open [start, end) ranges into the ORIGINAL `doc.title` string. */
  highlights: Array<[number, number]>;
}

export interface SearchOptions {
  limit?: number;
  kinds?: SearchDocKind[];
}

export interface SearchIndex {
  search(query: string, opts?: SearchOptions): SearchHit[];
  readonly size: number;
}

/** Base score of each ranking tier; within-tier adjustments always stay below the next tier's gap. */
export const TIER_SCORES = {
  exact: 1000,
  code: 900,
  prefix: 800,
  aliasPrefix: 750,
  word: 650,
  multiword: 550,
  synonym: 400,
  fuzzyMax: 300,
} as const;
