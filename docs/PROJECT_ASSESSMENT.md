# Project assessment (starting state)

Assessed 2026-10-23.

## Repository

- The working folder `Documents/LPU/` contained only `iitk-main/`, a copy of
  the MIT-licensed IIT Kanpur campus map (`github.com/ni5arga/iitk`). It is
  used as an **engineering reference only** (static data pipeline, unified
  search, graph routing, provenance, smoke checks). No IIT Kanpur data,
  branding, coordinates or code paths are reused.
- No existing LPU code, dataset, tests, CI or deployment config. The project
  was initialised from scratch in `lpu-campus-atlas/` (new git repository).

## Toolchain found

| Tool                | Version                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Node.js             | 24.19.0 (native TypeScript type-stripping used for `scripts/*.ts`) |
| npm                 | 11.17.0                                                            |
| git                 | 2.55.0                                                             |
| Playwright Chromium | installed (chromium-1248)                                          |
| OS                  | Windows 11 (CI targets ubuntu-latest)                              |

## Data-source reachability (tested from this machine)

| Source                                                 | Result                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `overpass-api.de`, `overpass.kumi.systems`             | **Unreachable** (connection failed). The fetcher tries Overpass first, then falls back to the OSM API.                                                                         |
| `api.openstreetmap.org/api/0.6/map` (bbox)             | Reachable. Snapshot saved to `data/raw/osm/campus-bbox.osm` (2.4 MB).                                                                                                          |
| OSM relation 21599790 "Lovely Professional University" | Reachable. Multipolygon campus boundary, 2 outer ways, 123 nodes; extent lat 31.24575–31.26079, lon 75.69735–75.70913. Saved to `data/raw/osm/boundary-relation-21599790.osm`. |
| `www.lpu.in`                                           | Reachable (HTTP 200). Investigated for public directory data; see `docs/DATA_SOURCES.md`.                                                                                      |

## What OpenStreetMap actually contains for LPU (snapshot profile)

- A real campus boundary polygon (relation 21599790, created 2026-10-09).
- ~532 `building=yes` footprints in the bbox, **139 with `building:levels`**,
  essentially **no `height` tags**.
- **Very few named on-campus buildings**: "Lovely Institute of Management",
  "Lovely Institute of Technology", "Lovely Institute of Pharmacy", "School
  of Design", "LPU Ground". The common "Block 34"-style names used on campus
  are **not in OSM**, so they cannot be shown on the map without a survey or
  an authoritative, position-bearing source.
- Roads (`residential`, `unclassified`, `service`, `tertiary`), 61 footways,
  15 crossings, 3 pedestrian ways. No mapped steps, no wheelchair tags on paths.
- Most named POIs (restaurants, PGs, apartments, banks, shops) are in the
  **off-campus Law Gate area** east/north of the boundary. They are included
  as `off-campus-nearby` and labelled as such.
- No opening hours on almost all POIs; no mapped drinking water, toilets,
  ATMs, printing or healthcare points on campus.

## Blockers and consequences

1. **Sparse on-campus naming** → most buildings render as truthfully
   labelled "Unnamed building"; search coverage of block numbers depends on
   future curated, sourced aliases (`data/curated/aliases.json`).
2. **No step/wheelchair data** → step-free routing can exclude only what is
   mapped as a barrier and always shows an "accessibility unverified" caveat.
3. **No public mess-menu, transport-schedule or live-status source found** →
   those modules ship as honest empty/unavailable states.
4. **Overpass unreachable here** → refreshes use the OSM API fallback;
   documented in `data/README.md`.
5. No physical survey has been possible; every OSM-derived record is
   `verificationStatus: "imported"`, never "verified".
