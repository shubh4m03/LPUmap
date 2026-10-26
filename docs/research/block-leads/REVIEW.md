# Adversarial review of the block-number candidates

> **Status: review items for the owner, not applied data.** This review tried to break every
> `confirm-on-site` and every high-scoring candidate in [`block-candidates.json`](block-candidates.json).
> Block numbers come from the campus illustration ("LPU isometric map design", first studied from Behance;
> owner-supplied since 2026-10-24, see [`LPU_ISOMETRIC_ASSET_INTEGRATION.md`](../../LPU_ISOMETRIC_ASSET_INTEGRATION.md)). Under
> the owner's rules, the illustration cannot by itself name, number or position a footprint, and an
> official block number may never be inferred from location or appearance alone. **No candidate in this
> folder is verified.** "Keep" below means only that the candidate is still worth a site check. It does
> not mean the number is right.

Reviewed: 2026-10-24. Reviewer tag in the JSON: `"reviewedBy": "adversarial-check"`. The checklist that
results from this review is [`OWNER_CHECKLIST.md`](OWNER_CHECKLIST.md).

## Result in one paragraph

The fit statistics the matcher reported are correct; I recomputed them and they reproduce. They do not
support the confidence the first pass gave to proximity, though. Once the four building landmarks that
also carry leads are taken out of the fit, the position error at those buildings is 39-57 m. That is the
same as the median spacing between campus buildings (51 m). Position therefore cannot pick a building, and
every candidate now has to stand on shape, topology or an independent source.

- **Before:** 24 confirm-on-site, 25 ambiguous, 6 no-footprint. Top score 0.85.
- **After:** 19 confirm-on-site, 30 ambiguous, 6 no-footprint. Top score 0.80.
- **21 leads downgraded, 34 kept, none rejected outright.**
- **Recommendation changed:** 1, 36, 38, 42 and 43 moved from confirm-on-site to ambiguous. The top
  candidate changed for 9: `way/422437902` replaced `way/422437904`.
- **Scores lowered but recommendation kept:** every other confirm-on-site lead, and the proximity-driven
  ambiguous leads 9, 12, 14, 30-34, 41 and 53-58.

## Inputs and isolation

- **OSM data.** I used the matcher's snapshot of `public/data/{buildings,basemap,boundary,detections}.geojson`,
  copied to my scratch folder. The `buildings.geojson` sha256 is `a5ee6d00…954a`, the same as the matcher's.
  At review time the live working copy had the same hashes for all four files, so it was not mid-rebuild.
  Repo HEAD is `902af56`. Water-tower and junction nodes came from `data/raw/osm/campus-bbox.osm`, read only.
- **Illustration.** `reference/assets/behance-slides/slide-28.jpg`, slide-12 and slide-17 were viewed, and
  8 control points plus 4 areas were cropped to check positions by eye. **The crops stay in scratch.**
- **Isolation.** I wrote nothing under `src/`, `scripts/`, `data/`, `public/`, `tests/` or `server/`. I made
  no network requests and no commit.
- **Re-implementation.** The review scripts are my own (`…/scratchpad/block-leads/review/tools/`:
  `rgeo.py`, `rfit.py`, `rpins.py`, `rshape.py`, `apply_review.py`). They use a different local projection
  (a spherical tangent plane rather than the matcher's constants) and recompute every control-point ground
  position from the OSM ids.

## 1. Is the control-point fit actually good?

**The ground coordinates reproduce.** All 17 control and check points were recomputed from their OSM ids.
They agree with the matcher's values to within 0.8-4.7 m (mean about 2.8 m). The four junction islands
are compact: their roundabout arcs span 16-19 m.

**The pixel coordinates reproduce.** I cropped slide-28 around C1, C4, C5, C6, C7, C8, C10 and C13. Each
crosshair sits on the feature the matcher named: the oval centre, the base of the water tower, the large
hall, the bowl, the walkway roundabout, the pavilion roof, the island between 15 and 12, and the tower by 53. The agreement is within roughly 10-20 px.

**Residuals recomputed with several models** (15 control points, metres):

| Model                             | RMS   | Max   | LOO RMS  | LOO median | LOO max  | C16 check | C17 check |
| --------------------------------- | ----- | ----- | -------- | ---------- | -------- | --------- | --------- |
| Similarity (4 parameters)         | 134.7 | 246.1 | 153.0    | 137.9      | 265.5    | 240.2     | 118.0     |
| Affine (6)                        | 104.1 | 178.5 | 130.5    | 123.8      | 201.7    | 207.4     | 61.6      |
| Homography (8)                    | 69.4  | 131.2 | 114.6    | 83.1       | 285.3    | 145.5     | 19.8      |
| Local MLS, σ 150 px               | 16.0  | 40.3  | 63.7     | 55.5       | 153.8    | 317.8     | 55.3      |
| **Local MLS, σ 250 px (matcher)** | 21.9  | 49.6  | **47.6** | 35.3       | **98.5** | **216.5** | 49.8      |
| Local MLS, σ 350 px               | 28.7  | 56.8  | 53.6     | 47.9       | 90.9     | 239.1     | 41.8      |
| Thin-plate spline, λ 0.5          | 32.6  | 57.2  | 63.0     | 49.8       | 100.0    | 224.4     | 11.7      |

(LOO = leave-one-out: the error at each point when that point is left out of the fit.)

- The matcher's numbers reproduce: affine 103.7 vs 104.1 m, and MLS leave-one-out 47.4 vs 47.6 m.
- σ was chosen by leave-one-out on the same 15 points, so 47 m is slightly optimistic. Adding ±10 px of
  reading noise to the pixel positions gives a leave-one-out RMS of 42-65 m (mean 53 m) over 30 trials.
- No model rescues C16, the held-out check point by the pin-2 forecourt: it misses by 146-318 m. **The
  gate end of the drawing (pins 1-8) is schematic, and its positions carry no weight.**

**Circularity.** C5, C6, C8 and C12 are buildings that also carry leads (47, 35, 16 and 55-57). I refitted
without all four and measured the error at each one:

| Held out         | Lead  | Error (MLS σ 250) | Error (affine) |
| ---------------- | ----- | ----------------- | -------------- |
| C5 large hall    | 47    | 49.7 m            | 46.1 m         |
| C6 bowl          | 35    | 56.9 m            | 28.7 m         |
| C8 pavilion roof | 16    | 39.3 m            | 124.1 m        |
| C12 crescent     | 55-57 | 52.7 m            | 161.6 m        |

**Position against building spacing.** For the 56 footprints of at least 300 m², the median
centroid-to-nearest-centroid distance is **50.9 m** (p25 34.5 m, p75 68.5 m). An error of about 48-53 m
equals one building spacing, so **a "projection falls inside" result is worth little by itself.** Each
lead's `review.nonCircularProjection` in the JSON gives the rank and distance of the pre-review top
candidate, with the pin re-projected without C5, C6, C8 and C12. Ranks count from 0, which is the nearest
footprint. Notable cases:

- Pins 35, 37 and 38 all land **inside or at the edge of the comb `way/422823421`**, the 25-29 row. The bowl
  ranks 6th for pin 35 (54 m), and the V ranks 5th for pin 36 (20 m).
- Pin 15 lands inside the pavilion `way/422823431`. The wedge is 14 m away.
- Pin 2 lands nearer to the star building `way/354743583` (48 m) than pin 1 does (245 m).

## 2. Do the shape claims hold against OSM geometry?

I computed each candidate's metrics directly from the outlines: area, inner rings, solidity (area ÷ convex
hull area), reflex vertices, concave pockets of at least 25 m², the minimum rotated rectangle, and blob
counts after eroding the outline by 4 m and 7 m on a 0.5 m raster. Blob counts approximate the number of
"towers" or "wings". The table also checks whether each claimed feature is unique across all 131
footprints.

| Claim (matcher)                                         | OSM measurement                                                                                     | Unique on campus?                                                                                 | Holds?                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 13 = courtyard square, `relation/7099162`               | 46 × 41 m, **1 inner ring**, front stub                                                             | **Yes**: the only footprint with an inner ring                                                    | Yes                                                                                 |
| 15 = tapering wedge with rounded end, `way/422437885`   | Convex, 150 × 33 m, width about 35 m → 10 m, rounded east corner                                    | Only one other elongated convex footprint over 1 500 m² (`way/422547443`), which is a uniform bar | Yes                                                                                 |
| 18 = H shape, `way/422437890`                           | 65 × 29 m, wider end blocks, but **4 pockets** (two south tabs and a north bump)                    | No                                                                                                | Partly (H-like, not a clean H)                                                      |
| 25-29 = five-unit comb, `way/422823421`                 | 195 × 55 m, **exactly 5 units** separated by paired notches (7 pockets)                             | Yes, at this size                                                                                 | Yes, as a row. Per-unit numbering is not tested                                     |
| 36-38 = V, `way/422556249`                              | 187 × 62 m, solidity 0.78, 3 large pockets; two arms run W and SSW from an apex that wraps the bowl | Yes                                                                                               | Yes, as a whole. Which arm is 36 or 38 depends on reading the drawing's orientation |
| 35 = fan bowl, `way/422556250`                          | Quarter-circle, 940 m²                                                                              | Yes                                                                                               | Yes                                                                                 |
| 4 = sawtooth bar, `way/354830243`                       | Diagonal bar, sawtooth of 4-5 teeth, hooked NW wing (4 blobs after a 7 m erosion)                   | Yes                                                                                               | Yes. The "wider plain wing" is narrow in OSM                                        |
| 1 = star / cross, `way/354743583`                       | 56 × 52 m, 4 pockets, solidity 0.76, zigzag south edge                                              | Yes                                                                                               | Yes. **The OSM name conflicts**                                                     |
| 45 = three linked slabs, `way/422548300`                | **3 blobs** after erosion, 4 pockets                                                                | **Yes**: the only 3-blob footprint                                                                | Yes                                                                                 |
| 48/49 = chain of ~6 towers, `way/422548297`             | **6 blobs** after erosion                                                                           | Only 6-blob footprint                                                                             | Yes                                                                                 |
| 51 = chain of 5 towers, `way/422548298`                 | **5 blobs** after erosion                                                                           | Only 5-blob footprint                                                                             | Yes. This separates the 51 chain from the 48/49 chain                               |
| 50 = single tower, `way/422548299`                      | 40 × 26 m, solidity 0.95                                                                            | No (generic)                                                                                      | Weak. Position and the dead-end setting decide                                      |
| 47 = huge hall, `way/422737297`                         | 119 × 86 m rectangle, 10 171 m² (2nd largest)                                                       | Yes, by size                                                                                      | Yes                                                                                 |
| 16 = pavilion, `way/422823431`                          | Irregular pentagon, 12 794 m² (largest)                                                             | Yes, by size                                                                                      | Yes. The name is inferred                                                           |
| 42/43/44 = separate slabs 895/896/897                   | 895 and 896 are **identical** 46 × 19 m rectangles; **897 is two masses joined by a link**          | No                                                                                                | **Contradiction**: see 41-44 below                                                  |
| 9 = largest U/E of its group, `way/422437904`           | 896 m² **T-shape**. The neighbour `way/422437902` is a 1 494 m² **U**                               | No                                                                                                | **No**: `way/422437902` fits 9 better                                               |
| 12 = compact stepped block, `way/422437902`             | Largest U in the group                                                                              | No                                                                                                | **No**                                                                              |
| 56/57/58 crescent wedges, `way/422547448`, `450`, `452` | Three near-identical wedges, 1 421-1 448 m², 54 × 28-30 m, all 9 levels                             | No                                                                                                | Shape cannot discriminate                                                           |
| 53/54 end slabs, `way/422323508`, `422547447`           | Four slabs of 1 267-1 310 m² around the spine, 30-45 m apart                                        | No                                                                                                | Shape cannot discriminate                                                           |

## 3. Could the illustration be outdated?

The Behance project is undated. Its gallery id (105159145) hints at a date of roughly 2020, but that is
not established and should not be relied on. Evidence from the data:

- **Most candidate footprints were first mapped in June 2016.** OSM way ids 4224xxxxx-4258xxxxx were
  created by an import-era mapper, so these buildings predate any plausible illustration date. Many
  were re-edited on 2026-10-09 (versions 3-4). Their current outlines are therefore recent, but their
  existence is old.
- **Later OSM ways that the illustration does not show:**
  - `way/1550425052`: a U-shaped building of 1 402 m² beside the 41-44 slabs. It is absent from the
    apartments vignette and from the overview's apartment group.
  - `way/1566888543`: 316 m², next to the bowl.

  Each is either newer than the illustration or simply not drawn. Either way, the drawing's building
  counts in those groups may be out of date.

- **ML detections that the drawing does not show.** `det:microsoft-ml:237943d699feee6c` (663 m²) sits in
  the notch between the two arms of the V. The drawing shows open ground there.
- **The reverse case.** The drawing shows buildings that OSM lacks: the 6-7-8 complex and the west side
  of the girls-hostel group. ML detections confirm buildings in both places. Here OSM is out of date, not
  the drawing.
- **Function drift.** The OSM names at the gate end are "Lovely Institute Of Management / Technology /
  Pharmacy". For pins 1 and 3 they disagree with the captions. Either the functions moved, or the OSM
  names, the captions or the matching are wrong. A sign check on site settles it.

## 4. Contradictions found

1. **41-44 (internal contradiction in the first pass).** The matcher's reason for 44 says
   `way/422437897` is "the vignette's linked 43-44", yet it placed 43 on the separate `way/422437896` and
   marked 42, 43 and 44 confirm-on-site.
   - **Reading A** (the matcher): 41 = `894`, 42 = `895`, 43 = `896`, 44 = `897`. Supported by the overview,
     which draws pin 41 beside round grey tanks; `894` is the slab next to the OSM tank footprints.
   - **Reading B**: 41 = `895`, 42 = `896`, 43 + 44 = `897`. Supported by the vignette (slide-17), which
     draws 41 and 42 as separate slabs and 43-44 as one linked pair.

   Neither reading wins. **44 is on `897` in both readings**, so it stays confirm-on-site at 0.70; 41, 42
   and 43 are ambiguous.

2. **9 vs 12.** The drawing's "largest, broad U/E" description of 9 fits `way/422437902`, the matcher's top
   candidate for **12**. 9's previous top, `way/422437904`, is a smaller T-shape. Both pins project onto
   `way/422437902` within the position error.
3. **1.** The cross shape matches, but the OSM name "Lovely Institute Of Management" contradicts SCHOOL OF
   FASHION. The pin is extrapolated by about 245 m.
4. **4 vs 7.** The OSM name "Lovely Institute of Pharmacy" supports pharmacy, and the index gives PHARMACY
   to both 4 and 7. The name therefore does not support 4 over 7.
5. **36 / 38.** Which arm is which depends only on the drawing's orientation. Both pins project nearer
   other footprints than the V.
6. **29-32 and 33/38, 55/56.** These are the vignette-vs-index numbering disagreements already noted in
   `block-leads.json`. Matching does not resolve them, and three leads (30, 31 and 32) compete for one
   footprint, `way/422823423`.

## 5. Verdict per candidate

Columns: pre-review recommendation and top score; post-review recommendation and top score; the
post-review top candidate; the verdict; and, for leads with an overview pin, the rank and distance (m) of
the **pre-review** top candidate when the pin is re-projected without the circular control points. The
reasons for each lead are in `block-candidates.json` under `review.reasons`, and in
[`CANDIDATES.md`](CANDIDATES.md) under each block.

| Block | Before               | After                | Top candidate (after)                  | Verdict            | Non-circular rank / dist. |
| ----- | -------------------- | -------------------- | -------------------------------------- | ------------------ | ------------------------- |
| 1     | confirm-on-site 0.6  | ambiguous 0.5        | `way/354743583`                        | downgrade          | 0 / 244.8                 |
| 2     | ambiguous 0.56       | ambiguous 0.56       | `way/427330237`                        | keep               | 1 / 119.3                 |
| 3     | ambiguous 0.6        | ambiguous 0.55       | `way/354755644`                        | downgrade          | 0 / 0.0                   |
| 4     | confirm-on-site 0.82 | confirm-on-site 0.75 | `way/354830243`                        | keep               | 0 / 0.0                   |
| 5     | no footprint 0.31    | no footprint 0.31    | `way/422738980`                        | keep               | n/a                       |
| 6     | no footprint 0.26    | no footprint 0.26    | `way/425717556`                        | keep               | 8 / 174.2                 |
| 7     | no footprint 0.37    | no footprint 0.37    | `way/422437902`                        | keep               | 3 / 88.5                  |
| 8     | no footprint 0.35    | no footprint 0.35    | `way/425717556`                        | keep               | 1 / 45.6                  |
| 9     | ambiguous 0.8        | ambiguous 0.55       | `way/422437902` (was `422437904`)      | downgrade          | 1 / 12.8                  |
| 10    | no footprint 0.26    | no footprint 0.26    | `way/422437902`                        | keep               | 5 / 133.8                 |
| 11    | ambiguous 0.4        | ambiguous 0.4        | `way/422437904`                        | keep               | 5 / 134.9                 |
| 12    | ambiguous 0.8        | ambiguous 0.45       | `way/422437902`                        | downgrade          | 0 / 0.6                   |
| 13    | confirm-on-site 0.85 | confirm-on-site 0.8  | `relation/7099162`                     | keep               | 0 / 3.3                   |
| 14    | ambiguous 0.82       | ambiguous 0.65       | `way/422437887`                        | downgrade          | 0 / 0.0                   |
| 15    | confirm-on-site 0.85 | confirm-on-site 0.8  | `way/422437885`                        | keep               | 1 / 14.2                  |
| 16    | confirm-on-site 0.82 | confirm-on-site 0.7  | `way/422823431`                        | keep               | n/a (scene pin only)      |
| 18    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422437890`                        | keep               | 0 / 1.8                   |
| 19    | ambiguous 0.5        | ambiguous 0.5        | `way/422548856`                        | keep               | n/a                       |
| 20    | ambiguous 0.47       | ambiguous 0.47       | `way/422548858`                        | keep               | 0 / 84.6                  |
| 21    | ambiguous 0.47       | ambiguous 0.47       | `way/422548303`                        | keep               | 2 / 56.8                  |
| 21A   | ambiguous 0.18       | ambiguous 0.18       | `way/422548303`                        | keep               | n/a                       |
| 21B   | ambiguous 0.18       | ambiguous 0.18       | `way/422548303`                        | keep               | n/a                       |
| 22    | ambiguous 0.32       | ambiguous 0.32       | `way/422548303`                        | keep               | n/a                       |
| 23    | ambiguous 0.32       | ambiguous 0.32       | `way/422548304`                        | keep               | n/a                       |
| 25    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422823421`                        | keep (wing split)  | 0 / 0.0                   |
| 26    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422823421`                        | keep (wing split)  | 0 / 0.0                   |
| 27    | confirm-on-site 0.85 | confirm-on-site 0.7  | `way/422823421`                        | keep (wing split)  | 0 / 4.9                   |
| 28    | confirm-on-site 0.85 | confirm-on-site 0.7  | `way/422823421`                        | keep (wing split)  | 0 / 5.1                   |
| 29    | confirm-on-site 0.85 | confirm-on-site 0.7  | `way/422823421`                        | keep (wing split)  | 0 / 12.9                  |
| 30    | ambiguous 0.78       | ambiguous 0.55       | `way/422823423`                        | downgrade          | 0 / 15.3                  |
| 31    | ambiguous 0.54       | ambiguous 0.45       | `way/422823423`                        | downgrade          | n/a                       |
| 32    | ambiguous 0.82       | ambiguous 0.6        | `way/422823423`                        | downgrade          | 0 / 0.0                   |
| 33    | ambiguous 0.72       | ambiguous 0.55       | `way/422823420`                        | downgrade          | 2 / 25.6                  |
| 34    | ambiguous 0.75       | ambiguous 0.6        | `way/422823420`                        | downgrade          | 1 / 10.5                  |
| 35    | confirm-on-site 0.79 | confirm-on-site 0.7  | `way/422556250`                        | keep               | 5 / 53.6                  |
| 36    | confirm-on-site 0.85 | **ambiguous** 0.6    | `way/422556249`                        | downgrade          | 4 / 19.9                  |
| 37    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422556249`                        | keep (wing split)  | 1 / 13.8                  |
| 38    | confirm-on-site 0.85 | **ambiguous** 0.6    | `way/422556249`                        | downgrade          | 1 / 26.7                  |
| 41    | ambiguous 0.77       | ambiguous 0.45       | `way/422437894` (tie with `895`)       | downgrade          | 0 / 25.4                  |
| 42    | confirm-on-site 0.85 | **ambiguous** 0.5    | `way/422437895` (tie with `896`)       | downgrade          | 0 / 8.0                   |
| 43    | confirm-on-site 0.85 | **ambiguous** 0.5    | `way/422437896` (tie with `897`)       | downgrade          | 1 / 6.7                   |
| 44    | confirm-on-site 0.85 | confirm-on-site 0.7  | `way/422437897`                        | keep               | 0 / 0.0                   |
| 45    | confirm-on-site 0.85 | confirm-on-site 0.8  | `way/422548300`                        | keep               | 0 / 3.5                   |
| 47    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422737297`                        | keep               | 0 / 0.0                   |
| 48    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422548297`                        | keep (tower split) | 0 / 0.0                   |
| 49    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422548297`                        | keep (tower split) | 0 / 0.2                   |
| 50    | confirm-on-site 0.85 | confirm-on-site 0.75 | `way/422548299`                        | keep               | 0 / 0.0                   |
| 51    | confirm-on-site 0.85 | confirm-on-site 0.8  | `way/422548298`                        | keep               | 0 / 0.0                   |
| 52    | no footprint 0.21    | no footprint 0.21    | `way/422738863`                        | keep               | n/a                       |
| 53    | ambiguous 0.82       | ambiguous 0.5        | `way/422323508` (tie)                  | downgrade          | 0 / 0.0                   |
| 54    | ambiguous 0.82       | ambiguous 0.5        | `way/422547447` (tie)                  | downgrade          | 0 / 3.5                   |
| 55    | ambiguous 0.5        | ambiguous 0.4        | `way/422547449` (tie)                  | downgrade          | n/a                       |
| 56    | ambiguous 0.82       | ambiguous 0.45       | `way/422547448` (tie)                  | downgrade          | 0 / 17.0                  |
| 57    | ambiguous 0.82       | ambiguous 0.45       | `way/422547450` (tie)                  | downgrade          | 4 / 32.0                  |
| 58    | ambiguous 0.6        | ambiguous 0.35       | `way/422547452` (tie with `422551921`) | downgrade          | 5 / 50.1                  |

**Why there are no outright rejections.** Every downgraded top candidate still has at least one
supporting fact that does not come from position: a shape feature, a road-order argument or an OSM name.
Each one also stays in a list of alternatives. The weakest, 58's `way/422547452`, is now tied with
`way/422551921` at 0.35.

**Alternatives capped.** Where an alternative's score came almost entirely from proximity, I capped it so
that it does not outrank the reviewed top candidate: 9, 14, 15, 30, 32-35, 53, 54 and 56-58. Every change
is listed in that lead's `review.changes`.

## 6. Compliance checks on the outputs

- **No Behance pixels.**
  - `candidates-overview.png` was **regenerated** from our own SVG drawing of the OSM snapshot, with the
    reviewed colours and scores, using the matcher's renderer copied to scratch, and screenshotted with
    Playwright Chromium. The page route blocks every non-`file:` request.
  - The source HTML contains no `<img>`, no `data:image` and no slide reference (0 matches).
  - The PNG holds only `IHDR`, `IDAT` and `IEND` chunks: no embedded text or EXIF.
  - The slide crops I made to check pixel positions are in scratch only.
- **No personal data.**
  - A regex search of every file in this folder for e-mail addresses, OSM user names and uids, and local
    account names found nothing.
  - OSM mapper names seen in the raw `.osm` file were not copied.
- **No wording presents a candidate as verified.**
  - Three check instructions read "Confirm the bowl / courtyard / apex is Block N (official: …)". They now
    read "Check whether … is signed Block N. The official page ties Block N to … (number and function
    only; it places nothing)."
  - `CANDIDATES.md` and `MATCHING_METHOD.md` now carry a post-review banner.
  - All scores are 0.80 or less.
- **Factual captions only.** No artwork is described beyond the shape notes already in `block-leads.json`,
  and no caption was newly quoted.

## 7. Files changed by this review

- `block-candidates.json`: scores, recommendations, candidate order (9), and `reviewedBy` plus a `review`
  object (verdict, previous recommendation and score, changes, reasons, non-circular projection) on all 55
  entries. Still a plain array, and every original key is kept.
- `CANDIDATES.md`: regenerated with the reviewed values, plus a review line per block.
- `candidates-overview.png`: regenerated with the reviewed colours and scores.
- `MATCHING_METHOD.md`: a post-review note only. The method text is unchanged.
- New: `REVIEW.md` (this file) and `OWNER_CHECKLIST.md`.

The pre-review copies are in scratch:
`…/scratchpad/block-leads/review/block-candidates.before-review.json` (sha256 `3998d88c…7356`),
`CANDIDATES.before-review.md` and `candidates-overview.before-review.png`.
