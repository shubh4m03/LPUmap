# Geodata sources and licences

Research date: **2026-10-24**. Every web request was a plain HTTPS GET with the
neutral User-Agent `LPU-Campus-Atlas-research/0.1`, sent one at a time. No
account, API key, cookie or personal identifier was used. robots.txt was checked
where a site was fetched beyond a single legal page (openstreetmap.org, Sketchfab,
3D Warehouse, Behance, lpu.in; Bhuvan returned 404 for robots.txt). Raw copies of
every fetched page are in the session scratchpad (`.../scratchpad/geo/web/`) and
are **not** part of the repo.

This document covers licensing and provenance only. It changes no code or data.
Related docs: [DATA_SOURCES.md](DATA_SOURCES.md) (what the pipeline ingests
today) and [research/LPU_PUBLIC_SOURCES.md](research/LPU_PUBLIC_SOURCES.md)
(lpu.in pages).

> **Correction to an earlier assumption.** Microsoft Global ML Building
> Footprints is **no longer ODbL**. Since commit `ef94ee3` of 2026-03-11 the
> GitHub repo says "CDLA Permissive 2.0" ([details below](#2-microsoft-global-ml-building-footprints)).
> Overture's attribution page still lists it as ODbL, so Overture's copy may
> predate the change.

## Summary

| #   | Source                                      | Licence (version)                                                       | Can we put it in `public/data`?                                                        | Decision                                                                  |
| --- | ------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | OpenStreetMap                               | ODbL 1.0                                                                | **Yes**. This is what we ship today                                                    | Keep as the only geometry and name source                                 |
| 2   | Microsoft Global ML Building Footprints     | CDLA Permissive 2.0 (was ODbL before 2026-03-11)                        | Conditional: licence-compatible, but no names, heights or confidence here              | Use only as a **survey lead layer**. Do not import automatically          |
| 3   | Google Open Buildings v3                    | CC BY 4.0 **or** ODbL 1.0 (user's choice)                               | Conditional: licence-compatible, with confidence scores                                | Use only as a **survey lead layer**. Better than MS here                  |
| 4   | Overture Maps buildings                     | ODbL 1.0 (whole theme)                                                  | Conditional                                                                            | Not needed: for this site it repackages 1 to 3                            |
| 5   | Esri World Imagery                          | Esri Master License Agreement and OSM-specific permission               | **No** (imagery). Tracing is allowed **into OSM**                                      | Trace in iD/JOSM into OSM only                                            |
| 6   | Bing aerial imagery                         | Bing Maps T&C, OSM clause in §2                                         | **No**. Tracing only inside an OSM online editor                                       | Trace in iD/JOSM into OSM only                                            |
| 7   | Google Maps / Earth / Maps Platform         | Google terms                                                            | **No**. Tracing and 45° modelling are expressly prohibited                             | Never use for geometry, names or heights                                  |
| 8   | Bhuvan (ISRO/NRSC)                          | Not retrievable (JS-only portal)                                        | Unknown, so treat as **No**                                                            | Do not use until terms are read                                           |
| 9   | Copernicus Sentinel-2                       | Copernicus free, full and open data policy                              | Yes, but **10 m** pixels                                                               | Too coarse for footprints. Context only                                   |
| 10  | Wikimedia Commons photos                    | Per file (CC BY 2.0, CC BY-SA 3.0/4.0, GODL-India)                      | Façade reference only. Redistributing a photo needs per-file attribution               | Use 2 files as façade references. Treat the rest with caution             |
| 11  | Mapillary                                   | CC BY-SA 4.0 (images). Special permission for OSM derivation            | Coverage could not be checked without a token                                          | Use only inside iD/JOSM for OSM mapping                                   |
| 12  | Sketchfab / 3D Warehouse                    | Per model                                                               | No campus models on Sketchfab. 1 legacy model on 3D Warehouse                          | Do not download. Do not use                                               |
| 13  | lpu.in (official site)                      | © LPU, personal non-commercial use only                                 | **No** (content). Short factual identifiers only, as today                             | Unchanged from LPU_PUBLIC_SOURCES.md                                      |
| 14  | "LPU isometric map design" (owner-supplied) | Owner statement 2026-10-24: "I own or am authorized to use the artwork" | **No** (it is an illustration, not data). Shipped unchanged in `public/isometric-art/` | Shown as the Illustrated overview; never geometry, names or block numbers |
| 17a | Esri World Imagery (runtime basemap)        | Esri Master Agreement; ArcGIS Location Platform free tier               | **No** (tiles are streamed, never stored)                                              | Optional imagery behind `VITE_ARCGIS_API_KEY` (§17)                       |
| 17b | EOX Sentinel-2 cloudless 2016               | CC BY 4.0 (2016 vintage only)                                           | **No** (tiles are streamed, never stored)                                              | Optional 10 m backdrop behind `VITE_EOX_BACKDROP=true` (§17)              |
| 17c | Copernicus DEM GLO-30                       | License-COPDEM-30                                                       | Not needed                                                                             | Measured once; no terrain added (§17)                                     |
| —   | Google Map Tiles (2D and Photoreal 3D)      | Google Maps Platform terms; needs a billing account                     | **No**                                                                                 | **Not used** (no-billing decision, §17); never a data source (§7)         |

## Measurements behind this document (re-verified)

All counts below were computed during this session from the files named. The
scripts are in the session scratchpad: `geo/count.mjs` (the lead's script, re-run
unchanged), `geo/gobcount.mjs`, `geo/gobcover.mjs`, `geo/gob90.mjs` and
`geo/s2token.mjs`.

Common method: a footprint is **in the boundary** when its centroid falls inside
the OSM campus multipolygon (`public/data/boundary.geojson`, relation 21599790).
The centroid is the vertex average for polygons and the published centroid for
Google points. The test is ray casting with holes respected.

| Measurement                                                           | Value                                                                                                                      | How                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildings.geojson` footprints                                        | **535**                                                                                                                    | `features.length`                                                                                                                                                                                               |
| … `campusZone: on-campus` / `off-campus-nearby`                       | **137 / 398**                                                                                                              | Tag counts. The same 137 come out of the centroid test in `count.mjs`. Source: `scripts/lib/build-buildings.ts:89` sets the tag from `ctx.insideCampus`                                                         |
| Fresh OSM API download vs `data/raw/osm/campus-bbox.osm`              | **Identical**                                                                                                              | Same `<way>` count (946), `building` tag count (685) and node count (7,150). A `diff` of the two files after removing the header lines returns 0 lines. Both have latest element timestamp 2026-10-21T11:58:45Z |
| MS tile 123121013 features                                            | **667,588**                                                                                                                | `zcat \| wc -l`, same for the 2026-02-03 file and the 2026-08-13 file                                                                                                                                           |
| MS footprints in boundary                                             | **169**                                                                                                                    | `count.mjs`                                                                                                                                                                                                     |
| … matching an OSM in-boundary footprint                               | **70**                                                                                                                     | Matched means the MS centroid is in the OSM polygon, or the OSM centroid is in the MS polygon                                                                                                                   |
| … not matching any OSM footprint                                      | **99**. Area quantiles (min/p25/median/p75/max) 12 / 45 / 83 / 213 / 2,284 m². 38 are ≥ 100 m² and 10 are ≥ 500 m²         | `count.mjs` and `ms2026-08/unmatched.json`                                                                                                                                                                      |
| MS confidence and height in the tile                                  | **−1 for all 667,588** (no score, no height)                                                                               | `grep -c '"confidence": -1'`                                                                                                                                                                                    |
| Google v3 points in tile 391b                                         | 6,844,414 rows                                                                                                             | Row count                                                                                                                                                                                                       |
| Google buildings in boundary                                          | **371** (total area 128,877 m²)                                                                                            | `gob90.mjs`                                                                                                                                                                                                     |
| … at or above the 90 %-precision threshold for S2 cell 391 (≥ 0.875)  | **93**                                                                                                                     | Threshold from `score_thresholds_s2_level_4.csv`, row `391`: 0.801 / 0.839 / 0.875 for 80 / 85 / 90 % precision                                                                                                 |
| … centroid inside an OSM footprint / an MS footprint / both / neither | **138 / 220 / 104 / 117**                                                                                                  | `gobcount.mjs`                                                                                                                                                                                                  |
| … "neither" (new vs OSM and MS): area quantiles                       | 11 / 22 / 33 / 122 / 1,911 m². 33 have confidence ≥ 0.75 and area ≥ 50 m². **11** have confidence ≥ 0.875 and area ≥ 50 m² | `gob/gob-unmatched.json`                                                                                                                                                                                        |
| OSM in-boundary footprints containing ≥ 1 Google point                | **61 of 137**                                                                                                              | `gobcover.mjs`                                                                                                                                                                                                  |
| MS in-boundary footprints containing ≥ 1 Google point                 | **111 of 169**. Of the 99 MS-only ones: **60**                                                                             | `gobcover.mjs`                                                                                                                                                                                                  |

Reading these numbers:

- Google returns more detections (371) than MS (169) inside the same boundary.
  It splits large blocks into several polygons: 138 Google points fall in only
  61 OSM buildings.
- 60 of the 99 MS-only footprints are confirmed by an independent Google
  detection. These are the strongest "probably a real building missing from OSM"
  leads.
- Only 61 of the 137 OSM buildings contain a Google centroid. Either recall is
  incomplete, or large OSM outlines contain Google centroids only for some
  sub-parts. Do not read this as an error in OSM.
- None of these sources provides a **name, block number, use or height** for any
  building. They can only say "something roofed is probably here, as of the
  imagery date".

---

## 1. OpenStreetMap

| Field         | Value                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL           | https://www.openstreetmap.org/copyright. Data: `https://api.openstreetmap.org/api/0.6/map?bbox=75.695,31.243,75.715,31.262` and relation 21599790 (`data/raw/osm/SOURCE.json`)                                                      |
| Licence       | **Open Database License 1.0**. The API response itself declares `license="http://opendatacommons.org/licenses/odbl/1-0/"` (header of `campus-bbox.osm` and `fresh.osm`)                                                             |
| Attribution   | "© OpenStreetMap contributors", linked to https://www.openstreetmap.org/copyright. Already shown: `src/map/style.ts:17` and `src/components/about/about-model.ts:6`. Data credit also in `public/data/manifest.json` → `sources[0]` |
| Retrieved     | Snapshot 2026-10-23T09:39Z. Fresh re-download (identical) on 2026-10-23/24                                                                                                                                                          |
| Coverage      | Campus boundary plus a rectangle around it. 685 `building` ways in the bbox file, 535 kept in `buildings.geojson`                                                                                                                   |
| Permitted use | **Yes**, under ODbL                                                                                                                                                                                                                 |

**What our dataset is under ODbL.** The OSMF Licence FAQ
(https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ, fetched 2026-10-24)
defines the following terms:

- **Derivative Database**: created "where you adapt, modify, enhance, correct or
  extend our data". `public/data/*.json|geojson` qualifies. The pipeline
  filters, re-projects, derives heights and categories, adds `campusZone`, builds
  the routing graph and joins curated records. Because the files are served to
  every browser, that is **Public Use**. Obligations:
  1. Keep ODbL attribution on the data files. The `manifest.json` `sources[]`
     entry already carries licence and attribution.
  2. Offer the derivative database, or the method to recreate it, under ODbL.
     The public repo, with `scripts/build-data.ts` plus the raw snapshot, already
     does this. Keep a "Data licence: ODbL 1.0" statement next to `public/data`
     (README / DATA_SOURCES.md).
  3. Do not apply technical measures (DRM) to the data.
- **Produced Work**: the rendered map. It only needs the attribution notice,
  which the map already shows.
- **Collective Database**: OSM kept alongside _separate_ independent databases
  (for example `data/curated/organizations.json`, joined by id rather than
  altered geometry) is not itself a derivative. The safe assumption is still to
  publish everything in `public/data` under ODbL.

**Limitations.** OSM currently lacks hostels, the Agriculture block(s), canteens
and most "Block NN" names inside the boundary. This was confirmed by the identical
fresh download. Gaps must be fixed **in OSM**, not patched locally from
incompatible sources (see §5–§7).

**Decision.** OSM stays the single source of geometry, names and positions.

## 2. Microsoft Global ML Building Footprints

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                   | https://github.com/microsoft/GlobalMLBuildingFootprints (README and LICENSE fetched 2026-10-24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Licence                | **CDLA Permissive 2.0** (https://cdla.dev/permissive-2-0/). `LICENSE`: "Data in this repository has been licensed by Microsoft under CLDA Permissive 2.0." README: "This data is licensed by Microsoft under the CDLA Permissive 2.0." Changed by commit `ef94ee3dfb5d…` on **2026-03-11**: "Updating Readme and License file to relfect the change in license to CDLA Permissive 2.0 (#146)". Before that the repo licence was ODbL. **Overture's attribution page (fetched 2026-10-24) still says "Licensed by Microsoft under the Open Database License."**                                                                                                        |
| CDLA-P 2.0 obligations | §2.1: when sharing Data, "make available the text of this agreement with the shared Data". §3.1: no restrictions on **Results** (outcomes of computational analysis). No share-alike                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Attribution            | Not required by CDLA-P 2.0, but good practice: "Building footprints © Microsoft, Global ML Building Footprints, CDLA Permissive 2.0" plus a link to the repo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tile used              | Quadkey **123121013** (India). Current link (dataset-links.csv of 2026-08-13, https://bfppub.blob.core.windows.net/%24web/2026-08-13/dataset-links.csv): `https://bfppub.z5.web.core.windows.net/2026-08-13/global-buildings.geojsonl/RegionName=India/quadkey=123121013/part-00048-110f5303-ff85-4c71-a2bf-c6070024fec8.c000.csv.gz` (64.1 MB, uploaded 2026-08-13; local copy sha256 `841da1d3…564d`). The lead's earlier copy came from the 2026-02-03 link `https://minedbuildings.z5.web.core.windows.net/global-buildings/2026-02-03/…/quadkey=123121013/part-00048-4feead82-….c000.csv.gz` (63.1 MB; sha256 `608c60a7…3cea`). Both give the same campus counts |
| Format                 | GeoJSON-lines inside a `.csv.gz` (README FAQ). Properties `height`, `confidence`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Coverage, date         | Imagery "from Bing Maps including Maxar and Airbus between 2014 and 2021" (FAQ), extended to 2014–2024 in the header text. India got 110M edits on 2024-03-26 (README). **No per-feature imagery date.** South Asia evaluation: precision 94.8 %, recall 76.7 %, IoU 63.1 %, rotation error 6.25°, false-positive rate 1.4 %                                                                                                                                                                                                                                                                                                                                          |
| In this tile           | `confidence = -1` and `height = -1` for **all** 667,588 features, so there is no score and no height                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| How to cite            | Microsoft, _Global ML Building Footprints_, https://github.com/microsoft/GlobalMLBuildingFootprints, tile quadkey 123121013, dataset-links 2026-08-13, accessed 2026-10-24, CDLA Permissive 2.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Compatibility with OSM in one derived database.** CDLA-P 2.0 is permissive.
Its only sharing condition is to ship the licence text. Mixing MS geometry into
our ODbL derivative database is therefore licence-compatible, provided
`manifest.json` lists the source and ships the CDLA text. Two caveats:

- Contributing these shapes **to OSM** is a separate question, governed by the
  OSM import guidelines and community review, not only by the licence. The
  README itself says "Maybe. Never … blindly import".
- If anyone relies on the earlier ODbL grant, record the version and date
  actually downloaded.

**Decision.** Do not auto-merge into `buildings.geojson`. The footprints carry no
name, use, height or confidence, and 3D rendering of an unnamed, undated box
misleads users. Use the 99 MS-only footprints (60 corroborated by Google) as a
**review layer** that tells mappers where to look in iD/JOSM (§16).

## 3. Google Open Buildings v3

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL           | https://sites.research.google/gr/open-buildings/ (fetched 2026-10-24)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Licence       | Dual: "**Creative Commons Attribution (CC BY-4.0)** license and the **Open Data Commons Open Database License (ODbL) v1.0** license. As the user, you can pick which of the two licenses you prefer." The "Why two licenses?" FAQ says this was done to make the data ODbL-compatible for the OSM community                                                                                                                                                                                                            |
| Attribution   | For CC BY 4.0: "Google Open Buildings, CC BY 4.0" plus a link (Overture uses "Google Open Buildings. Available under CC BY 4.0."). Choose **ODbL** when merging into our ODbL derivative database                                                                                                                                                                                                                                                                                                                      |
| Version, date | v3, "inference carried out during May 2023", 58M km² of Africa, South and South-East Asia, Latin America and the Caribbean. Objects updated 2023-06-23 (GCS metadata)                                                                                                                                                                                                                                                                                                                                                  |
| India         | **Covered**: "IND India" is in the v3 country list                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tile          | S2 cell, level 6, token **`391b`**. Computed by `geo/s2token.mjs` (quadratic projection, Hilbert order). The script is validated because it reproduces the level-4 token `391` that the official tile index (`https://openbuildings-public-dot-gweb-research.uw.r.appspot.com/public/tiles.geojson`, 333 features) returns for (75.7032, 31.2533). All four corners of the campus bbox fall in `391b`                                                                                                                  |
| Downloads     | Polygons: `https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_6_gzip_no_header/391b_buildings.csv.gz`, **669,224,800 B (≈ 669 MB, over our 200 MB cap, not fetched)**. Points: `https://storage.googleapis.com/open-buildings-data/v3/points_s2_level_6_gzip_no_header/391b_buildings.csv.gz`, 173,746,469 B, **fetched** to `scratchpad/geo/gob/391b_points.csv.gz`. Level-4 tile `391` is 7,189 MB. Columns of the points file: latitude, longitude, area_in_meters, confidence, full_plus_code |
| Confidence    | 0.65–1.0. For cell 391 the score-threshold file gives 0.801 / 0.839 / 0.875 for 80 / 85 / 90 % precision. Google recommends filtering below the 90 % threshold before any OSM use                                                                                                                                                                                                                                                                                                                                      |
| Measured here | 371 in boundary, 93 at or above 0.875, 117 matching neither OSM nor MS (11 strong: ≥ 0.875 and ≥ 50 m²). 60 of the 99 MS-only footprints are corroborated. See the table above                                                                                                                                                                                                                                                                                                                                         |

**Does it add anything over MS?** Yes, in two ways. It has **per-building
confidence**, which MS lacks entirely here. It also gives independent
corroboration of MS-only detections. It does not add names or heights. Footprint
shapes would need the 669 MB polygon file. A future step could stream it through
a filter without storing it, but this phase did not.

**Decision.** Same as MS: a lead layer for mapping, not a direct import.

## 4. Overture Maps buildings

| Field                   | Value                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                     | https://docs.overturemaps.org/guides/buildings/ and https://docs.overturemaps.org/attribution/ (fetched 2026-10-24)                                                                                                                                                                                                                                         |
| Licence                 | Whole buildings theme **ODbL**: "Because it includes OpenStreetMap data, the buildings theme is published under the ODbL license"                                                                                                                                                                                                                           |
| Sources and attribution | "© OpenStreetMap contributors", Esri Community Maps (CC BY 4.0), "Global ML Building Footprints. Licensed by Microsoft under the Open Database License", "Google Open Buildings. Available under CC BY 4.0", USGS 3DEP, East Asia buildings (CC BY 4.0), IGN Spain BTN 2024. The page footer reads "© OpenStreetMap contributors, Overture Maps Foundation" |
| Known issues            | The docs say ML-derived buildings "have lower footprint precision … most pronounced in the Global South". ML sources need a footprint over 10 m²                                                                                                                                                                                                            |
| Access                  | GeoParquet in the cloud. Options listed at https://docs.overturemaps.org/getting-data/: the **Explorer** website ("Download visible data as GeoJSON", no install, no account), a Python client with `--bbox`, or DuckDB                                                                                                                                     |

**Practical without DuckDB/parquet?** Yes, for a single campus. The Explorer's
GeoJSON export of the visible area is enough. It was not exercised this session
because it is an interactive web app. For this site, though, Overture conflates
the three sources above, which we already hold first-hand, so it adds licence
complexity (attribution chains) without new information.

**Decision.** Not used. Revisit only if Overture adds a source with names or
heights for India.

## 5. Esri World Imagery

| Field          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL            | https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 (item JSON fetched 2026-10-24; item modified 2026-10-07)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Licence        | "This work is licensed under the **Esri Master License Agreement**." Credits: "Esri, Vantor, Earthstar Geographics, and the GIS User Community"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Item terms     | "This layer may be used **in various ArcGIS apps** to support data collection and editing, with the results used internally or shared with others." Export of tiles for offline use is not the purpose of this layer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| OSM permission | OSM wiki "Esri" (https://wiki.openstreetmap.org/wiki/Esri, fetched 2026-10-24) quotes Esri: "Esri and its imagery contributors grant Users the non-exclusive right to use the World Imagery map to trace features and validate edits in the creation of vector data… Users acknowledge that any vector data contributed to OSM is then governed by and released under the OpenStreetMap License." It also quotes a follow-up: the "updated document … grants the community permission to use our World Imagery to trace features and validate OSM edits **even when ArcGIS tools are not being used**." "Except for the additional limited rights granted above, any and all other uses … remain subject to the … Esri Master Agreement or Terms of Use" |

**Tracing into a non-OSM dataset (our own files)?** **Unclear, so treat it as no.**
The general grant speaks of creating vector data, but the non-ArcGIS permission
is worded for **OSM edits**. Our pipeline is not ArcGIS.

**Decision.** Permitted only as a background layer in iD/JOSM for edits uploaded
to OSM. Our pipeline then picks them up under ODbL.

## 6. Bing aerial imagery

| Field | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL   | https://wiki.openstreetmap.org/wiki/Bing_Maps (fetched 2026-10-24), quoting the Bing Maps T&C                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Terms | §2 as quoted: "The rights that you have under this agreement are limited solely to aerial imagery use in a **non-commercial online editor application of OpenStreetMap maps**." The wiki adds: "the only legal use of Bing maps is to use the aerial imagery layer as background to do your own OSM drawing… It is not legal to use any other information from Bing maps (like street names etc.)". StreetSide: "read-only … solely as an additional source of corroborating ground truth within OpenStreetMap editing environments" |

**Decision.** Use only inside iD/JOSM for OSM edits. Tracing into our own files
is **not permitted**. Note that MS footprints (§2) are machine-derived from Bing
imagery but released under their own open licence. That does not extend to
hand-tracing Bing imagery.

## 7. Google Maps, Google Earth and Google Maps Platform

| Field                                  | Value                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URLs                                   | Google Maps/Google Earth Additional Terms: https://maps.google.com/help/terms_maps/. Google Maps Platform Terms: https://cloud.google.com/maps-platform/terms. Both fetched 2026-10-24                                                                                                                                                               |
| Consumer terms §2 "Prohibited Conduct" | "you may not … copy the content …; mass download or create bulk feeds of the content …; **use Google Maps to create or augment any other mapping-related dataset (including a mapping or navigation dataset …)** for use in a service that is a substitute for, or a substantially similar service to, Google Maps"                                  |
| Platform terms §3.2.3                  | (a) **No Scraping**: "will not export, extract, or otherwise scrape Google Maps Content for use outside the Services". (c) **No Creating Content From Google Maps Content**: "(i) **trace or digitize** roadways, **building outlines** … from the Maps JavaScript API Satellite base map type; (ii) **create 3D building models from 45° Imagery**" |

**Decision.** **Prohibited.** Never trace, measure heights from, or copy names or
POIs from Google Maps, Earth or Street View for this project. That includes
"just checking the block number". (Google _Open Buildings_, §3, is a separate,
openly licensed dataset.)

## 8. Bhuvan (ISRO / NRSC)

| Field   | Value                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL     | https://bhuvan.nrsc.gov.in/ (HTTP 200, fetched 2026-10-24). `robots.txt` returned 404                                                                                                                      |
| Finding | The portal is a client-side Next.js app ("Bhuvan-Indian Geoportal of ISRO"). The static HTML contains **no terms, licence or disclaimer text**, so the terms could not be verified without running the app |

**Decision.** **Do not use** for tracing or data until someone reads and records
the current Bhuvan terms of use and data-download licence. _Lead (unverified):_
India's liberalised geospatial guidelines may make some layers usable. That needs
a citation before any use.

## 9. Copernicus Sentinel-2

| Field      | Value                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source     | Sentinel Data Legal Notice (sentinel.esa.int/documents/247904/690755/Sentinel_Data_Legal_Notice), as quoted on https://wiki.openstreetmap.org/wiki/Sentinel-2 (fetched 2026-10-24)                                                                                                                                                              |
| Terms      | "EU law grants free access to Copernicus Sentinel Data … (a) reproduction; (b) distribution; (c) communication to the public; (d) adaptation, modification and combination with other data". Attribution is required. The usual form is "Contains modified Copernicus Sentinel data [year]" (lead; confirm against the legal notice before use) |
| Resolution | "worldwide 10 m resolution colour imagery". The OSM wiki says: "Resolution only sufficient to trace major roads and landuse features."                                                                                                                                                                                                          |

**Decision.** Licence-compatible but **too coarse for footprints**. At most it
could serve as a dated "has something been built here since 2023?" check.

## 10. Wikimedia Commons

Searched 2026-10-24 through the MediaWiki API: full-text search of `"Lovely
Professional University"` in the File namespace (80 hits) plus
`Category:Lovely_Professional_University` (46 files, 1 subcategory). Licences come
from each file's `extmetadata.LicenseShortName`. **No file had GPS coordinates on
campus.** The only geotagged hit is an advertising sign near Mandi, Himachal
Pradesh.

Files that show campus **structures**:

| File                                                                                                  | Licence      | Author (as on Commons) | Date       | What the description says it shows                                                       | Use                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `File:Lovely Professional University (LPU), Jalandhar-Phagwara Highway, Jalandhar.jpg`                | CC BY 2.0    | Gopal Aggarwal         | 2010-05-21 | "The entrance gate, as seen from the other side of highway."                             | Façade reference for the main gate (16 years old). Attribution: "Gopal Aggarwal, CC BY 2.0, via Wikimedia Commons" |
| `File:Lovely Professional University, Jalandhar-Delhi G.T. Road (NH-1), Phagwara, Punjab (INDIA).jpg` | CC BY-SA 3.0 | Shalintripathi         | 2012-01-10 | "Sir Baldev Raj Mittal Park"                                                             | Landscape reference. Share-alike applies if the image itself is redistributed                                      |
| `File:Admission-block-copy.jpg`                                                                       | CC BY-SA 4.0 | Tanya2016              | 2016-02-05 | The title says "Admission block" but the description says "LPU campus: Open Air Theater" | **Conflicting.** Do not use to identify a building                                                                 |

The remaining hits are event photos: convocations, visits and cultural events.
Some are **GODL-India** files from the President's / Vice President's Secretariat
and the Ministry of Education (2013–2018), plus a series of CC BY-SA 4.0 uploads
by "Tanya2016" (2012–2016) that look like institutional press photos. _Caution
(unverified):_ own-work claims on institutional photos sometimes fail on review,
so do not rely on these. None identifies a block by number.

**Decision.** Commons can provide façade colour and material references for the
main gate, with attribution, and nothing more. Never use a photo's caption to
place or name a footprint.

## 11. Mapillary

| Field          | Value                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licence        | Images under **CC BY-SA 4.0**. "There is special permission to derive data from the photos for contributing to OpenStreetMap" (OSM wiki "Mapillary", fetched 2026-10-24). The Mapillary help-centre licence page returned **HTTP 403** to our client |
| Coverage check | `https://graph.mapillary.com/images?bbox=75.695,31.243,75.715,31.262` returned `"Invalid OAuth 2.0 Access Token"` (code 190). Coverage **cannot be checked without a token**, and we did not create an account                                       |

**Decision.** Use only as a ground-truth viewer inside iD/JOSM (the Mapillary
layer) while mapping into OSM. Reading block-number signs from street-level
photos into OSM is what the OSM permission covers. Copying them into our own
dataset would be a CC BY-SA derivation, so route it through OSM.

## 12. Sketchfab and 3D Warehouse

- **Sketchfab** (robots.txt allows `/`): the public search API
  `https://api.sketchfab.com/v3/search?type=models&q=lovely%20professional%20university`
  returned 2 irrelevant results (Yale Peabody insect scans). `q=LPU campus`
  returned 0. **No campus models.**
- **3D Warehouse** (robots.txt does not disallow the API path): search returned
  1 model, "Lovely institute of international studies / LIT Building (old)" by
  "Manu C.", created 2014-09-09, id `u597ac742-3723-4599-bb43-9aa240557db0`. Its
  description calls it the "Lovely institute of technology building". The
  entity JSON exposes no licence field. The model is old and its relation to a
  current campus building is unverified. **Not downloaded.**

**Decision.** Do not use either for geometry or heights.

## 13. Official LPU website

`https://www.lpu.in/terms-conditions.php`, re-fetched 2026-10-24: "All content on
the Site, including text, graphics, images, logos, and audio-visual materials, is
protected by copyright laws and is owned or licensed by LPU. Visitors are
permitted to access, view, and download content from the Site for personal,
non-commercial use only. Any unauthorized use, reproduction, or distribution of
the Site's content is strictly prohibited." This is unchanged from
[LPU_PUBLIC_SOURCES.md](research/LPU_PUBLIC_SOURCES.md). The 360° tour
(iviewd.com) has no reuse licence.

**Decision.** Unchanged. Store only short factual identifiers with citations. No
images, maps or tour content. Block statements such as "Central Library … Block-37"
remain text leads with no position.

## 14. "LPU isometric map design" (owner-supplied campus illustration)

> **Updated 2026-10-24.** Earlier versions of this section described the artwork as third-party artwork
> usable only as design inspiration. That no longer applies: the owner supplied the original files and
> stated that they own the artwork or are authorised to use it. The rules on what the artwork can prove
> (nothing about geography, names or official block numbers) are unchanged.

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner statement        | On **2026-10-24** the owner supplied 29 files in `lpu-isometric-map-design/` with the statement **"I own or am authorized to use the artwork"**. This project relies on that statement; it has not seen a licence document, and the statement does not say whether the owner is the author or a licensee. Any question about the rights goes to the owner.     |
| Files                  | 29 files, 28 unique images: the master overview `1-lpu-isometric-map-design-3371.jpg` (3371 × 2384, CMYK JPEG; XMP: Adobe Illustrator CS6, 2019-04-25) and 28 slide PNGs (20 block vignettes, 8 scene vignettes; `111-…` and `115-…` are byte-identical). sha256 per file: [LPU_ISOMETRIC_ASSET_INVENTORY.md](LPU_ISOMETRIC_ASSET_INVENTORY.md)                |
| Earlier public copy    | The same artwork is published on Behance (https://www.behance.net/gallery/105159145/LPU-isometric-map-design; the page returned HTTP 403 to our client, so its author, date and licence were not read from it). Each owner-supplied file is byte-identical to a slide file the earlier research saved under the git-ignored `reference/assets/behance-slides/` |
| Branding               | The artwork reproduces the LPU logo and tagline. They are shown only as part of the unchanged artwork, never extracted or reused as the app's own branding                                                                                                                                                                                                     |
| How it is used         | Shown **as drawn** in the Illustrated overview (`?view=iso`) and the admin Artwork screen. The 28 canonical originals are committed and published byte-identical in `public/isometric-art/original/`; 53 derived web copies of the master (lossless WebP, uniform scales, each recording the original's sha256) are in `public/isometric-art/derived/`         |
| Never                  | Modified, renamed, recoloured, cropped, stretched or replaced; used as geometry, as a source of names or official block numbers, or for routing; presented as geographically exact or as a 3D model                                                                                                                                                            |
| Local reference copies | `reference/assets/lpu-isometric-map-reference.png` and `reference/assets/behance-slides/` stay git-ignored. The first is a browser screenshot that also shows the owner's bookmarks bar and tabs: **never publish or commit it**. The owner-supplied files replace them                                                                                        |

Contract, pipeline and owner verification:
[LPU_ISOMETRIC_ASSET_INTEGRATION.md](LPU_ISOMETRIC_ASSET_INTEGRATION.md).

**Leads it contains. These are unverified, as printed in the index, and must
never name, number or position any footprint by themselves** (an owner decision
with evidence in `/admin/artwork` is the only way to link an illustration item to
a building):

- _Education:_ Fashion 1; Pharmacy 4, 7; Physiotherapy 3; Architecture 6; Animation 8; Fine Arts 8; Business 13; Hotel Management 15; Education 18; Performing Arts 19; Film & Journalism 20; Law 20; Agriculture 25, 26; Physical Science 27; Biotechnology 28; Computer Application 33; Computer Science 34; Electronic Telecom 36; Research 37; Civil 38; Mechanical 56; "Polytechinque" 57 (58 also printed beside it).
- _Administrative:_ Administrative 29 and 31; Prochancellor 30; Chancellor 31; Admission 32; Student Welfare 13; Shantidevi Auditorium 35; Baldev Raj Auditorium 2; Indoor 47; Project Lab 58.
- _Residential:_ Girls Hostel 9, 10, 11, 12, 21A, 21B; Apartment 41–44; Boys Hostel 45, 48, 49, 50, 51, 52, 53.

**Staleness evidence.** The illustration's index lists "Research 37" (its block
vignette says CENTRAL LIBRARY). lpu.in says the Central Library is in Block-37
(LPU_PUBLIC_SOURCES.md). The artwork dates from 2019, so parts of it may be out
of date, and its two printed sources disagree in places. That is exactly why its
printed labels are leads only, shown exactly as printed and never as official
names or numbers.

## 15. Decision on what goes into `public/data`

- **Only OSM** contributes geometry, names, levels and positions, as today.
- MS and Google may be shipped later **only** as a separate, clearly labelled
  "unverified detections" review layer, if the owner wants one. They would not
  render as 3D buildings. If shipped, add the following to `manifest.json`
  `sources[]`:
  - MS: CDLA Permissive 2.0, with the licence text shipped.
  - Google: licensed under ODbL. Attribution "Google Open Buildings".
- Nothing from Google Maps or Earth, Bing (outside OSM editing), Esri (outside
  OSM editing), lpu.in content, the 360° tour, Sketchfab or 3D Warehouse. The
  owner-supplied campus illustration (§14) is shipped separately in
  `public/isometric-art/` as an illustration, never as data in `public/data`.

## 16. Path to verified names and positions

1. **OSM mapping sprint** (preferred, licence-clean). Students map in iD or JOSM
   with **Esri World Imagery or Bing** as background, the **Mapillary** layer for
   signs, and on-site observation. They add `building=*`, `name=*`, `ref=<block
no.>`, `building:levels=*`, `amenity=*`. The lead layers (99 MS-only, of which
   60 are Google-corroborated, and 11 strong Google-only detections) can be
   loaded as a task list so mappers know where to look. They must not be
   uploaded as-is. Follow the OSM Organised Editing Guidelines (lead: an
   announcement on the OSM India community forum before a sprint) and use
   changeset `source=` tags. The pipeline then re-fetches OSM unchanged and
   everything stays ODbL.
2. **LPU Estates or Works office plans.** Ask for written permission to use
   official block numbers and footprints, ideally permission to contribute them
   to OSM. Without written permission, plans may be **looked at** to verify
   on-site observations but not copied.
3. **Owner survey through the admin editor** (`docs/ADMIN_OPERATIONS.md`). The
   owner walks the campus and records block number, name and entrance positions
   per OSM building id. Record this as first-hand observation with a date. If it
   stays in `data/curated/` it is our own data, which we may license as we
   choose. Better still, push the same facts to OSM so others benefit.

### What each missing category needs

| Missing category                                          | Today (verified)                                                                  | Leads available (unverified)                                                     | What is needed to verify                                              | Licence-clean route                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| Block numbers on academic buildings                       | Absent from OSM. Only "Block-37 = Central Library" text from lpu.in (no position) | Behance index (1–58), MS/Google detections                                       | Signboard observation on site, or written estates confirmation        | OSM `ref=*` via survey, or the admin editor            |
| Hostels (Girls 9–12, 21A/B; Boys 45–53; Apartments 41–44) | Not in OSM inside the boundary                                                    | Behance index. MS-only/Google footprints                                         | Site visit for names and entrances. Footprints from Esri/Bing tracing | OSM `building=dormitory` + `name` + `ref`              |
| Agriculture block(s)                                      | Not in OSM                                                                        | Behance "25, 26"                                                                 | Site visit or estates                                                 | OSM mapping                                            |
| Canteens / food courts                                    | Not in OSM                                                                        | None reliable                                                                    | Site visit (opening hours, location)                                  | OSM `amenity=food_court/cafe`                          |
| Auditoriums (Baldev Raj, Shantidevi), indoor stadium      | Not confirmed in OSM                                                              | Behance 2, 35, 47; Commons "Baldev Raj Mittal Park" photo (park, not auditorium) | Signboard and site visit                                              | OSM                                                    |
| Building heights / levels                                 | Derived in pipeline (`heightSource`); MS and Google give no heights here          | None                                                                             | Count floors on site (`building:levels`)                              | OSM `building:levels`                                  |
| Unmapped small structures (99 MS-only, 117 Google-only)   | Detected by ML, unnamed, undated                                                  | 60 corroborated by both. 11 strong Google-only                                   | Check against imagery in iD (could be sheds, kiosks, demolished)      | Trace in OSM if real                                   |
| Façade appearance                                         | None                                                                              | Commons main-gate photo (CC BY 2.0, 2010)                                        | Own photos                                                            | Own photos (owner licence) or Commons with attribution |
| Washrooms, water points, ATMs                             | Only OSM-mapped ones                                                              | None                                                                             | Site survey                                                           | OSM `amenity=toilets/drinking_water/atm`               |

## 17. Runtime basemaps and elevation (free sources only)

Added 2026-10-24 with the map-provider work
([MAP_PROVIDER_CONFIGURATION.md §Free providers](MAP_PROVIDER_CONFIGURATION.md#free-providers-implemented)).
**Owner decision (binding, 2026-10-24): no billing, free sources only.** The sources below are
**displayed** in the browser at run time or were **measured** once. None of them is copied into
`public/data`, traced into our files or cached offline. The §5 rule (tracing only into OSM) is
unchanged: showing imagery as a basemap is not tracing it.

| Source                            | Licence and terms (as recorded)                                                                                                                                                                                                                                                           | How the app uses it                                                                                                                                                                                             | Attribution shown                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Esri World Imagery                | Esri Master Agreement; ArcGIS Location Platform free tier with pay-as-you-go **off**, so access stops at the free-tier limit and there is no bill. No scraping, download or storage of the data (Master Agreement E204 §3.2(c), quoted in MAP_PROVIDER_CONFIGURATION.md)                  | Optional: only when the owner sets `VITE_ARCGIS_API_KEY` (referrer-restricted, Basemaps privilege only). Satellite 2D, and under Campus 3D. Never precached or cached offline (no service-worker route; tested) | "Powered by Esri" and "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" (the service's `copyrightText`, read 2026-10-24) whenever it is drawn |
| EOX Sentinel-2 cloudless **2016** | CC BY 4.0 for the 2016 vintage: embedding in websites allowed, no SLA, no redistribution of raw tiles, fair use on the free endpoint (EOX FAQ, re-checked 2026-10-24). The 2018 and later vintages are **not** used: their public endpoints are prohibited for commercial production apps | Optional: only with `VITE_EOX_BACKDROP=true` and no Esri key. Satellite 2D only; tiles up to z13, camera stops at z14, with the notice "10 m imagery — buildings not visible". Never cached offline             | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)" and "CC BY 4.0"                                     |
| Copernicus DEM GLO-30             | License-COPDEM-30 (reproduction, distribution and adaptation allowed with the required notice)                                                                                                                                                                                            | **Not used in the app.** One tile was read in a scratch directory outside the repo to measure campus relief: about 4.7 m of ground variation, not visible in 3D. No terrain was added and nothing was committed | None needed. If terrain is ever added, copy the exact notice from the licence PDF at that time (not verified here)                                                    |

The imagery capture date is shown only where it is officially published and verified: "Imagery captured
2023-12-18 according to Esri World Imagery Wayback metadata (retrieved 2026-10-24)" (WorldView-3, 0.31 m;
[IMAGERY_COVERAGE_AND_FRESHNESS.md](IMAGERY_COVERAGE_AND_FRESHNESS.md)), and only while the view centre is
inside the area where it was checked. Imagery is never called "live".

**Not used: Google.** Google Map Tiles (2D satellite and Photorealistic 3D Tiles) need a Google Cloud
billing account, so they are not implemented. The "Photorealistic 3D" view mode stays visible as
unavailable and explains why; it is never imitated with our own blocks. Google Maps, Google Earth and
Street View are never a data source for geometry, names, heights or block numbers (§7). Google _Open
Buildings_ (§3) is a separate, openly licensed dataset and is not affected.
