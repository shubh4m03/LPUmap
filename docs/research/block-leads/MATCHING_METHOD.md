# How the block-number candidates were matched

> **Status: review material, not applied data.** This file explains how
> [`block-candidates.json`](block-candidates.json), [`CANDIDATES.md`](CANDIDATES.md) and
> [`candidates-overview.png`](candidates-overview.png) were produced. The block numbers come from the
> campus illustration ("LPU isometric map design", first studied from Behance; owner-supplied since
> 2026-10-24, see [`LPU_ISOMETRIC_ASSET_INTEGRATION.md`](../../LPU_ISOMETRIC_ASSET_INTEGRATION.md)), transcribed in
> [`block-leads.json`](block-leads.json). Under the owner's rules, the illustration may not by itself
> name, number or position a real footprint, and an official block number may never be inferred from
> location or appearance alone. Every output therefore lists **candidates for the owner to confirm**,
> never a single answer. Nothing was written to `src/`, `scripts/`, `data/`, `public/`, `tests/` or `server/`,
> and nothing was committed.

> **Post-review note (2026-10-24).** An adversarial review has since re-scored the candidates. The
> scores, recommendations and PNG colours now in `block-candidates.json`, `CANDIDATES.md` and
> `candidates-overview.png` are the **reviewed** values: 19 confirm-on-site, 30 ambiguous and 6 with no
> footprint, with a top score of 0.80. The scoring rule below describes the matcher's first pass. See
> [`REVIEW.md`](REVIEW.md) for what changed and why, and [`OWNER_CHECKLIST.md`](OWNER_CHECKLIST.md)
> for the site checks.

## Inputs

| Input                                                        | Use                                                                             | Notes                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/research/block-leads/block-leads.json`                 | Block numbers, captions, the drawing's shape notes and conflicts                | Read as is. 55 leads, including 21A and 21B.                                                                                                                                                                                                  |
| `reference/assets/behance-slides/slide-28.jpg` (3371 × 2384) | Pixel positions of the overview pins and control features                       | Read by eye from gridded crops kept in scratch. **No pixels were copied into the repo.**                                                                                                                                                      |
| `public/data/buildings.geojson`                              | OSM footprints (131 features)                                                   | The working copy parsed cleanly and was complete. It differs from `HEAD` (902af566) by one line, so the working copy was used. It was snapshotted to scratch first (sha256 `a5ee6d00…954a`) to isolate this work from the concurrent rebuild. |
| `public/data/basemap.geojson`, `boundary.geojson`            | Roads, roundabouts, pitches, lawns, ponds, parking; campus outline              | Working copy, snapshotted.                                                                                                                                                                                                                    |
| `data/raw/osm/campus-bbox.osm`                               | Water-tower nodes; a road junction node                                         | Read only.                                                                                                                                                                                                                                    |
| `public/data/detections.geojson`                             | Microsoft ML footprints and Google Open Buildings points that have no OSM match | It parsed (122 features). Used only to flag leads that may have no OSM footprint.                                                                                                                                                             |

Coordinates were converted to local metres with an equirectangular projection centred on
lon 75.7032, lat 31.2533. This is accurate to well under 1 m across the campus.

## Step 1: control features seen in both the drawing and OSM

The drawing is axonometric and viewed roughly from the north: the main gate on the trunk road is at the
bottom right, and the cricket ground (far south-west) is at the top left. Each control feature below
can be recognised in the drawing **without using any block number**. Ground-level positions were used
where possible. For buildings, the base was estimated, not the roof.

| ID  | Feature                                           | Kind              | Drawing px (u, v) | OSM evidence                                                      | Global residual (m) | Leave-one-out, global (m) | Leave-one-out, local (m) |
| --- | ------------------------------------------------- | ----------------- | ----------------- | ----------------------------------------------------------------- | ------------------- | ------------------------- | ------------------------ |
| C1  | Cricket / athletics oval centre                   | ground            | (803, 352)        | `way/422577269` leisure=pitch, sport=cricket                      | 70.3                | 98.2                      | 31.8                     |
| C2  | Tennis + basketball court cluster centre          | ground            | (675, 490)        | mean of 9 pitches `way/422551912-920`                             | 47.9                | 55.5                      | 30.1                     |
| C3  | Junction island beside the round tanks            | junction          | (880, 530)        | roundabout arcs `way/422552786` + `1116481252`                    | 65.4                | 77.8                      | 35.1                     |
| C4  | Water tower beside the three-slab hostel          | ground            | (1295, 670)       | node 4224770131 man_made=water_tower                              | 74.7                | 108.8                     | 9.6                      |
| C5  | Large hall (drawn with pin 47), base centre       | landmark building | (1040, 680)       | `way/422737297` (10 171 m2)                                       | 43.1                | 49.2                      | 44.8                     |
| C6  | Fan-shaped bowl (drawn with pin 35)               | landmark building | (1000, 868)       | `way/422556250` quarter-circle in the V                           | 33.6                | 36.5                      | 49.4                     |
| C7  | Junction island at the foot of the blue walkway   | junction          | (1070, 955)       | roundabout arcs `way/1116524624` + `1116524625`                   | 140.8               | 153.5                     | 69.2                     |
| C8  | Open-auditorium roof (scene pin 16), at ground    | landmark building | (1235, 1070)      | `way/422823431` (12 793 m2, largest on campus)                    | 128.9               | 139.8                     | 34.0                     |
| C9  | Junction island beside pin 18                     | junction          | (1370, 1040)      | roundabout arcs `way/422550020` + `1116516081`                    | 156.5               | 169.9                     | 28.3                     |
| C10 | Junction island between pins 15 and 12            | junction          | (1255, 1170)      | roundabout arcs `way/422553591` + `1116524619`                    | 177.1               | 200.1                     | 16.5                     |
| C11 | Main-gate lanes / booth canopy                    | ground            | (2150, 1700)      | 4 booth footprints `way/422550006-009`                            | 59.9                | 81.7                      | 27.6                     |
| C12 | Curved crescent (drawn with pins 56/57)           | landmark building | (285, 545)        | area-weighted centroid of `way/422547448-456`                     | 114.4               | 179.3                     | 42.5                     |
| C13 | Water tower at the corner of the 53/54 complex    | ground            | (510, 750)        | node 4225472858 man_made=water_tower                              | 96.4                | 142.5                     | 69.1                     |
| C14 | Square garden with a dark centre, inside the gate | ground            | (1980, 1745)      | pond `way/422550820` in the oval lawn                             | 89.3                | 122.8                     | 98.4                     |
| C15 | Tall gate tower at the trunk road                 | ground            | (2275, 1810)      | `way/422550528` (6 levels, beside gate structure `way/422550525`) | 122.3               | 181.1                     | 44.6                     |

**Held-out check points.** These were tested against the fit but not used to build it:

| ID  | Feature                                                     | Drawing px   | OSM                                    | Error, global (m) | Error, local (m) |
| --- | ----------------------------------------------------------- | ------------ | -------------------------------------- | ----------------- | ---------------- |
| C16 | Fan of slanted green strips in front of the pin-2 forecourt | (1420, 1730) | 4 grass polygons `way/422736731-734`   | 207.0             | **217.2**        |
| C17 | Road fork just inside the gate                              | (1700, 1510) | node at lon 75.7066106, lat 31.2585643 | 61.2              | 49.6             |

Adding C16 and C17 to the fit made the leave-one-out error worse (local RMS 47 → 77 m). The drawing near
the gate is not consistent with OSM, so they were kept as checks only.

**Circularity.** C5, C6, C8 and C12 are buildings that also carry block leads (47, 35, 16 and 55-57).
They were chosen because they are unique at campus scale: the largest hall, the only bowl, the
largest roof and the only radiating crescent. Even so, the projected distances for those leads are not
independent evidence. CANDIDATES.md says so on each of them.

## Step 2: fitting the transform (residuals in metres)

**Global affine (6 parameters, least squares, 15 points): the fit is poor.**

- RMS residual **103.7 m**, max **177.1 m** (C10). Leave-one-out RMS is **130 m**.
- Scale is about 0.53 m per pixel along u and 1.08 m per pixel along v. That 2.1× anisotropy is expected
  for an axonometric view. The two pixel axes map to ground directions 100.6° apart.
- The residuals are systematic, not random. The middle of the campus (blocks 9-20) is drawn much larger
  than the far end, and the gate forecourt is drawn as wide open space. **The illustration is not to
  scale and is partly schematic.** One global transform cannot place a pin to within one building.

**Local transform (moving least squares).** At each pin, an affine transform was fitted with Gaussian
weights on the control points (σ = 250 px). σ was chosen by leave-one-out among 250, 350 and 500 px,
with RMS of 47, 53 and 73 m respectively.

- Leave-one-out RMS **47.4 m**, max **98.4 m** (C14 by the gate).
- **Pins 1, 2, 3, 4, 6, 7 and 8 lie outside the convex hull of the control points**, at the gate end.
  Their projections are extrapolations, and check point C16 misses by 217 m. For these pins the search
  radius was widened to 250 m and the proximity weight halved. In practice, shape, road order and OSM
  names decide their candidates, not position.

**Pin base offset.** Pins are drawn on roofs, so 30 px was added to v (estimated from C5- and C13-type
pairs) before projecting.

## Step 3: candidates and scores

For each overview pin, the local transform gives a ground position. The search radius is the larger of
60 m and 1.5 × the locally weighted leave-one-out error of nearby control points (60-70 m inside the hull,
250 m outside). Footprints within the radius were reviewed by hand. So were footprints just outside it
when their shape clearly matched the transcriber's `shapeNotes`.

Each candidate has hand-made judgments, stored in scratch as `tools/judgments.py`:

- **shapeMatch**: `strong` / `partial` / `weak`. Compares the OSM outline with the drawing on wing count,
  curvature, wedge, H/U/L/comb shapes and relative size.
- **order** (0 / 0.5 / 1): does the candidate keep the same order as its numbered neighbours and the roads
  (for example gate fork → 2 → 1, or 41-44 in a row beside the large hall)?
- **levels** (0 / 0.5 / 1): does `building:levels` agree with the storeys drawn? 0.5 means no tag or no
  information.

The score is `0.35·proximity + 0.40·shape + 0.15·order + 0.10·levels`, capped at **0.85** so that it never
reads as certainty. Proximity is `max(0, 1 − d/R)`, halved for extrapolated pins. Shape values are 1.0,
0.55 and 0.2. For leads with **no overview pin** (5, 16, 19, 21A, 21B, 22, 23, 31, 52, 55), proximity is
replaced by a small hand value (0-0.5). That value reflects only the lead's relation to its neighbours
in a vignette or scene.

**Recommendation rule.**

- `confirm-on-site`: the top score is ≥ 0.6, it leads the next candidate by ≥ 0.15, **and** its shape match is `strong`.
- `no-plausible-footprint`: the top score is < 0.3, or no candidate is better than a `weak` shape.
- `ambiguous`: everything else.
- Two manual overrides, recorded in each lead's notes: 21A and 21B are kept as `ambiguous` (listed in the
  index, but no pin, so nothing can be placed).

**Detections.** For each pin, ML detections within min(2R, 120 m) that cover less than 20% OSM-mapped area
and are at least 150 m² are listed in the notes. Leads 10, 11, 21 and 55 also get one hand-picked
detection each. A lead whose best OSM candidate is weak "may have no OSM footprint".

## Step 4: outputs

- `block-candidates.json`: an array of `{block, leadNames, candidates:[{osmId, score, distanceM, shapeMatch, reasons, conflicts}], recommendation, notes}`.
  `distanceM` is from the projected pin to the footprint edge (0 = inside). It is `null` when there is no overview pin.
  `notes` holds the projected lon/lat, the local error, the search radius, lead conflicts, nearby detections,
  any priority flag (hostel / agriculture / cafe) and what to check on site.
- `matching-fit.json`: control points, check points, residuals, fit parameters and per-pin projections.
- `candidates-overview.png`: our own north-up rendering of the OSM footprints, roads and landuse, with the
  detection outlines that leads cite. Each footprint is labelled with the block numbers proposed for it and
  coloured by confidence. **It contains no Behance pixels.** Data © OpenStreetMap contributors (ODbL).
  It was drawn as inline SVG and rasterised with Playwright Chromium.
- `CANDIDATES.md`: the per-block table, plus what the owner should check on site.

## Limits

- Pixel positions were read by eye (±10 px, about ±5-10 m on the ground). This is small next to the
  transform error.
- The shape judgments are opinions made from the transcriber's notes and the overview drawing. Several
  blocks are drawn as wings of one OSM way (25-29, 36-38, 48/49, the 53/54 complex and the 30-34 front
  comb). Per-wing numbers need a site visit, and possibly a split of the OSM way.
- The illustration's own sources disagree for 13, 19-21, 29-33, 37, 38, 55 and 56. Matching
  does not resolve those disagreements, and the official cross-check (OFFICIAL_CROSSCHECK.md) settles only 13, 32, 35 and 37 as
  number ↔ function pairs, without locations.
- OSM names on `way/354743583` ("Lovely Institute Of Management"), `way/354755644` ("Lovely Institute of
  Technology") and `way/354830243` ("Lovely Institute of Pharmacy") are community data. Only the last one
  agrees with the illustration (index row PHARMACY 4,7).

## Reproducing

The scripts are in scratch (`…/scratchpad/block-leads/match/tools/`). They are not part of the repo:

- `fit.py`: control points and the fits.
- `project.py`: pin projection.
- `detov.py`: detection overlap with OSM.
- `judgments.py`: the hand judgments.
- `build.py`: writes the JSON outputs.
- `review.py` and `shot.js`: the PNG.
- `gen_md.py`: CANDIDATES.md.

`crop.js` made the gridded viewing crops of the overview. Those crops stay in scratch and must not be
copied into the repo.
