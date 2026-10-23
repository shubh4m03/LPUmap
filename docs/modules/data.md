# Module: data (pipeline, schemas, loader, config)

**Paths:**

- `scripts/` (build-data, validate-data, fetch-osm, fetch-public-data, `lib/`)
- `src/data/` (schema, loader)
- `src/config/` (`APP_CONFIG`, category registry)
- `data/` (raw, curated, schemas)
- `public/data/` (generated)

## Purpose

This module turns the committed OpenStreetMap snapshot and a few sourced curated records into the
validated, versioned dataset the app loads. It also defines the single source of truth for data
types (Zod schemas) and tunable values (`APP_CONFIG`). The pipeline is offline and deterministic:
the same inputs always produce byte-identical output.

## Public interface

### `src/data/index.ts`

```ts
export * from './schema.ts';            // Zod schemas + inferred types: Place, Relation, GraphFile, Manifest, LngLat, …
export const DATA_SCHEMA_VERSION = 1;   // (from schema.ts)
export interface CampusData { manifest; boundary; buildings; basemap; places: Place[]; relations: Relation[]; graph: GraphFile }
export class DatasetError extends Error {
  readonly code: 'network' | 'schema-version' | 'invalid';
  readonly file: string | undefined;
}
export function loadCampusData(opts?: { baseUrl?: string; fetchImpl?: typeof fetch }): Promise<CampusData>;
export function defaultDataBaseUrl(): string;   // import.meta.env.BASE_URL + 'data/', or '/data/' outside Vite
export type DatasetErrorCode; export type LoadCampusDataOptions;
```

`src/data/place-labels.ts` also exports `PLACE_KIND_LABELS`, the user-facing name of each place kind.
It is shared by place details and search.

### `src/config`

- `APP_CONFIG`: brand, map view, routing speeds and limits, geolocation and tracking thresholds,
  search, performance budgets, storage and cache.
- `validateConfig()`: called at start-up, and throws on an inconsistent config.
- `CATEGORIES`, `LAYER_GROUPS`, `getCategory(id)`, `categoriesInGroup(group)`: the category registry
  with OSM tag matchers, icons, nouns and synonyms.

### CLIs

| Command                                                                                      | Behaviour                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/build-data.ts [--input --curated --out --cache --report --schemas --relation]` | Builds `public/data/*`, `docs/DATA_QUALITY_REPORT.md` and `data/schemas/*.json`, then runs Prettier on the generated files    |
| `node scripts/validate-data.ts [--dir --previous --check-links]`                             | Schemas plus invariants; exit 1 on any error; warns on suspicious count changes against the previous manifest                 |
| `node scripts/fetch-osm.ts [--force --out --relation]`                                       | Overpass (2 endpoints, retries) → OSM API 0.6 fallback; does nothing if a snapshot exists                                     |
| `node scripts/fetch-public-data.ts [--dry-run] [--offline]`                                  | Re-extracts official LPU names under `robots.txt`; needs `DATA_FETCH_CONTACT` for live runs; refuses drops over 40 % (exit 2) |

## Generated dataset

These figures are for the current `manifest.json`: `datasetVersion` `b628c5855b1d`, schema 1, built
from OSM retrieved 2026-10-23T09:39:00Z.

| File                  | Contents                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `manifest.json`       | Schema and dataset version, sources with licences, per-file bytes and SHA-256, counts, bbox            |
| `boundary.geojson`    | The campus polygon from OSM relation 21599790                                                          |
| `buildings.geojson`   | 535 footprints, with `heightM`, `minHeightM`, `heightSource`, `levels`, name and category              |
| `basemap.geojson`     | 389 features: roads, paths, water, green areas, …                                                      |
| `places.json`         | 855 places. Ids are `osm:<type>/<id>` or `cur:<slug>`                                                  |
| `relations.json`      | 760 relations: `located_in` 167, `part_of` 200, `nearby` 393, `accessed_via` 0                         |
| `graph.json`          | 1,636 nodes and 1,770 edges, with access per mode, steps, wheelchair, oneway, indoor, surface and name |
| `quality-report.json` | Machine-readable quality report; rendered as `docs/DATA_QUALITY_REPORT.md`                             |

## Invariants

- **Determinism.** Rebuilding from the same inputs produces identical bytes. `datasetVersion` is a
  hash of the data files, including the quality report.
- **Boundary.** The boundary comes from relation 21599790's outer ways only. If they do not close,
  the build fails; it never substitutes a rectangle.
- **Heights.** Every building records `heightSource`: `osm-height`, then `osm-levels-estimate`
  (levels × `metresPerLevel` 3.2), then `fallback` (`fallbackBuildingHeightM` 6).
- **Graph.** There is one edge per consecutive OSM node pair, and ways join only at shared nodes.
  Disconnected components are counted and listed, **never bridged**. Trunk, primary and motorway are
  excluded unless foot (or bicycle) is explicitly allowed. Steps are `wheelchair: 'no'` unless
  tagged; everything else untagged is `unknown`.
- **Connectors.** A place gets `graphNodeId` only if a walkable node lies within `maxPlaceConnectorM`
  (60 m). Otherwise it is listed as not connected.
- **Curated records** must cite a source.
  - Anchors and alias targets must resolve to an id in the snapshot, or the build fails.
  - Only overrides with `check: physical-survey` or `official-publication` set `verified` and
    `lastVerifiedAt`.
  - Organizations without an anchor keep `location: null`.
- **Loader.**
  - `manifest.json` is fetched first, with `cache: 'no-cache'`.
  - A missing or non-numeric `schemaVersion` gives `invalid`; a different number gives
    `schema-version`. In both cases nothing else is fetched.
  - The data files are fetched in parallel at `<file>?v=<datasetVersion>` and each is
    Zod-validated.
  - Fetch and HTTP failures give `network`; malformed JSON or a schema failure gives `invalid` and
    names the file.
- **Building and place agreement.** Building feature `properties.id` equals the building's place
  id. Name, display name and category always match the place, with curated overrides included.

## Tests

- `tests/unit/data/*` (10 files) covers:
  - OSM parsing, including XML entities
  - geometry
  - height classification
  - graph and access rules
  - curated-schema validation
  - places and relations
  - the validator
  - the fetcher (mocked `fetch`: Overpass, fallback, retry and backoff)
  - loader errors and the schema version
  - the organizations file and the refresher's pure helpers (robots rules, extraction, drop guard,
    anchor merge)
- `tests/integration/pipeline.test.ts` covers the synthetic snapshot, determinism and the full
  output.
- `tests/integration/pipeline-real-snapshot.test.ts` builds the real committed snapshot into a temp
  directory and asserts the truthfulness rules.
- `npm run data:check` re-runs the real build and validation, and is part of `npm run build`.

## Known limitations

- `fetch-osm.ts` has been exercised only with a mocked `fetch`. The committed snapshot was taken
  manually through the OSM API, because Overpass was unreachable.
- When two routable ways share the same consecutive node pair, the segment from the lower way id is
  kept and the other dropped. This is deterministic, but it does not merge access rules. There are 0
  cases in the current snapshot, and the count is reported.
- `part_of` relations are emitted for every located on-campus place, not only buildings and
  facilities. The containment is real but broader than first specified.
- Named OSM `place=*` features are treated as infrastructure and dropped, unless the name contains
  "gate". Nearby neighbourhood names are not searchable.
- 31 unanchored organizations carry `campusZone: 'on-campus'` with `location: null`. They are LPU
  units, but they are not drawn.
- `office=educational_institution` without a building tag is classified as `other`. One case:
  "School of Design".
- `scripts/fetch-public-data.ts` is about 500 lines, above the preferred file size. It follows
  redirects inside `www.lpu.in` without re-checking `robots.txt` for the redirect target.
- Every record is `imported`; nothing is `verified`. See
  [DATA_QUALITY_REPORT.md](../DATA_QUALITY_REPORT.md) for the gaps (unnamed buildings, empty
  categories, 9 graph components, 34 unconnected places).
