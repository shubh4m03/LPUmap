# Data sources

Every fact the app shows traces back to one of the sources below. This page records, for each
source:

- the URL and licence
- when it was retrieved
- how it is transformed
- how far it has been verified
- its limitations

It also lists what was searched for and **not** found.

The page-by-page record of the LPU research is in
[research/LPU_PUBLIC_SOURCES.md](research/LPU_PUBLIC_SOURCES.md). The pipeline rules are in
[data/README.md](../data/README.md). Generated counts are in
[DATA_QUALITY_REPORT.md](DATA_QUALITY_REPORT.md), for dataset `b628c5855b1d`.

## Provenance model

Every place carries `provenance`:

- `sourceId` (a manifest source)
- `sourceRef` (the OSM element or page URL)
- `retrievedAt`
- `verificationStatus`

| `verificationStatus` | Meaning                                                                                                        | Count in the current dataset |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `imported`           | Taken from a cited source, not checked on the ground. **All OSM and LPU-page records are imported**            | 855                          |
| `verified`           | Only through a curated override with `check: physical-survey` or `official-publication`; sets `lastVerifiedAt` | 0                            |
| `unverified`         | A curated override from an `unverified-report`                                                                 | 0                            |
| `estimated`          | Reserved in the schema for derived values                                                                      | 0                            |

Building heights also carry a `heightSource`:

- `osm-height`: a measured tag. There are none in this snapshot.
- `osm-levels-estimate`: `building:levels` × 3.2 m. 137 buildings.
- `fallback`: a 6 m placeholder. 398 buildings.

The UI shows the verification badge, the source and the retrieval date on every place. The 3D legend
shows the height source.

## Sources used

### 1. OpenStreetMap (map data)

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL            | `https://api.openstreetmap.org/api/0.6/map?bbox=75.695,31.243,75.715,31.262` and `https://api.openstreetmap.org/api/0.6/relation/21599790/full`                                                                                                                                                                                                                                                                                                                                                                 |
| Licence        | Open Database License 1.0. Attribution "© OpenStreetMap contributors". `public/data/*` is a derived database (share-alike if distributed publicly)                                                                                                                                                                                                                                                                                                                                                              |
| Retrieved      | 2026-10-23T09:39:00Z (`data/raw/osm/SOURCE.json`, `method: "osm-api-map"`)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Files          | `data/raw/osm/campus-bbox.osm` (2.3 MB), `data/raw/osm/boundary-relation-21599790.osm` (26 KB), committed                                                                                                                                                                                                                                                                                                                                                                                                       |
| Transformation | `npm run data:build`, offline and deterministic. The steps are: boundary from relation 21599790 ("Lovely Professional University", multipolygon); building footprints with height source; places classified by `src/config/categories.ts`, with zone `on-campus` or `off-campus-nearby`; a walking/cycling graph of one edge per consecutive node pair, joined only at shared nodes; place-to-graph connectors of at most 60 m; relations (`located_in`, `part_of`, `nearby`, `accessed_via`); a quality report |
| Output         | 855 places (233 on campus, 622 off campus nearby), 535 buildings, 389 basemap features, 760 relations, a graph of 1,636 nodes / 1,770 edges / 9 components                                                                                                                                                                                                                                                                                                                                                      |
| Verification   | `imported`. No physical survey has been done                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Limitations    | See the gaps listed below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Gaps in the OSM data:

- 499 of 535 footprints are unnamed (134 on campus).
- No `height` tags.
- No wheelchair tags on paths and no mapped steps.
- 0 entrance nodes.
- Almost no opening hours.
- No drinking water, washrooms or printing mapped.
- Most named POIs are in the off-campus Law Gate area. "Law gate" itself is mapped as a residential
  area, not as a gate.
- 34 places are more than 60 m from the graph.
- Untagged trunk roads (NH44) are excluded from routing.

**Overpass was unreachable.** Both `overpass-api.de` and `overpass.kumi.systems` refused connections
from the retrieving machine on 2026-10-23. `scripts/fetch-osm.ts` therefore tries Overpass first
(3 retries with exponential backoff per endpoint) and then falls back to the OSM API 0.6, which is
how the committed snapshot was obtained. The fetch bbox is the boundary extent plus about 500 m, so
nearby off-campus places are included and labelled "off campus".

A live run of the fetcher has not been repeated since. Its Overpass and fallback logic is covered by
tests with a mocked `fetch`.

### 2. Lovely Professional University website (official names)

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL            | `https://www.lpu.in/schools/` and 27 `https://www.lpu.in/schools/<slug>/` pages; `/academics/libraries.php`; `/student-services/healthcare.php`; `/campus-life/sports.php`. The full list is in the manifest `sources`                                                                                                                                                                                                                                                                 |
| Licence        | © LPU. The site terms allow personal, non-commercial use only and prohibit other reproduction. We store **only** short factual identifiers (official names, page titles and URLs as citations); descriptions are our own one-line templates. No prose, images or logos are copied. Raw HTML is cached only in the git-ignored `data/.cache/lpu/`                                                                                                                                       |
| Retrieved      | 2026-10-23, with `robots.txt` obeyed (`/schools/`, `/student-services/`, `/academics/libraries.php` and `/campus-life/` are not disallowed; `/downloads/` is disallowed and was not fetched)                                                                                                                                                                                                                                                                                           |
| Transformation | `npm run data:fetch-public` → `data/curated/organizations.json`. 32 records: 27 schools or disciplines from the schools index, 2 umbrella school names, and 3 facilities (Central Library, Uni Health Centre, Department of Sports). Names follow a reproducible rule (the printed "School of …" form when it appears on the school's own page, otherwise the index label). `data/raw/lpu/public-pages.snapshot.json` keeps URLs, titles, byte counts and SHA-256 hashes, with no HTML |
| Output         | 32 places of kind `organization`. **31 have no location.** One, "School of Design", is anchored to OSM way 425717552, which carries exactly that name                                                                                                                                                                                                                                                                                                                                  |
| Verification   | `imported`. The site's own disclaimer says its information may be incomplete or out of date. The School of Design anchor rests on an identical name and an on-campus position; human confirmation is recommended                                                                                                                                                                                                                                                                       |
| Limitations    | No positions are published for any school or facility. "Block-37" for the Central Library is stated, but no block has a published position. Some records use discipline labels ("Planning", "Theatre & Music") because the page prints no "School of …" form                                                                                                                                                                                                                           |

### 3. Wikidata (consulted, not imported)

| Field   | Value                                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL     | `https://www.wikidata.org/wiki/Special:EntityData/Q5756621.json`                                                                                                                                  |
| Licence | CC0                                                                                                                                                                                               |
| Use     | Confirmed the official website, the "LPU" alias and a point coordinate. Nothing was imported, because the OSM boundary is more precise. Wikipedia was not fetched; Wikidata covers the same facts |

### 4. Map glyphs (not data, listed for completeness)

Noto Sans SDF glyph ranges (Latin, Latin-1, Latin Extended-A/B and general punctuation) were
downloaded on 2026-10-23 from `demotiles.maplibre.org`. They are licensed under SIL OFL 1.1, and
their SHA-256 hashes are recorded in `public/fonts/SOURCE.md`.

## Curated files

| File                              | Records now     | Rules                                                                                                               |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `data/curated/aliases.json`       | 0               | Alias only when a cited source ties that name to that exact mapped feature                                          |
| `data/curated/overrides.json`     | 0               | Every override cites a source and states `check` (`physical-survey`, `official-publication` or `unverified-report`) |
| `data/curated/organizations.json` | 32 (1 anchored) | Generated by `data:fetch-public`; only anchors are hand-curated                                                     |

## Searched for and not found

These were looked for on the public LPU site, its linked pages, OSM and Wikidata. The app shows each
one as unavailable or as an empty category, with links to the official pages where they exist.

| Item                                    | Finding                                                                                                                                         | What the app does                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mess menus**                          | No public menu. The residence page says only that a mess exists                                                                                 | "Mess & food menus" unavailable section; link to mapped food places                                                                         |
| **Shuttle / bus timetable**             | The transport page lists day-scholar routes, pickup points and annual charges, with no times and no on-campus shuttle                           | "Transport & shuttle" unavailable section                                                                                                   |
| **Events feed**                         | Only retrospective event write-ups and a news RSS feed; no upcoming events with dates and venues                                                | "Events & announcements" unavailable section                                                                                                |
| **Faculty offices / directory**         | Listings exist, but they are personal data, the terms forbid reuse, and no office locations are published                                       | Not offered; explained in the app                                                                                                           |
| **Block-number positions**              | Pages mention blocks ("Central Library … Block-37"), but no official map gives positions, and "Block NN" names are absent from OSM              | Blocks are not on the map; the Central Library is listed without a position                                                                 |
| **Official campus map**                 | None on the fetched pages. The only visual is a third-party 360° tour (`iviewd.com/lpu2/`) with no reuse licence and no coordinates             | The map is built from OSM only                                                                                                              |
| **Washrooms, drinking water, printing** | Not published; not mapped in OSM                                                                                                                | Empty categories with an explanation                                                                                                        |
| **Opening hours**                       | Library service timings and a 24×7 health centre are stated, but are not tied to mapped features, and the disclaimer warns they may be outdated | Not imported; hours show as unknown                                                                                                         |
| **Bank / ATM names and positions**      | "Five banks" and ATMs are mentioned, none named or positioned                                                                                   | Only OSM-mapped banks and ATMs appear (2 records, both off campus)                                                                          |
| **Accessibility information**           | No published step-free routes, ramps or lifts. No wheelchair tags in OSM                                                                        | Step-free routes always carry "accessibility unverified"                                                                                    |
| **Building entrances**                  | 0 entrance nodes in OSM                                                                                                                         | Routes finish with a straight connector leg from the nearest graph node to the place's position; a connector longer than 15 m gets a caveat |
| **Building heights**                    | No `height` tags; 137 footprints have `building:levels`                                                                                         | Estimated or placeholder heights, labelled as such                                                                                          |

Not examined, on purpose:

- `ums.lpu.in` (login portal)
- `library.lpu.in` (catalogue search tool)
- `webapi.lpu.in` (an undocumented API)
- anything under paths that `robots.txt` disallows

## Refreshing sources

```sh
DATA_FETCH_CONTACT="<e-mail or URL>" npm run data:fetch -- --force       # OSM snapshot
DATA_FETCH_CONTACT="<e-mail or URL>" npm run data:fetch-public -- --dry-run   # LPU names, preview only
npm run data:check                                                       # rebuild + validate
```

Review the count-change warnings and `docs/DATA_QUALITY_REPORT.md`, then commit the raw, curated and
generated files together. `DATA_FETCH_CONTACT` must be a contact the operator is happy to share with
the remote servers. See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md#incident-record-personal-e-mail-sent-in-user-agent-headers-during-research).
