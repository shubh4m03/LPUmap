# Campus Geography Audit

Status: audit only. No code or data was changed. Audit date: 2026-10-24.
Dataset audited: `public/data/*` with `datasetVersion` **b628c5855b1d**, built from the OSM snapshot
retrieved 2026-10-23T09:39Z (`data/raw/osm/SOURCE.json`).

Every number below was computed from the files named next to it. The scripts are described in
[Appendix A](#appendix-a--method-and-scripts). **Verified** means measured from data. **Lead** means
a hypothesis that still needs survey or official confirmation.

---

## Summary

| #   | Question                                                | Short answer                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Where do the boundaries come from?                      | The campus boundary is OSM multipolygon relation **21599790** (version 1, created 2026-10-09). The app has a second "boundary": a hand-set rectangle, `APP_CONFIG.map.maxBounds`. The pipeline uses that rectangle to decide what to keep.                                  |
| 2   | Real polygon or a bbox?                                 | `boundary.geojson` is the real 124-vertex polygon: **88.97 ha**, perimeter **7,119 m**, valid. Everything else is cut by rectangles. `maxBounds` covers **1,329.7 ha**, so the campus is only **6.7 %** of it.                                                              |
| 3   | Are external footprints included?                       | Yes. By area fraction, **130** footprints are inside, **8** straddle the boundary and **397** are outside. All **535** are extruded in 3D, and **74 %** of them are off campus.                                                                                             |
| 4   | Are layers filtered by the real boundary?               | No. No pipeline stage and no map layer clips or filters by the polygon. The polygon is only used to set `campusZone`, and only from a single point per feature.                                                                                                             |
| 5   | Which campus structures are missing?                    | OSM has no hostels, no Agriculture Block, no canteen names and no entrances inside the boundary. Microsoft ML footprints add **82** unmatched and **29** partly matched footprints inside the boundary. None of them can be identified from data.                           |
| 6   | Misclassified, duplicated or mispositioned features?    | Yes. Examples: the "Hostel" category holds only 3 off-campus private apartments; the School of Design outline has no `building=*` tag; two OSM footprints are exact duplicates; there are stacked parts and a floating slab; off-campus PGs make up 86 % of search results. |
| 7   | Are heights, footprints and textures genuine?           | Footprints are OSM-traced. **0** buildings have a measured `height`. 137 heights are estimated from levels and 398 use the 6 m placeholder. No colour, roof or material tag drives the rendering. There are no textures.                                                    |
| 8   | Do routing edges cross buildings or leave the campus?   | **57 %** of edges (1,013 of 1,770; 35.8 km) lie wholly outside the boundary. **35** edges run through building interiors, 2 of them with no grade-separation tags. The data has **0** entrances. 7 on-campus places snap to graph nodes outside the boundary.               |
| 9   | Is generated data overwritten during builds?            | Yes. Every `npm run build` rewrites `public/data` through `data:check`. The output is byte-identical (same hashes as the cached previous manifest), so nothing is lost.                                                                                                     |
| 10  | Do maxBounds, clipping, filters or minzooms contribute? | maxBounds is the root cause of the off-campus content. No feature is dropped for being small. Labels exist only for named buildings, and 33 of the 36 named buildings are off campus.                                                                                       |

---

## 1. Where the boundaries come from

| Boundary                                                       | Source                                                                                                                  | Code                                                                                                                                                  | Used for                                                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Campus polygon                                                 | OSM relation 21599790, read from `data/raw/osm/boundary-relation-21599790.osm` (relation, 2 member ways, 125 `nd` refs) | `scripts/lib/build-boundary.ts:9` (`CAMPUS_RELATION_ID`), `:26-61` (assembly and validation; the build fails rather than guess a rectangle, `:28-33`) | Drawing the campus fill and outline (`src/map/basemap-layers.ts:73-78, 116-122`), the per-feature `campusZone` point test, and the campus place |
| `APP_CONFIG.map.maxBounds` = `[75.685, 31.236, 75.722, 31.27]` | Hand-set. The comment says "campus extent plus margin for nearby Law Gate area"                                         | `src/config/index.ts:30-31`                                                                                                                           | Pan limit (`src/map/MapView.tsx:141`) and **every pipeline keep/drop decision** (`scripts/lib/pipeline.ts:113-120`)                             |
| Snapshot bbox `[75.695, 31.243, 75.715, 31.262]`               | OSM API `/map` request                                                                                                  | `data/raw/osm/SOURCE.json`                                                                                                                            | Limits which raw data exists at all (401.7 ha). OSM returns whole ways, so some features extend past it.                                        |
| Community / contribution area                                  | Same `maxBounds` rectangle                                                                                              | `src/config/index.ts:103-109`, `src/community/geo.ts:51-53`                                                                                           | Where suggestions may be placed                                                                                                                 |

**History of the campus polygon (verified via the OSM API, downloaded 2026-10-24):**

- Way 422435593 was created on 2016-06-02 by `hg87351` as a closed way named "LPU". It was then edited 19 times.
- Version 19 (2026-10-09T18:44Z) was still a closed 113-node way tagged `amenity=university`, name "Lovely Professional University".
- Version 20 (changeset 190271129, 2026-10-09T19:52Z, user `Kovid`, comment "edited", imagery "Mapbox Satellite") split it into an open 78-node way. That changeset also created way 1566901467 (47 nodes) and relation 21599790 v1, and moved the tags to the relation.
- `fresh.osm` (downloaded 2026-10-24 01:25 IST) matches the committed `campus-bbox.osm` exactly: 7,150 nodes, 946 ways and 19 relations, with no differing versions. The live relation is still version 1.
- **Lead:** the relation is about 2 weeks old and is the work of one mapper. Nobody has compared it with an official LPU site plan.

## 2. Is the polygon the real campus or a bbox?

`public/data/boundary.geojson` holds the real polygon, not a rectangle.

| Metric             | Value                                                                                                     | How                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Geometry           | `Polygon`, 1 outer ring, 0 holes, 124 vertices (123 distinct edges), 0 duplicate vertices                 | Parsed                                                                                 |
| Self-intersections | 0                                                                                                         | Pairwise edge test of all non-adjacent edges                                           |
| Area               | **889,685 m² = 88.97 ha**                                                                                 | Shoelace formula in a local equirectangular projection centred on 75.7032 E, 31.2533 N |
| Perimeter          | **7,119 m**                                                                                               | Same projection                                                                        |
| Bounding box       | 75.6973474–75.7091258 E, 31.2457534–31.2607949 N = 187.3 ha                                               | The polygon fills 47.5 % of its own bbox, so it is clearly not a rectangle             |
| `maxBounds`        | 1,329.7 ha                                                                                                | The campus is **6.7 %** of maxBounds                                                   |
| Snapshot bbox      | 401.7 ha                                                                                                  | Contains the whole polygon                                                             |
| Validity           | Assembled with 0 missing ways and 0 unclosed rings, and passes `ringProblems` (`build-boundary.ts:35-51`) |                                                                                        |

**Root cause of the "bbox" impression.** The polygon is correct, but nothing is cut to it. Buildings,
basemap, graph and places are all kept by rectangle tests against `maxBounds` (see §4). The map
therefore shows a dense neighbourhood (Law Gate, Maheru, Green Valley) about 7× larger than the
campus. Only the faint campus fill hints at the real shape.

**Leads on boundary completeness (unverified):**

- 9 footprints from the 2016 campus mapping era (OSM way ids below 430 M) lie outside the polygon. Examples: `way/422439516` (498 m², 3.6 m outside), `way/422547035` (515 m², 6.0 m), `way/422823981` (277 m², 3.1 m) and `way/422823980` (493 m², 27 m), all at about 75.7075–75.7090 E, 31.2591–31.2600 N.
- `way/422553585` "LPU Ground" (`amenity=university`, 62,717 m², centred near 75.7106 E, 31.2559 N) and `way/422555764` (`building=yes`, `leisure=sports_centre`, 208 m outside) lie east of the polygon.
- These may be campus land that the relation omits. Only survey or official confirmation can decide.

## 3. Are external footprints included?

Yes. The classification below uses the **area fraction** of each footprint inside the polygon. It
was computed with exact polygon–polygon intersection and cross-checked against 0.2 m grid sampling
(error ≤ 1.5 m² on all 8 straddling footprints).

| Class (fraction f inside)      | Footprints | Pipeline `campusZone`                |
| ------------------------------ | ---------- | ------------------------------------ |
| Inside (f ≥ 0.995)             | **130**    | all `on-campus`                      |
| Straddling (0.005 < f < 0.995) | **8**      | 7 `on-campus`, 1 `off-campus-nearby` |
| Outside (f ≤ 0.005)            | **397**    | all `off-campus-nearby`              |
| **Total rendered in 3D**       | **535**    | 137 on-campus / 398 off-campus       |

- Centroid test (the lead's method): 137 inside and 398 outside, which agrees with the pipeline.
- Using f ≥ 0.5 as the cut-off gives no disagreement with `campusZone` for any building.
- Footprint area: 185,891 m² in total, of which only 123,793 m² (66.6 %) lies inside the boundary.

**Straddling footprints (for manual review):**

| OSM id        | Display name        | Area m² | Inside m² | Fraction | Zone | Centroid             |
| ------------- | ------------------- | ------- | --------- | -------- | ---- | -------------------- |
| way/422738894 | Unnamed · 2 floors  | 54.2    | 53.7      | 0.99     | on   | 75.700809, 31.255552 |
| way/426285002 | Unnamed · 3 floors  | 57.3    | 55.3      | 0.96     | on   | 75.707441, 31.260350 |
| way/422738888 | Unnamed · 1 floor   | 100.3   | 83.9      | 0.84     | on   | 75.700157, 31.254734 |
| way/422437900 | Unnamed · 10 floors | 1,342.3 | 1,068.2   | 0.80     | on   | 75.704688, 31.256904 |
| way/422437899 | Unnamed · 8 floors  | 422.3   | 335.7     | 0.80     | on   | 75.703954, 31.256046 |
| way/422437901 | Unnamed · 10 floors | 963.5   | 755.5     | 0.78     | on   | 75.704672, 31.256609 |
| way/422550525 | Unnamed · 6 floors  | 329.9   | 252.9     | 0.77     | on   | 75.706741, 31.260635 |
| way/422738892 | Unnamed · 1 floor   | 91.0    | 36.9      | 0.41     | off  | 75.700679, 31.255544 |

Three large blocks near 75.7047 E, 31.2566 N (`422437899`, `422437900` and `422437901`) are 20–22 %
outside the boundary. Either the boundary edge there (way 1566901467, drawn 2026-10-09) or the 2016
footprints are misaligned. **Lead:** check against imagery.

**Who mapped the 398 off-campus footprints (OSM last-edit metadata):**

- 386 were last edited in 2024, 385 of them by `mohit poonia`.
- 61 carry `source=microsoft/BuildingFootprints`, so part of the Microsoft dataset is already in OSM off campus.
- Distance from the boundary: 17 lie under 10 m away, 51 at 10–50 m, 141 at 50–150 m, 178 at 150–400 m and 11 at 400 m or more.

## 4. Are layers filtered by an actual boundary?

No. The polygon is used only as a point test for `campusZone`.

| Stage         | File:line                                                   | Filter actually applied                                                                                        |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Buildings     | `scripts/lib/build-buildings.ts:73`                         | `inBBox(pointOnSurface, maxBounds)`, a rectangle. `campusZone` comes from one point (`:89`).                   |
| Basemap       | `scripts/lib/build-basemap.ts:94-97`                        | Feature bbox intersects `maxBounds`                                                                            |
| Graph         | `scripts/lib/build-graph.ts:119-122`                        | Both segment ends inside `maxBounds` (105 segments dropped)                                                    |
| Places        | `scripts/lib/build-places.ts:229`                           | Point inside `maxBounds`. Zone from `boundary.contains(location)` (`:151`).                                    |
| Orchestration | `scripts/lib/pipeline.ts:113-120`                           | `maxBounds` is passed to every builder. The boundary goes only to buildings (as `insideCampus`) and to places. |
| Map style     | `src/map/style.ts:62-70`, `src/buildings3d/layers.ts:59-72` | Sources are the full files. The extrusion and fill layers have **no `filter`**.                                |
| POI layer     | `src/map/overlay-layers.ts:155-171`                         | `offCampus` only lowers marker opacity to 0.8 (`circle-opacity`). Off-campus markers are not hidden.           |

**Basemap features by layer (centre point inside / outside the boundary):**

| Layer      | In      | Out     |
| ---------- | ------- | ------- |
| road       | 39      | 113     |
| landuse    | 4       | 33      |
| road-major | 7       | 12      |
| service    | 22      | 7       |
| pitch      | 14      | 6       |
| path       | 61      | 6       |
| parking    | 6       | 1       |
| green      | 43      | 0       |
| water      | 15      | 0       |
| **Total**  | **211** | **178** |

Of the 389 basemap features, 178 are outside the boundary.

**Root cause:** the pipeline was designed to keep a "nearby" ring. Its documentation says so
(`config/index.ts:30`, `:103-109`), so this is intended behaviour. The ring is just much larger than
the campus, and the renderer does not tell the two apart for buildings at all.

## 5. Missing campus structures

### 5.1 OSM vs Microsoft footprints, conflated inside the boundary

**Microsoft source:** Global ML Building Footprints, tile quadkey 123121013 (release folder
`2026-02-03`, uploaded 2026-02-23, ODbL).

- The file has 667,588 features. The tile bounds are 75.2344–75.9375 E, 30.7513–31.3536 N, so the campus lies wholly inside it.
- All 532 footprints near the campus have `height = -1` and `confidence = -1`, so the dataset gives no height and no confidence.

**Method.** Only footprints with at least 50 % of their area inside the boundary are compared. For
each of them, the exact intersection with every OSM footprint was computed.

- **matched:** IoU ≥ 0.3 with one OSM footprint, or ≥ 50 % of the MS footprint covered by OSM
- **partial:** 10–50 % covered
- **MS-only:** < 10 % covered
- **OSM-only:** an OSM footprint < 10 % covered by any MS footprint

|                              | Count                                            | Area m²                                    |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------ |
| OSM footprints ≥ 50 % inside | 137                                              | 124,424                                    |
| MS footprints ≥ 50 % inside  | 168 (centroid test: 168, versus the lead's ~169) | 142,737                                    |
| MS matched                   | 57                                               | —                                          |
| MS partial                   | 29                                               | 19,575 (median 375)                        |
| **MS-only**                  | **82**                                           | **17,522** (median 82.5, range 11.6–2,284) |
| **OSM-only**                 | **39**                                           | 13,246 (median 35)                         |

- MS-only footprints by size: 7 under 25 m², 46 at 25–100 m², 17 at 100–300 m², 7 at 300–1,000 m² and 5 at 1,000 m² or more.
- The lead's "~99 unmatched" used a centroid-in-polygon match. The area method used here gives 82 MS-only plus 29 partial.

**Systematic offset.** For 49 OSM footprints whose best MS match has IoU ≥ 0.2:

- The MS footprints sit a median **5.6 m south** of OSM (dx +0.7 m, dy −5.6 m).
- Median IoU rises from 0.36 to 0.54 once that shift is removed.
- MS footprints are a median 21 % larger than OSM.
- Neither source is ground truth. Any merge must first correct this offset, or matching will be poor.

**OSM-only footprints with no MS counterpart.** Several large ones stand out, for example:

| OSM id                              | Area m²                | Centroid                         |
| ----------------------------------- | ---------------------- | -------------------------------- |
| way/422547443                       | 2,972                  | 75.703612, 31.248303             |
| way/422437902                       | 1,494                  | 75.705673, 31.256528             |
| way/422547448                       | 1,421                  | 75.703494, 31.247150             |
| way/422323508                       | 1,310                  | 75.703263, 31.248695             |
| way/422547446, 422547447, 422547444 | about 1,270–1,310 each | 75.7033–75.7040, 31.2479–31.2487 |

**Lead:** these were built after the MS imagery, demolished, or missed by the model. The MS imagery
dates are not published per footprint.

### 5.2 Coverage grid

The grid uses 150 m cells anchored at the boundary bbox south-west corner. Row 0 is north and
column 0 is west. Each cell shows OSM / MS building area inside the boundary in hundreds of m². A
**bold** number is MS-only area of 500 m² or more. "·" means the cell does not touch the campus.

| row \ col | 0     | 1             | 2              | 3           | 4            | 5            | 6            | 7     |
| --------- | ----- | ------------- | -------------- | ----------- | ------------ | ------------ | ------------ | ----- |
| 0         | ·     | ·             | ·              | ·           | ·            | 2/0          | 0/0          | ·     |
| 1         | ·     | ·             | ·              | ·           | ·            | 1/0          | 2/3          | ·     |
| 2         | ·     | ·             | ·              | ·           | 0/0          | 2/3          | 26/22        | 17/14 |
| 3         | ·     | ·             | ·              | ·           | 17/20        | 21/36 **18** | 17/43 **22** | 0/1   |
| 4         | ·     | 0/0           | 2/7            | 20/1        | 96/102       | 32/19 **7**  | 2/2          | ·     |
| 5         | ·     | 3/3           | 32/46          | 7/11        | 79/92        | 40/45        | ·            | ·     |
| 6         | ·     | 7/8           | 34/50          | 44/35       | 48/38        | 0/0          | ·            | ·     |
| 7         | 0/0   | 29/33         | 58/83 **17**   | 52/71 **7** | 114/98       | 13/13        | ·            | ·     |
| 8         | 0/3   | 17/36         | 103/122 **14** | 2/5         | 4/6          | 31/39        | 0/0          | ·     |
| 9         | 16/21 | 57/103 **13** | 17/39          | 24/3        | 23/12        | 0/0          | 0/0          | 0/0   |
| 10        | 0/3   | 0/14 **7**    | 0/0            | 34/0        | 22/19 **18** | 0/9 **9**    | 0/0          | 0/0   |
| 11        | 0/0   | 0/9 **9**     | 0/0            | 26/21       | 46/61        | ·            | ·            | ·     |

**Gap hot-spots (MS more than OSM).** Cell centres are approximate:

- r3 c5 (75.7060, 31.2572) and r3 c6 (75.7076, 31.2572): 4,000 m² of MS-only area. Most of it is the School of Design outline, which has no building tag (§6).
- r9 c1 (75.6997, 31.2491)
- r10–11 c1 (75.6997, 31.2471): no OSM buildings at all
- r10 c4 and r10 c5 (75.7045–75.7060, 31.2478)
- r7 c2 (75.7013, 31.2518)
- r8 c2 (75.7013, 31.2505)

**OSM more than MS:** r4 c3, r9 c3 and r10 c3 (75.7029, 31.2478–31.2559). The OSM footprints there
have no MS counterpart; see the OSM-only list in §5.1.

The full MS-only list (centroid, area, coverage) is in the scratch output `ms-only.geojson`
(Appendix A).

### 5.3 Specific structures

| Structure                   | What OSM has (inside the boundary)                                                                                                                                                                                                                                                      | What MS adds                                                                                  | Status                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Agriculture Block**       | Nothing named, tagged or classified as agriculture. Of the 135 `building=yes` ways, only 3 are named (Lovely Institute of Management/Technology/Pharmacy). Curated `cur:school-agriculture` exists in `data/curated/organizations.json` with `location: null` and no host.              | Unidentified footprints only (§5.2)                                                           | **Unresolved.** No data source positions it. |
| **Hostels**                 | 0 hostel or dormitory features inside the boundary. The only `hostel` places are 3 off-campus private apartments tagged `tourism=hostel` (§6). 53 unnamed `building:levels=10` footprints inside the boundary match the scale of residential towers but are not identified (lead only). | Unidentified                                                                                  | **Unresolved**                               |
| **Canteens / kiosks**       | One unnamed `amenity=restaurant` + `building=yes` (`way/1550425052`, 1,402 m², 75.70185 E, 31.25228 N). No `amenity=cafe`, `fast_food` or `food_court` inside the boundary. All 17 other `food` places are off campus (Law Gate strip).                                                 | Small MS-only footprints of 12–50 m² could be kiosks or sheds. Their type cannot be inferred. | **Unresolved**                               |
| **Entrances / gates**       | 0 `entrance=*` nodes and 0 gate barriers in the snapshot. The only `barrier` is `block`. The only gate place is "Green valley main gate" (`node/12031088561`, `man_made=ceremonial_gate` + `ceremonial_gate=torii`), which is off campus at 75.69756 E, 31.25173 N.                     | —                                                                                             | **Unresolved**                               |
| Other inside-boundary items | 40 `leisure=park`, 14 pitches, 6 parking areas, 2 water towers (`node/4224770131`, `node/4225472858`), 34 `natural=tree`, 15 water areas                                                                                                                                                |                                                                                               |                                              |

**Behance "LPU isometric map design" (UNVERIFIED leads only).** The image is copyrighted
third-party artwork of unknown date, saved under the git-ignored `reference/` folder. Its index
lists, among others:

| Use                   | Block numbers in the artwork |
| --------------------- | ---------------------------- |
| Fashion               | 1                            |
| Pharmacy              | 4, 7                         |
| Physiotherapy         | 3                            |
| Architecture          | 6                            |
| Agriculture           | 25, 26                       |
| Computer Science      | 34                           |
| Administrative        | 29                           |
| Baldev Raj Auditorium | 2                            |
| Shantidevi Auditorium | 35                           |
| Indoor                | 47                           |
| Girls Hostel          | 9, 10, 11, 12, 21 A/B        |
| Apartments            | 41–44                        |
| Boys Hostel           | 45, 48–53                    |

These are a checklist of what a survey should look for. None may be used to name, number or position
any footprint. The artwork's layout is schematic and not georeferenced.

## 6. Misclassified, duplicated, unnamed or mispositioned features

| Issue                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Root cause                                                                                       | Proposed fix                                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Hostel" category contains only private PGs off campus**    | `hostel` = 3 places, all off campus: `way/1299137613` "Elem apartment", `way/1299447331` "prime apartment 2", `way/1299447332` "Diya apartment" (`tourism=hostel`). The category's synonyms include "boys hostel", "girls hostel", "bh" and "gh" (`src/config/categories.ts:75-87`).                                                                                                                                                                                 | Tag-based classification, with no zone or operator check                                         | Exclude off-campus places from the `hostel` category, or show them as "Private hostel (nearby)". Never let "boys hostel" queries rank them as campus hostels.          |
| **"Residence / PG / apartment" (213) is entirely off campus** | `tourism=apartment` (210) and `hotel` (3), all off campus (`categories.ts:88-96`)                                                                                                                                                                                                                                                                                                                                                                                    | maxBounds keep plus classification                                                               | Separate group "Nearby (off campus)", hidden by default                                                                                                                |
| **School of Design outline is not a building**                | `way/425717552`: `name=School of Design`, `office=educational_institution`, `building:levels=10`, **no `building=*`**, 4,500 m² (last edit 2025-03-13). It overlaps **no** OSM footprint but covers 4 MS-only footprints (2,284, 734, 475 and 36 m², 82–97 % inside it). It is therefore not extruded. It appears as a facility point. `cur:school-of-design` (curated, from the lpu.in fashion page) copies its location and is `located_in` it (`relations.json`). | OSM tagging gap                                                                                  | Upstream OSM fix (add `building=university`) after on-site confirmation, or a curated footprint override. Keep the organisation and the building as separate entities. |
| **Exact duplicate footprints**                                | `way/422437890` (`building:levels=6`) and `way/675395630` (`education=educational_institution`): identical 1,466 m² geometry (IoU 1.00), both last edited 2019-03-08                                                                                                                                                                                                                                                                                                 | OSM duplicate                                                                                    | Pipeline: report IoU ≥ 0.95 as duplicates and merge tags. Fix upstream in OSM.                                                                                         |
| **Overlapping stacked parts drawn from the ground**           | `way/422823426` (1 level), `/422823427` (3 levels, `layer=3`) and `/422823428` (5 levels). 427 lies wholly inside 426 (IoU 0.79) and 428 inside both. `way/426284154` (`building=roof`, `roof:levels=9`, `roof:shape=skillion`) overlaps all of them. All extrude from 0 m, which causes z-fighting.                                                                                                                                                                 | Parts mapped as separate `building=*` ways with `layer` instead of `building:part` + `min_level` | Treat contained footprints as parts. Report overlaps over 1 m² in the quality report. Fix upstream.                                                                    |
| **Floating slabs**                                            | `way/422823431` (12,794 m², `building:levels=4`, `building:min_level=3.75`) renders from 12.0 m to 12.8 m. `way/422550525` (`levels=6`, `min_level=5`) renders from 16 m to 19.2 m over two `covered=yes` driveways.                                                                                                                                                                                                                                                 | Literal `min_level`                                                                              | Verify on site. Legend note for elevated structures.                                                                                                                   |
| **Implausible levels**                                        | 2 buildings with `building:levels=0.2`, which gives 0.64 m extrusions. 53 inside-boundary buildings tagged exactly 10 levels.                                                                                                                                                                                                                                                                                                                                        | Source tagging                                                                                   | Flag non-integer levels below 1 in the quality report. Survey heights.                                                                                                 |
| **"Law gate" area**                                           | `way/752027029` (`landuse=residential`, `residential=rural`, 86.3 ha) is correctly described as "not a campus entrance" (`build-places.ts:125-133`, quality notes). It is still a searchable `other` area place.                                                                                                                                                                                                                                                     |                                                                                                  | Keep the description. Rank it below campus results.                                                                                                                    |
| **"LPU" node**                                                | `node/1406003115` `amenity=university`, name "LPU" at 75.70462 E, 31.25492 N. It is a second campus point next to the relation and is not connected to the graph.                                                                                                                                                                                                                                                                                                    | Legacy OSM node                                                                                  | Hide it, or alias it to the relation.                                                                                                                                  |
| **"voll" pitch**                                              | `way/422551917` name "voll" (`sport=volleyball`)                                                                                                                                                                                                                                                                                                                                                                                                                     | Truncated name in OSM                                                                            | Upstream fix                                                                                                                                                           |
| **Off-campus POIs dominate search**                           | 285 searchable place docs (named or aliased; `src/search/docs.ts:75-104`), of which **246 (86 %)** are off campus. 289 POI markers, of which **224** are off campus.                                                                                                                                                                                                                                                                                                 | maxBounds                                                                                        | Zone-aware ranking and filtering                                                                                                                                       |
| Unnamed                                                       | 499 of 535 buildings are unnamed, including 134 of 137 on campus (`quality-report.json`)                                                                                                                                                                                                                                                                                                                                                                             | OSM                                                                                              | Survey                                                                                                                                                                 |
| Overlaps off campus                                           | `way/1300687860` "karan pg 1", `/1300687871` "karan pg 2" and `/1300687872` overlap by 14–19 m². `way/1300762538` and `/1304983094` (MS-sourced) overlap by 2.4 m².                                                                                                                                                                                                                                                                                                  | OSM                                                                                              | Report only                                                                                                                                                            |

## 7. Are heights, footprints and textures genuine?

| Item                          | Finding                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heightSource` (all 535)      | `osm-height` **0**, `osm-levels-estimate` **137**, `fallback` (6 m) **398** (`quality-report.json` `heightSources`).                                                                                                               |
| Inside the boundary (f ≥ 0.5) | 129 levels-estimate, 8 fallback (for example `way/422737297`, 10,171 m², no levels)                                                                                                                                                |
| Outside the boundary          | 8 levels-estimate, 390 fallback                                                                                                                                                                                                    |
| Height logic                  | `scripts/lib/height.ts:40-69`. 3.2 m per level and 6 m fallback, both from `config/index.ts:37-40`. The UI legend states that these are estimates (`src/buildings3d/layers.ts:121-142`).                                           |
| Appearance tags present       | `building:levels` 137, `building:material` 6, `building:min_level` 4, `roof:shape` 1, `roof:levels` 1, `building:part` 1 (one way in the whole snapshot). There is no `height`, `roof:colour`, `building:colour` or `roof:height`. |
| Used by the renderer          | Only `heightM` and `minHeightM`. Colour depends only on `heightSource` (`layers.ts:36-51`). There are no textures or materials, so "textures" are not data-driven.                                                                 |
| Footprint provenance          | Inside the boundary: 105 last edited by `hg87351` (mostly 2016) and 24 by `Kovid` (2026). All 137 have no `source` tag. The footprint shapes are OSM traces, offset about 5.6 m from MS (§5.1).                                    |
| Area                          | Minimum 4.1 m², median 115.5 m², maximum 12,794 m². 24 footprints are under 20 m².                                                                                                                                                 |

## 8. Routing edges vs buildings and the permitted area

The graph is in `public/data/graph.json`: 1,636 nodes, 1,770 edges, all `foot: true` and **0** with
`indoor: true`.

**Edges and the boundary (end-node test):**

| Edges                 | Count     | Length      |
| --------------------- | --------- | ----------- |
| Both ends inside      | 753       | 19.5 km     |
| Both ends outside     | **1,013** | **35.8 km** |
| Crossing the boundary | 4         | 0.14 km     |

- The outside edges are mostly residential roads (561), unclassified (175), tertiary (164) and track (69).
- The graph has 9 components. The largest (1,508 nodes) holds 659 of the 675 inside nodes, and 16 inside nodes are in small components.
- Only **4 edges** cross the boundary. These are the only graph links between campus and town:

| Edge | OSM way    | Highway      | Inside node            |
| ---- | ---------- | ------------ | ---------------------- |
| 174  | 422552789  | unclassified | 75.70170 E, 31.24626 N |
| 682  | 1083414450 | residential  | 75.69834 E, 31.24878 N |
| 1170 | 1116516082 | residential  | 75.70064 E, 31.25544 N |
| 1180 | 1116516082 | residential  | 75.70074 E, 31.25514 N |

**Lead:** these may not be real or open gates.

**Edges through building interiors.** These are edge segments with more than 0.5 m inside a
footprint polygon, measured by splitting each segment at its crossings with the outline.

- 35 edges on 18 ways cross 12 buildings, with 321 m inside in total. 10 edges have more than 10 m inside.
- By highway: footway 23, residential 9, tertiary 1, unclassified 1, service 1.
- 26 of the 35 involve buildings inside the boundary.

| Kind                                                               | Examples                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grade-separated by tags (plausibly legitimate)                     | Footway `way/1566901473` (`layer=-1`) runs 83 m under `way/422556249`. `covered=yes` driveways `way/1116524611` and `/1116524608` run 12 m each under elevated `way/422550525`. Footway `way/354744721` (`layer=-1`) under `way/426285002`.                                    |
| Building has `layer`, footway untagged (ambiguous)                 | Footways `way/1566901470`, `/1566901471` and `/1566901472` run about 61 m through `way/422823420` (`layer=-1`). Footways `way/1550425055`, `/1552759658`, `/1552759659` and `/1566888541` run about 81 m through `way/422823421` (`layer=1`). All were edited in Sep–Oct 2026. |
| Off campus, MS-imported buildings tagged `layer=1` on top of roads | `way/1083414448` (27.7 m in `way/1304996361`), `/1115970948`, `/1115970949` and `/1083414453`                                                                                                                                                                                  |
| No tags at all                                                     | Off campus: `way/1083738141` through `way/1300687854` (6.7 m). On campus: service `way/1214256446` through `way/422548302` (4.0 m).                                                                                                                                            |

**Entrances.**

- The snapshot has **0** `entrance=*` nodes and 0 `has_entrance` relations (`quality-report.json`: `entrances.total = 0`).
- Building connectors therefore snap to the nearest outline vertex or the nearest graph node within 60 m (`scripts/lib/connectors.ts:54-88`). That node can lie on the far side of a wall.

**Snapping across the boundary.**

- **7 on-campus places** snap to nodes outside the boundary, for example `way/422738867` (47.2 m), `way/422738870` (35.5 m) and parking `way/426531641` (40.0 m), all on the south edge around 31.2458 N.
- **7 off-campus places** snap to nodes inside, for example `way/422439521` (37.4 m) and `way/422547035` (33.8 m).
- 28 on-campus places have no connector at all (most are pitches and parks in the south-west, plus `node/1406003115` "LPU").

## 9. Is generated data overwritten during builds?

| Fact                                                                                                                                                                                             | Evidence                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build` runs `data:check` (= `data:build` + `data:validate`) before `tsc` and `vite`                                                                                                     | `package.json` `scripts.build`                                                                                                                                                                                     |
| `data:build` with default arguments writes all 8 files in `public/data`, `docs/DATA_QUALITY_REPORT.md` and `data/schemas/*`, and copies the old manifest to `data/.cache/previous-manifest.json` | `scripts/build-data.ts:26-41`, `scripts/lib/pipeline.ts:187-207`                                                                                                                                                   |
| Deterministic by design: no clock, no network, sorted output, fixed precision                                                                                                                    | `pipeline.ts:1-5`. A grep found no `Date.now`, `new Date` or `Math.random` in `scripts/lib` outside the smoke helpers.                                                                                             |
| Observed determinism                                                                                                                                                                             | `public/data` files were rewritten at 2026-10-24 01:36 IST. Every file sha256 equals the one in `data/.cache/previous-manifest.json` (written 2026-10-23 22:27), and the `datasetVersion` is b628c5855b1d in both. |
| CI guard                                                                                                                                                                                         | `.github/workflows/ci.yml:57-68` fails if `public/data` or the quality report change after `data:check`                                                                                                            |
| Raw snapshot is not refetched unless `--force`                                                                                                                                                   | `scripts/lib/fetch-osm-lib.ts:132-133`. The writes use `.tmp` files and then rename (`:192`).                                                                                                                      |

The data is regenerated on every build but reproduced byte-for-byte, so the overwrite is harmless.
The real risk is a different one: any manual edit to `public/data` (for example adding MS footprints
by hand) would be silently replaced. A data change must go into `data/raw` or `data/curated` plus the
pipeline. I did not run a fresh rebuild for this audit; the determinism evidence comes from the
hashes above.

## 10. Do maxBounds, clipping, filters or minzooms contribute?

| Mechanism                                                     | File:line                                                   | Effect                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxBounds` keep-rectangle                                    | `src/config/index.ts:31`, all builders (§4)                 | **Primary cause** of the 398 off-campus buildings, 622 off-campus places and 1,013 off-campus edges                                                              |
| Area or size thresholds                                       | none                                                        | No size filter anywhere. The smallest kept footprint is 4.1 m². `skippedFeatures` is empty (`quality-report.json`).                                              |
| Extrusion minzoom 14.5                                        | `config/index.ts:35`, `buildings3d/layers.ts:63`            | Below z14.5 only the flat fill shows (`layers.ts:80-82, 95`)                                                                                                     |
| Building outline minzoom 15                                   | `buildings3d/layers.ts:105`                                 |                                                                                                                                                                  |
| Labels minzoom 16                                             | `config/index.ts:36`, `overlay-layers.ts:186`               |                                                                                                                                                                  |
| Building labels only when `name` is set                       | `overlay-layers.ts:236-240`                                 | Only 36 buildings are labelled, and **33 of them are off campus**. On campus only the 3 "Lovely Institute …" blocks get a label.                                 |
| Label priority                                                | `overlay-layers.ts:23` (building 1 < POI 2 < road 3)        | Off-campus building names (PG and restaurant names) win collisions over POI labels in the Law Gate strip. Small unnamed campus buildings have no labels to lose. |
| POI minzoom 14, path minzoom 14.5, steps 15, service roads 15 | `overlay-layers.ts:20`, `basemap-layers.ts:102, 112, 92-95` | Cosmetic. Hides nothing permanently.                                                                                                                             |
| Off-campus POI styling                                        | `overlay-layers.ts:170`                                     | Opacity 0.8 only                                                                                                                                                 |
| Graph clipping to maxBounds                                   | `build-graph.ts:119-122`                                    | 105 segments dropped (outside the rectangle, not the campus)                                                                                                     |

## Counts affected by off-campus features

| Surface                               | Total | Off-campus                          | Source                                                    |
| ------------------------------------- | ----- | ----------------------------------- | --------------------------------------------------------- |
| Buildings (3D extrusions)             | 535   | 398                                 | `buildings.geojson`                                       |
| Places (`manifest.counts.places`)     | 855   | 622                                 | `manifest.json` `zone:*`                                  |
| About panel "Off campus (nearby)"     | —     | 622                                 | `src/components/about/about-model.ts:35`                  |
| Search docs (named or aliased places) | 285   | 246                                 | Computed with the `docsFromPlaces` rule                   |
| POI markers                           | 289   | 224                                 | Same rule as `poiCollection` (`src/map/geojson.ts:61-86`) |
| Category: residential                 | 213   | 213                                 | `manifest.json` `category:*`                              |
| Category: building                    | 494   | 358                                 | `manifest.json` `category:*`                              |
| Category: food                        | 18    | 17                                  | `manifest.json` `category:*`                              |
| Category: sports                      | 28    | 13                                  | `manifest.json` `category:*`                              |
| Category: shop                        | 5     | 5                                   | `manifest.json` `category:*`                              |
| Category: hostel                      | 3     | 3                                   | `manifest.json` `category:*`                              |
| Category: university                  | 6     | 3                                   | `manifest.json` `category:*`                              |
| Category: other                       | 3     | 3                                   | `manifest.json` `category:*`                              |
| Category: parking                     | 8     | 2                                   | `manifest.json` `category:*`                              |
| Category: finance                     | 2     | 2                                   | `manifest.json` `category:*`                              |
| Category: gate                        | 1     | 1                                   | `manifest.json` `category:*`                              |
| Category: health                      | 2     | 1                                   | `manifest.json` `category:*`                              |
| Category: transport                   | 1     | 1                                   | `manifest.json` `category:*`                              |
| "N mapped" category labels            | —     | include off-campus                  | `src/search/docs.ts` `mappedLabel`                        |
| Category panel lists                  | —     | include off-campus, with a subtitle | `src/components/categories/CategoryPanel.tsx:59-74`       |
| `heightSource:fallback`               | 398   | 390                                 | Height counts                                             |
| Graph nodes                           | 1,636 | 961 outside the boundary            | `graph.json`                                              |
| Graph edges                           | 1,770 | 1,013 wholly outside                | `graph.json`                                              |
| Basemap features                      | 389   | 178                                 | `basemap.geojson`                                         |

## Evidence still needed

1. **An official or surveyed campus extent.** Confirm whether "LPU Ground" (`way/422553585`), the NE footprints 3–27 m outside, and the three blocks 20 % outside near 75.7047 E, 31.2566 N belong to the campus.
2. **Building identities.** Names and block numbers for the 134 unnamed on-campus footprints and for the 82 MS-only and 29 partial footprints. This includes the Agriculture Block, all hostels, canteens and kiosks. Use the Behance index only as a checklist.
3. **Gates and entrances.** Surveyed positions and opening rules. Confirm whether the 4 boundary-crossing edges are real access points.
4. **Grade separation.** Confirm the passages under `way/422823420`, `/422823421` and `/422556249`, the elevated structures `way/422823431` and `/422550525`, and the stacked parts `way/422823426`–`/422823428`.
5. **Heights.** Any measured `height` values. Check the 53 buildings tagged 10 levels and the two tagged 0.2.
6. **Imagery dates for the MS footprints** and an independent alignment reference, to decide the 5.6 m offset.
7. **A fresh rebuild** confirming determinism on this machine (not run here, by design).

## Prioritized fix list

| P   | Fix                                                                                                                                                                                                                                   | Where                                                                  | Why                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| P0  | Classify every feature by **area fraction** inside the boundary (≥ 0.5 counts as on campus) and store `insideFraction`. Keep it deterministic.                                                                                        | `scripts/lib/build-buildings.ts:89`, `build-places.ts:151`             | Correct zones for straddlers                                          |
| P0  | Render off-campus buildings differently: a separate layer or a filter on `campusZone`, flat or muted, optionally hidden. Hide off-campus POIs by default in a "Nearby" group.                                                         | `src/buildings3d/layers.ts:59-72`, `src/map/overlay-layers.ts:155-171` | 74 % of extrusions and 78 % of markers are off campus                 |
| P0  | Stop the `hostel` category from presenting off-campus `tourism=hostel` PGs as campus hostels. Zone-aware search ranking.                                                                                                              | `src/config/categories.ts:75-96`, `src/search/*`                       | 3 of 3 "hostels" are private PGs. 86 % of search docs are off campus. |
| P1  | Shrink or replace `maxBounds` as the data-keep rule. Keep a small buffered-boundary ring (for example 100 m) for "nearby" places only, separate from the pan limit.                                                                   | `src/config/index.ts:31`, `pipeline.ts:113-120`                        | Root cause                                                            |
| P1  | Quality report: add straddlers (with fractions), overlaps over 1 m² and IoU ≥ 0.95 duplicates (`422437890`/`675395630`), edges through buildings without layer or covered tags, and cross-boundary connectors                         | `scripts/lib/quality.ts`                                               | Makes these defects visible in CI                                     |
| P1  | School of Design: propose the upstream OSM `building=*` fix once verified, or add a curated footprint override with provenance                                                                                                        | `data/curated/`                                                        | Large building missing from 3D                                        |
| P1  | Optional "unverified footprint" layer from MS ML (ODbL) for MS-only polygons inside the boundary. Correct the 5.6 m offset first, attribute the source, never name the footprints, and use fallback height with its own legend entry. | New raw source + pipeline                                              | Fills 17,522 m² of gaps honestly                                      |
| P2  | Connectors: do not snap a place across the boundary when a same-zone node is within the limit. Report the 28 unconnected on-campus places.                                                                                            | `scripts/lib/connectors.ts:54-88`                                      | 14 cross-boundary snaps                                               |
| P2  | Rendering: draw contained OSM parts above their hosts (or skip the hosts), and flag floating or very thin extrusions                                                                                                                  | `scripts/lib/build-buildings.ts`, `height.ts`                          | Z-fighting and slabs                                                  |
| P2  | Field survey plan using §5.2 hot-spots and the Behance checklist (unverified)                                                                                                                                                         | `docs/`                                                                | Missing hostels, Agriculture Block, canteens, gates                   |

---

## Appendix A — Method and scripts

The scripts live in the session scratch area (outside the repo) under `geo/audit/`. They are plain
Node 24 ESM with no dependencies and only read repository files.

| Script                         | Method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geo.mjs`                      | Local equirectangular projection centred on 75.7032 E, 31.2533 N (scale error below 0.01 % over the campus). Shoelace area and perimeter. Even-odd point-in-polygon. Exact polygon intersection area by Green's theorem: the boundary of A∩B is (∂A inside B) ∪ (∂B inside A). Edges are split at crossings and classified by midpoint; a shared edge is counted once and only when the orientations agree. A grid-sampling cross-check and a Sutherland–Hodgman rectangle clip are included. |
| `osm.mjs`                      | Minimal reader for OSM API 0.6 XML                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `a1-boundary-buildings.mjs`    | Boundary metrics and validity. Per-building inside fraction, with classes inside/outside at ±0.5 % and straddling in between. Verified against 0.2 m sampling (8 straddlers, differences of 1.5 m² or less). Pairwise OSM overlaps (`verify-overlaps.mjs` re-samples each one). Height and appearance tag counts.                                                                                                                                                                             |
| `a2-conflation.mjs`            | Streams the Microsoft tile (gzip GeoJSON lines) and keeps polygons near the boundary bbox (±50 m). Inside fraction. OSM matching by IoU and coverage (thresholds in §5.1). 150 m coverage grid with building area weighted by inside fraction. Writes `ms-only.geojson`.                                                                                                                                                                                                                      |
| `a2b-offset.mjs`               | Centroid shift of best-IoU pairs (IoU ≥ 0.2), and IoU after removing the shift                                                                                                                                                                                                                                                                                                                                                                                                                |
| `a3-routing.mjs`               | Edge end-node zone test, components, edges through building interiors (more than 0.5 m inside), entrance and barrier nodes from the raw snapshot, connector zone checks                                                                                                                                                                                                                                                                                                                       |
| `a4-outside.mjs`               | Distance of each outside building to the boundary, way-id era, last editor and `source`                                                                                                                                                                                                                                                                                                                                                                                                       |
| `a5-inventory.mjs`             | Every tagged OSM element inside the boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `a6-freshdiff.mjs`             | Element and version diff of `fresh.osm` against `data/raw/osm/campus-bbox.osm`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `a7-places-basemap.mjs`        | Category, search-doc and marker counts by zone. Basemap layers inside and outside.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `a8-misc.mjs`, `a8b-sd-ms.mjs` | School of Design outline vs OSM and MS footprints. Classification of building crossings by grade separation.                                                                                                                                                                                                                                                                                                                                                                                  |

**External data used (not committed):**

- OSM API 0.6 history for relation 21599790 and ways 422435593 and 1566901467, plus changesets 190271129 and 190268485 (© OpenStreetMap contributors, ODbL).
- Microsoft Global ML Building Footprints, quadkey 123121013 (ODbL).
- The Behance artwork (<https://www.behance.net/gallery/105159145/LPU-isometric-map-design>), viewed only for unverified leads.
