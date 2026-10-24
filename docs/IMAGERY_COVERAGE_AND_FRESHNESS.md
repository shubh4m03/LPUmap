# Imagery coverage and freshness at LPU

**Status:** research record. **Nothing here is implemented.** **Date:** 2026-10-24.
**Companion documents:** [`GOOGLE_EARTH_STYLE_MAP_ASSESSMENT.md`](GOOGLE_EARTH_STYLE_MAP_ASSESSMENT.md) and
[`MAP_PROVIDER_CONFIGURATION.md`](MAP_PROVIDER_CONFIGURATION.md).

This document records what is known and unknown about imagery, terrain and 3D coverage over the Lovely Professional
University campus for each candidate source, what date metadata each source exposes, how to verify the unknowns
once a Google key exists, and the wording rules the UI must follow.

Labels: **[DOC]** an official source says it (quoted, with URL; all retrieved 2026-10-24). **[MEASURED]** a command
we ran. **[INFERRED]** our reasoning. **[UNVERIFIED]** cannot be checked yet; the procedure is given.

No Google API was called, no key was used (including the key embedded in Google's own coverage-map page), and no
imagery or tiles were downloaded from any provider. The Esri measurement used Esri's public **metadata** service,
which returns capture metadata polygons, not imagery.

---

## 1. Reference location

[MEASURED] from `public/data/boundary.geojson` (OSM relation 21599790): bounding box lon 75.6973474–75.7091258, lat
31.2457534–31.2607949. Point used for every query: **lon 75.7032, lat 31.2533**. The app's camera bounds are
`[75.685, 31.236, 75.722, 31.27]` (`src/config/index.ts:31`).

## 2. Coverage categories

| Category                | Meaning in this document                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Photoreal 3D**        | A textured photogrammetry mesh with vertical facades and trees (what Google calls "3D surface data").                         |
| **Terrain-only 3D**     | Imagery draped on an elevation surface. Hills are visible; buildings are flat pictures on the ground.                         |
| **Satellite 2D**        | Top-down imagery tiles.                                                                                                       |
| **Insufficient detail** | Imagery exists but is too coarse to recognise individual campus buildings (in this document: worse than about 2 m per pixel). |
| **Unknown**             | Not determinable without a key, an account or a vendor answer.                                                                |

## 3. What is known per source

### 3.1 Google Map Tiles API

| Product                               | Status at LPU                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2D satellite                          | **Satellite 2D: listed for India.** Max zoom over campus **unknown**. | [DOC] https://developers.google.com/maps/coverage (last updated 2026-10-21): India's "Map Tiles 2D / 3D" cell is `⬤`. [DOC] "most cities have imagery at zoom level 22, but not the ocean" (https://developers.google.com/maps/documentation/tile/2d-tiles-overview). LPU max zoom [UNVERIFIED]: read `maxZoomRects` (§4.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Photorealistic 3D                     | **Expected terrain-only 3D; photoreal 3D unknown and unlikely.**      | [DOC + MEASURED parse of the same table] India's cell is a single `⬤`; 55 countries show `⬤ / ⬤`; none of India, Pakistan, Bangladesh, Nepal or Sri Lanka does. India's "Maps JavaScript 3D" cell is `—` ("The feature is not available in the area, or with low data quality or availability"). [DOC] "3D terrain data is available worldwide. 3D surface data is limited to the areas highlighted in blue on the map below … Coverage data is updated daily at 11:00 UTC" (https://developers.google.com/maps/documentation/javascript/3d/coverage). The table's legend defines `⬤` as "available in the area, with good data quality and availability" but does not define a single dot in a "2D / 3D" column, so "2D only" is [INFERRED]. [MEASURED] A fresh fetch of the coverage page on 2026-10-24 (adversarial re-check) gave the same India row and the same 55 `⬤ / ⬤` countries. That the Maps JS 3D coverage map reflects the same mesh as Map Tiles 3D is [INFERRED]. No city-level list exists in the docs. |
| Marketing claim                       | —                                                                     | [DOC] "Access photorealistic 3D Tiles in over 49 countries, and 2D Tiles in 250+ countries and territories" (https://mapsplatform.google.com/maps-products/map-tiles/). The developer table lists 55 countries with 3D; the two numbers are not reconciled by Google.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Any "no coverage" signal from the API | **None documented for 3D.** 2D has only a zoom-range error.           | [DOC] For 3D tiles the listed errors are 400, 403 and 429 (https://developers.google.com/maps/documentation/tile/error_handling). For 2D tiles the same page lists `notFound, invalid` ("Your x, y, or z values are out of range … the maximum zoom level depends on the particular map tile"); this signals maximum zoom, not whether 3D surface data exists. [INFERRED] Outside photogrammetry coverage the 3D tileset still loads with whatever global mesh exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 3.2 Other imagery sources

| Source                       | Status at LPU                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Esri World Imagery           | **Satellite 2D, 0.31 m, captured 2023-12-18** (WorldView-3, "Vivid Advanced", Vantor) | [MEASURED] query of `World_Imagery_Metadata_2026_r09` at the reference point: `SRC_DATE 20231218`, `SRC_RES 0.31`, `SAMP_RES 0.3`, `SRC_DESC WV03`, `MaxMapLevel 19`. Shown since Wayback release 2024-08-15 and still current in the 2026-09-24 release. Re-run on 2026-10-24 (adversarial re-check): the centroid and points just inside the four corners of the boundary bbox (75.6975/75.7090 E, 31.2460/31.2605 N) return the same `SRC_DATE 20231218`, `SRC_RES 0.31`, `WV03` capture. |
| Esri history at the centroid | Older captures 2010-02-19 (0.5 m) through 2023-02-24 (0.5 m)                          | [MEASURED] across 197 Wayback releases (21 pre-2018 queries timed out). Using Wayback releases in a public app is a Living Atlas question [UNVERIFIED]: Esri's summary says "YOU MAY NOT … Use content from ArcGIS Living Atlas for commercial use" without contacting Esri.                                                                                                                                                                                                                 |
| MapTiler Satellite           | Satellite 2D, about 1 m/px per the vendor; LPU **unverified**                         | [DOC] "1 m/px across most other densely populated regions (e.g., India" and "satellite imagery dates from 2021–2022" (https://docs.maptiler.com/schema-raster/satellite/).                                                                                                                                                                                                                                                                                                                   |
| Mapbox Satellite             | Satellite 2D, global to z16 at 1–2 m; LPU **unverified**                              | [DOC] "global coverage to zoom 16 (1–2 m resolution), regional coverage to zoom 18 (0.6–0.3 m resolution)" (https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/).                                                                                                                                                                                                                                                                                                              |
| Azure Maps imagery           | **Unknown**                                                                           | Not researched beyond the free-transaction wording.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| EOX Sentinel-2 cloudless     | **Insufficient detail** (10 m)                                                        | [DOC] "Resolution 10 m" (https://cloudless.eox.at/documentation/product-list). Each layer is one vintage year (2016 … 2025).                                                                                                                                                                                                                                                                                                                                                                 |
| NASA GIBS                    | **Insufficient detail** (about 32.7 m/px at z12, the deepest true-colour level)       | [MEASURED] parse of https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml.                                                                                                                                                                                                                                                                                                                                                                                           |
| Planetary Computer NAIP      | **Not available** (USA only)                                                          | [MEASURED] `naip` bbox `[-124.784, 24.744, -66.951, 49.346]`.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ISRO Bhuvan                  | **Not usable** (terms)                                                                | [DOC] "Image data and map data, and related content are provided for viewing purposes only" (https://bhuvan.nrsc.gov.in/home/terms.php).                                                                                                                                                                                                                                                                                                                                                     |
| Bing Maps                    | **Not available** to new users                                                        | [DOC] Basic keys stopped 2025-06-30 (blogs.bing.com).                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 3.3 Terrain and building height sources

| Source                        | Status at LPU                                                                                       | Evidence                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copernicus DEM GLO-30         | 30 m **surface** model (includes buildings and trees); the LPU tile is public                       | [DOC] "a Digital Surface Model (DSM) which represents the surface of the Earth including buildings, infrastructure and vegetation" (https://registry.opendata.aws/copernicus-dem/). [MEASURED] `HEAD` on `Copernicus_DSM_COG_10_N31_00_E075_00_DEM.tif` returned 200. |
| AWS Terrain Tiles (terrarium) | Available to z15 (z16 returns 404); source SRTM 30 m                                                | [MEASURED] `terrarium/15/23274/13392.png` 200, `terrarium/16/46549/26784.png` 404. [DOC] tilezen/joerd data-sources.md.                                                                                                                                               |
| Relief inside campus          | **Unknown** (probably small; the campus is on the Punjab plain)                                     | [INFERRED]. To measure: decode the GLO-30 tile with GDAL in a scratch directory and compute min/max inside the boundary.                                                                                                                                              |
| Our building heights          | **Estimates, not measurements**: 122 of 131 are floors × 3.2 m, 9 are a 6 m placeholder, 0 measured | [MEASURED] tally over `public/data/buildings.geojson`; `scripts/lib/height.ts:55-96`.                                                                                                                                                                                 |
| Our building outlines         | OpenStreetMap snapshot retrieved 2026-10-23T09:39:00Z (ODbL)                                        | `public/data/manifest.json` `sources[0]`.                                                                                                                                                                                                                             |

### 3.4 Date metadata each source exposes

| Source                           | What is exposed                                                                                      | Can the UI show a capture date?                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google 2D satellite              | [DOC] `viewport` returns only `copyright` (an attribution string) and `maxZoomRects`                 | **No.** A year inside a copyright notice (e.g. the docs' example "Map data ©2023") is not a capture date.                                          |
| Google Photorealistic 3D         | [DOC] glTF `asset.copyright` only, e.g. "Data SIO, NOAA, U.S. Navy, NGA, GEBCO;Landsat / Copernicus" | **No.**                                                                                                                                            |
| Google Street View (not planned) | [DOC] metadata has `"date": "2023-01"`                                                               | Not relevant: Street View is not in scope.                                                                                                         |
| HTTP headers from Google         | `Last-Modified` may exist [UNVERIFIED]; it is a server timestamp, undocumented                       | **No.** Do not use it.                                                                                                                             |
| Esri World Imagery               | [MEASURED] metadata service gives `SRC_DATE`, `SRC_RES`, sensor per area                             | Yes, if Esri is adopted and the metadata service may be queried from the app [UNVERIFIED terms]; otherwise show it from a dated build-time record. |
| MapTiler / Mapbox                | [DOC] general ranges only ("2021–2022", "1–2 m")                                                     | No per-area date found.                                                                                                                            |
| EOX cloudless                    | Vintage year per layer                                                                               | Yes ("Sentinel-2 mosaic, 2016").                                                                                                                   |
| Our OSM data                     | Retrieval timestamp in `manifest.json`                                                               | Yes ("Building shapes from OpenStreetMap, retrieved 23 Oct 2026").                                                                                 |

---

## 4. Verification procedure once a key exists

Run these in a **staging** Google Cloud project with the key restricted as described in
`MAP_PROVIDER_CONFIGURATION.md`, a low daily quota and budget alerts on. Rules for every step:

- Look only. **Do not save tiles, meshes, screenshots-as-data or responses to disk**, and do not write them to any
  cache ([DOC] policies: "you must not pre-fetch, index, store, or cache any Content").
- Do not run code that analyses imagery or mesh geometry ([DOC] policies ban "Image analysis; Machine
  interpretation; Object detection or identification; Geodata extraction").
- Record only a **decision record**: yes/no, the value read, the date, the person.

### 4.1 Human coverage check (no key needed)

1. Open https://developers.google.com/maps/documentation/javascript/3d/coverage in a normal browser.
2. Search the map for "Lovely Professional University" or "Phagwara".
3. Note whether the campus is inside a blue (3D surface) area. A screenshot of a docs page may be attached to the
   decision record as evidence; it is never used as map data.

### 4.2 2D satellite: max zoom and attribution (unbilled calls)

[DOC] "Session Token and Viewport information requests aren't billed"
(https://developers.google.com/maps/billing-and-pricing/sku-details).

```sh
# 1. Session (satellite, India). Replace KEY. Referer must match the key's Website restriction.
curl -s -X POST -H 'Content-Type: application/json' -H 'Referer: https://<allowed-host>/' \
  -d '{"mapType":"satellite","language":"en-IN","region":"IN"}' \
  "https://tile.googleapis.com/v1/createSession?key=KEY"
# 2. Viewport over the campus bbox at zoom 19 (path as documented: /tile/v1/viewport).
curl -s -H 'Referer: https://<allowed-host>/' \
  "https://tile.googleapis.com/tile/v1/viewport?session=SESSION&key=KEY&zoom=19&north=31.2608&south=31.2457&east=75.7092&west=75.6973"
```

Record: the `copyright` string and the `maxZoomRects` value covering the campus. Then open the app's staging build
in Satellite 2D and inspect visually at the maximum zoom. Write nothing else down.

### 4.3 Photorealistic 3D coverage (one root request)

1. In a local page using a Google-named renderer (deck.gl ≥ 8.9.13 or CesiumJS ≥ 1.91), load
   `https://tile.googleapis.com/v1/3dtiles/root.json` with the key, credits shown on screen, and no other imagery or
   globe (Cesium: `imageryProvider: false`, `globe.show = false`, no ion token).
2. Point the camera at lon 75.7032, lat 31.2533, about 600 m above ground, pitch about −35°.
3. Classify by eye: **vertical facades and trees** → photoreal 3D; **a smooth draped image with no walls** →
   terrain-only.
4. Read the on-screen credits. [INFERRED, not documented] Only global credits such as "Landsat / Copernicus" at the
   closest zoom suggest terrain-only.
5. Optionally compare with a known-covered city (e.g. Tokyo) in the same session.
6. Write the decision record: `photoreal3dCoverage = 'photogrammetry' | 'terrain-only'`, date checked, renderer and
   version. Repeat when the owner asks or every few months ("Google regularly updates and adds imagery" [DOC]
   https://developers.google.com/maps/documentation/tile/3d-tiles-overview).

### 4.4 Related checks done in the same session

- Billing unit for 3D (one root request, count child tiles, read the Billing report after 24–48 h):
  `GOOGLE_EARTH_STYLE_MAP_ASSESSMENT.md` §3.3.
- 403 "not been added to the allowlist for 3D Tiles": if seen, contact Google Support with the project id [DOC].
- Referrer enforcement and quota defaults: `MAP_PROVIDER_CONFIGURATION.md` §9.

### 4.5 Decision record template

```text
Check:            Photorealistic 3D coverage at LPU (31.2533 N, 75.7032 E)
Date / by:        YYYY-MM-DD / name
Method:           §4.3, renderer + version
Result:           photogrammetry | terrain-only
Credits seen:     <text as displayed>
Notes:            nothing stored; root requests used: N
```

---

## 5. UI wording rules

These apply to every mode label, tooltip, attribution line, legend, announcement, README and store listing.

1. **Never call imagery or buildings "live", "real-time", "current" or "up to date".** "Live" may describe only the
   user's own GPS position and live navigation, which the app already names that way.
2. **Never state or imply a capture date for Google imagery.** Google does not provide one. Use: "Imagery © Google
   Maps. Google does not publish the capture date for this area."
3. **Never claim that buildings in the imagery or 3D view match today's campus.** Use: "Imagery may be several years
   old. Buildings shown may have changed."
4. **Say which parts come from Google and which from the atlas** ([DOC] policies: "you must clearly state … which
   part of the scene originates from Google Maps data"). Example attribution, two separate blocks:
   - Google block: Google Maps logo + the `copyright` string (2D) or the sorted credit line (3D).
   - Campus block: "Campus buildings, places and paths © OpenStreetMap contributors (ODbL)".
5. **Describe terrain-only honestly.** If the decision record says terrain-only, the 3D Earth view says: "Google has
   no detailed 3D model for this area. You are seeing satellite imagery on terrain; the 3D buildings are the atlas's
   own models." Never market it as "photorealistic campus".
6. **Building heights are estimates.** Keep the existing provenance language: heights from floor counts or a
   placeholder, never "measured" unless a measured source exists.
7. **Name sources with dates where they are known**: "Esri World Imagery, captured 18 Dec 2023" (only if Esri is
   adopted); "Sentinel-2 mosaic, 2016"; "OpenStreetMap, retrieved 23 Oct 2026".
8. **Do not use the words "Google Earth"** for any mode. Use "Satellite" and "3D Earth view". The app does not use
   Google Earth.
9. **Offline and unavailable states say why**: "Satellite and 3D Earth views need a connection. Showing the campus
   map." / "3D Earth view is not configured."
10. **Mismatch reports never point to Google imagery as evidence.** If a building in the imagery disagrees with the
    atlas, the correction flow asks for a survey or a permitted source; Building Studio already rejects Google Maps,
    Earth and Street View URLs as provenance (`docs/BUILDING_STUDIO_DESIGN.md` §5).

## 6. Open items

| Item                                           | How to close it                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Photoreal 3D coverage at LPU                   | §4.1, then §4.3                                                                             |
| Google 2D max zoom over campus                 | §4.2                                                                                        |
| Esri capture footprint over the whole campus   | Closed 2026-10-24: centroid and 4 near-corner points all report the 2023-12-18 WV03 capture |
| Esri metadata use from inside the app          | Ask Esri or read the Location Platform terms                                                |
| MapTiler and Mapbox resolution and date at LPU | Inspect in the vendors' own viewers with free keys                                          |
| Terrain relief inside campus                   | Decode GLO-30 locally with GDAL                                                             |

## Sources

All retrieved 2026-10-24.

- https://developers.google.com/maps/coverage (last updated 2026-10-21)
- https://developers.google.com/maps/documentation/javascript/3d/coverage
- https://developers.google.com/maps/documentation/tile/2d-tiles-overview
- https://developers.google.com/maps/documentation/tile/3d-tiles
- https://developers.google.com/maps/documentation/tile/3d-tiles-overview
- https://developers.google.com/maps/documentation/tile/policies
- https://developers.google.com/maps/documentation/tile/error_handling
- https://developers.google.com/maps/billing-and-pricing/sku-details
- https://mapsplatform.google.com/maps-products/map-tiles/
- Esri World Imagery Wayback config and metadata:
  https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json and
  https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_2026_r09/MapServer/4/query
- https://docs.maptiler.com/schema-raster/satellite/
- https://docs.mapbox.com/data/tilesets/reference/mapbox-satellite/
- https://cloudless.eox.at/documentation/product-list
- https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml
- https://planetarycomputer.microsoft.com/api/stac/v1/collections
- https://bhuvan.nrsc.gov.in/home/terms.php
- https://registry.opendata.aws/copernicus-dem/ and https://registry.opendata.aws/terrain-tiles/
