export type { SearchDoc, SearchDocKind, SearchHit, SearchIndex, SearchOptions, MatchKind } from './types.ts';
export { TIER_SCORES } from './types.ts';
export { createSearchIndex } from './search-index.ts';
export {
  docsFromPlaces,
  docsFromCategories,
  looksLikeCode,
  PLACE_DOC_PREFIX,
  CATEGORY_DOC_PREFIX,
  type PlaceDocOptions,
} from './docs.ts';
export { highlightSegments, type HighlightSegment } from './highlight.ts';
export { normalize, tokenize, STOPWORDS, GENERIC_WORDS } from './normalize.ts';
export { MAX_QUERY_LENGTH } from './query.ts';
