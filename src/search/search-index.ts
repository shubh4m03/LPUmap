import { APP_CONFIG } from '../config/index.ts';
import { mergeRanges } from './highlight.ts';
import { matchDoc } from './match.ts';
import { prepareDoc, type PreparedDoc, type Vocabulary } from './prepare.ts';
import { prepareQuery } from './query.ts';
import type { SearchDoc, SearchHit, SearchIndex, SearchOptions } from './types.ts';

function compareHits(a: SearchHit, b: SearchHit): number {
  if (a.score !== b.score) return b.score - a.score;
  const boostA = a.doc.boost ?? 0;
  const boostB = b.doc.boost ?? 0;
  if (boostA !== boostB) return boostB - boostA;
  if (a.doc.title.length !== b.doc.title.length) return a.doc.title.length - b.doc.title.length;
  if (a.doc.id < b.doc.id) return -1;
  return a.doc.id > b.doc.id ? 1 : 0;
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return APP_CONFIG.search.maxResults;
  return Math.max(0, Math.floor(limit));
}

/**
 * Builds an in-memory index. Docs are deduplicated by id (first occurrence
 * wins) and every normalised field is computed here, once. Docs without a
 * usable id or title are skipped rather than throwing.
 */
export function createSearchIndex(docs: SearchDoc[]): SearchIndex {
  const vocab: Vocabulary = { words: [], ids: new Map() };
  const prepared: PreparedDoc[] = [];
  const seen = new Set<string>();
  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc || typeof doc.id !== 'string' || doc.id === '' || typeof doc.title !== 'string') continue;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    prepared.push(prepareDoc(doc, vocab));
  }

  return {
    get size() {
      return prepared.length;
    },
    search(query: string, options?: SearchOptions): SearchHit[] {
      const opts: SearchOptions = options !== null && typeof options === 'object' ? options : {};
      const limit = resolveLimit(typeof opts.limit === 'number' ? opts.limit : undefined);
      if (limit === 0) return [];
      let q;
      try {
        q = prepareQuery(query, vocab);
      } catch {
        return [];
      }
      if (!q) return [];
      const kinds = Array.isArray(opts.kinds) && opts.kinds.length > 0 ? new Set(opts.kinds) : null;
      const hits: SearchHit[] = [];
      for (const pd of prepared) {
        if (kinds && !kinds.has(pd.doc.kind)) continue;
        const m = matchDoc(pd, q);
        if (!m) continue;
        hits.push({
          doc: pd.doc,
          score: Math.round(m.score * 1000) / 1000,
          matchKind: m.matchKind,
          highlights: mergeRanges(m.highlights, pd.doc.title.length),
        });
      }
      hits.sort(compareHits);
      return hits.slice(0, limit);
    },
  };
}
