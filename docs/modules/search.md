# Module: search

**Path:** `src/search/` (pure TypeScript)

## Purpose

One local, deterministic search over places, categories, map layers and app commands. It powers the
command palette, the search results panel and endpoint pickers in directions. Everything is computed
on the device; no query leaves the browser.

## Public interface (`src/search/index.ts`)

```ts
createSearchIndex(docs: SearchDoc[]): SearchIndex
interface SearchIndex { search(query: string, opts?: { limit?: number; kinds?: SearchDocKind[] }): SearchHit[]; readonly size: number }
docsFromPlaces(places: Place[], opts?: PlaceDocOptions): SearchDoc[]     // opts.hostName(placeId) → name of the place it is located in
docsFromCategories(categories: readonly CategoryDef[], counts: Record<string, number>): SearchDoc[]
highlightSegments(text, ranges): Array<{ text: string; match: boolean }>
normalize(s), tokenize(s), STOPWORDS, GENERIC_WORDS, MAX_QUERY_LENGTH /* 100 */, TIER_SCORES, looksLikeCode,
PLACE_DOC_PREFIX /* 'place:' */, CATEGORY_DOC_PREFIX /* 'category:' */
// types: SearchDoc { id, kind: 'place'|'category'|'layer'|'command', title, subtitle?, aliases, codes, keywords,
//          categoryId?, ref, boost?, hasLocation }, SearchHit { doc, score, matchKind, highlights }, MatchKind, …
```

The app's index (`src/app/data/services.ts`) combines four kinds of doc:

- category docs, boosted by +50 so that a category beats places sharing its synonyms
- place docs
- layer docs
- command docs (`src/app/commands.ts`)

On the current dataset that is 328 docs.

## Ranking

Ranking runs in tiers, highest first. Scores within a tier are adjusted by match position and
coverage.

| Tier                                   | Score       | `matchKind`       |
| -------------------------------------- | ----------- | ----------------- |
| Exact title / exact alias              | 1039 / 1020 | `exact` / `alias` |
| Doc code / derived initialism          | 930 / 920   | `code`            |
| Title prefix / alias prefix            | 800+ / 750+ | `prefix`          |
| Word boundary in title                 | 650+        | `word`            |
| All tokens, any order                  | 550+        | `multiword`       |
| Keyword or category synonym            | 400–439     | `synonym`         |
| Typos, partial and subsequence matches | ≤ 300       | `fuzzy`           |

Ties are broken by `boost`, then the shorter title, then `id`. The result is fully deterministic.

## Invariants

- `search()` never throws. It returns `[]` for empty or whitespace queries and for `limit <= 0`. The
  default limit is `APP_CONFIG.search.maxResults` (20), and queries are capped at 100 code points.
- A doc never matches on a stopword alone. A query made only of stopwords matches only words it is a
  prefix of (for example "at" → "ATM"), plus exact titles.
- **Unnamed places with no aliases are not indexed at all**, so generic queries are not flooded with
  "Unnamed building". This is stricter than the contract's "rank lower". A nameless place with a
  sourced alias is titled by that alias, never by the generated "Unnamed building" label.
- Place doc subtitles state the category, and "Off campus (nearby)" for off-campus places. When two
  docs share a title (for example an OSM building and an official record both called "School of
  Design"), their subtitles also give the kind and, where known, the host place (`hostName`).
  Category subtitles never claim a place is "mapped" when it has no position (`categorySubtitle` in
  the app).
- `highlights` are merged `[start, end)` ranges in the **original** title, and cover only the words
  that actually matched.
- Doc ids are prefixed (`place:…`, `category:…`) so the two kinds cannot collide. Duplicate ids are
  dropped when the index is built (the first occurrence wins).

## Tests

`tests/unit/search/*` (6 files, 96 tests):

- normalisation (diacritics, punctuation, `&` versus "and")
- every ranking tier and tie-break
- fuzzy matching and typos
- highlight ranges
- docs from places and categories (unnamed exclusion, off-campus subtitles)
- a performance budget: p95 < 50 ms on 5,000 synthetic docs, and with a vocabulary of about 4,000
  words

The app-level ranking (category boost) is tested in `tests/unit/app/services.test.ts` and
`command-palette.test.tsx`.

Measured on the real index, the p95 is about 0.5 ms; see [PERFORMANCE.md](../PERFORMANCE.md).

## Known limitations

- The generic-word and stopword lists in `normalize.ts` are fixed. They have not been tuned against
  real query logs, and there are none, by design.
- For a bare digit query such as "4", "Block 45" can rank close to "Hall 4", because the last token
  may prefix-match.
- Block numbers are not searchable, because they are not in the data (see
  [DATA_SOURCES.md](../DATA_SOURCES.md)). Adding sourced aliases makes them searchable without code
  changes.
- The wall-clock budget tests can fail under heavy parallel load (observed in a full `vitest run`);
  see [PERFORMANCE.md](../PERFORMANCE.md).
