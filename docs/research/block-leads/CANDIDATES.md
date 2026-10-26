# Block-number candidates for owner confirmation

> **Status: review items, not applied data.** Each row proposes OSM footprints that _might_ carry a block number taken from the campus illustration ("LPU isometric map design", first studied from Behance; owner-supplied since 2026-10-24, see [`LPU_ISOMETRIC_ASSET_INTEGRATION.md`](../../LPU_ISOMETRIC_ASSET_INTEGRATION.md)). Nothing here names, numbers or positions a footprint on its own. A block number goes into the dataset only after the owner confirms it on site or from an official LPU source. Scores are relative and capped at 0.85 (after review, at most 0.80); they are not probabilities.

Inputs: `block-leads.json` (transcriber), the overview `slide-28.jpg` (pixel positions only), and our snapshot of `public/data/buildings.geojson`, `basemap.geojson`, `boundary.geojson` and `detections.geojson` (working copy, parsed; see `matching-fit.json` for hashes). Method: [`MATCHING_METHOD.md`](MATCHING_METHOD.md). Machine-readable: [`block-candidates.json`](block-candidates.json). Review sheet: [`candidates-overview.png`](candidates-overview.png) (our own drawing of OSM data).

> **Adversarial review applied (2026-10-24).** Scores and recommendations below are the reviewed values. Each block shows the review verdict (keep / downgrade) and the reasons. Full reasoning, independently recomputed residuals and shape checks are in [`REVIEW.md`](REVIEW.md), and the prioritised site checklist is [`OWNER_CHECKLIST.md`](OWNER_CHECKLIST.md). Before the review there were 24 confirm-on-site, 25 ambiguous and 6 no-footprint leads.

## Summary

- **55 leads**: 19 confirm-on-site, 30 ambiguous, 6 with no plausible OSM footprint.
- The illustration does **not** fit OSM with one affine transform: RMS 103.7 m, max 177.1 m over 15 control points. A local transform does better (leave-one-out RMS 47.4 m, max 98.4 m). Even so, position alone cannot pick between neighbouring buildings.
- Pins 1-8 (the gate end) lie outside the control points, so their positions are extrapolated. A held-out check point by the pin-2 forecourt misses by about 217 m. For these blocks, shape, road order and OSM names carry the weight.
- "Confirm on site" means one candidate clearly beats the others **and** its outline strongly resembles the drawing. It is still only a lead.

### Footprints that would carry more than one block

- `way/422823421` (five-wing comb): leads 25-29, one block per wing. The OSM way would need splitting.
- `way/422556249` (V-shaped): leads 36, 37 and 38. The official page puts the Central Library in Block 37.
- `way/422548297` (chain of towers): leads 48 and 49.
- `way/422437897` (two linked slabs): lead 44 in both readings, and also 43 in the alternative reading from the review (41 = way/422437895, 42 = way/422437896, 43+44 = way/422437897).
- `way/422823423` (trapezoid): leads 30, 31 and 32 compete for it.
- `way/422548303` and its cluster (ways 422548301-320): overview pin 21, index 21A/21B and vignette 22/23 all point here; these sources contradict each other.

### Control-point caveat

Leads 16 (open auditorium), 35 (bowl) and 47 (large hall) sit on footprints that were themselves used as control points C8, C6 and C5. Their small distances are therefore circular. The shape match is the real evidence for them, and the projection is not.

## Priority leads (hostel / agriculture / cafe stated explicitly)

| Block | Lead says                                              | Top candidate                                                | Score | Recommendation             |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------ | ----- | -------------------------- |
| 2     | cafe (Campus Cafe; Baldev Raj Auditorium)              | [way/427330237](https://www.openstreetmap.org/way/427330237) | 0.56  | Ambiguous                  |
| 9     | hostel (Girls Hostel 1 (number by caption order only)) | [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.55  | Ambiguous                  |
| 10    | hostel (Girls Hostel 2 (number by caption order only)) | [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.26  | No plausible OSM footprint |
| 11    | hostel (Girls Hostel 3 (number by caption order only)) | [way/422437904](https://www.openstreetmap.org/way/422437904) | 0.4   | Ambiguous                  |
| 12    | hostel (Girls Hostel 4 (number by caption order only)) | [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.45  | Ambiguous                  |
| 21A   | hostel (Girls Hostel 21A)                              | [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.18  | Ambiguous                  |
| 21B   | hostel (Girls Hostel 21B)                              | [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.18  | Ambiguous                  |
| 22    | hostel (Girls Hostel 5 (number by caption order only)) | [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.32  | Ambiguous                  |
| 23    | hostel (Girls Hostel 6 (number by caption order only)) | [way/422548304](https://www.openstreetmap.org/way/422548304) | 0.32  | Ambiguous                  |
| 25    | agriculture (School of Agriculture)                    | [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.75  | Confirm on site            |
| 26    | agriculture (School of Agriculture)                    | [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.75  | Confirm on site            |
| 45    | hostel (Boys Hostel 1)                                 | [way/422548300](https://www.openstreetmap.org/way/422548300) | 0.8   | Confirm on site            |
| 48    | hostel (Boys Hostel 2 (number by caption order only))  | [way/422548297](https://www.openstreetmap.org/way/422548297) | 0.75  | Confirm on site            |
| 49    | hostel (Boys Hostel 3 (number by caption order only))  | [way/422548297](https://www.openstreetmap.org/way/422548297) | 0.75  | Confirm on site            |
| 50    | hostel (Boys Hostel 7)                                 | [way/422548299](https://www.openstreetmap.org/way/422548299) | 0.75  | Confirm on site            |
| 51    | hostel (Boys Hostel (number not printed))              | [way/422548298](https://www.openstreetmap.org/way/422548298) | 0.8   | Confirm on site            |
| 52    | hostel (BOYS HOSTEL)                                   | [way/422738863](https://www.openstreetmap.org/way/422738863) | 0.21  | No plausible OSM footprint |
| 53    | hostel (Boys Hostel 5 (number by caption order only))  | [way/422323508](https://www.openstreetmap.org/way/422323508) | 0.5   | Ambiguous                  |
| 54    | hostel (Boys Hostel 6 (number by caption order only))  | [way/422547447](https://www.openstreetmap.org/way/422547447) | 0.5   | Ambiguous                  |

Block 15's lead also says "UNI-CENTER" (possibly food or retail), but it does not say canteen or cafe, so it is not flagged.

## Leads that seem to have no OSM footprint

The closest candidates for these leads are weak, too far away, or the wrong shape. Most of them sit next to building detections that are not in OSM (Microsoft ML footprints or Google Open Buildings points, from `public/data/detections.geojson`, unverified):

- **5** (no name): detections none nearby.
- **6** (School of Architecture & Planning; Division of Construction(s); Division of Architecture & Design): detections `det:microsoft-ml:bd716f75beca87c0` (111 m), `det:microsoft-ml:ccf4e041092ccbda` (116 m).
- **7** (Department of Pharmaceutical Science): detections `det:google-open-buildings:e06bf101099dfd90` (4 m), `det:microsoft-ml:4574c88ab06ec241` (31 m), `det:microsoft-ml:bd716f75beca87c0` (58 m).
- **8** (School of Fine Arts; School of Design (Multimedia); Animation): detections `det:microsoft-ml:4574c88ab06ec241` (28 m), `det:microsoft-ml:ccf4e041092ccbda` (35 m), `det:microsoft-ml:bd716f75beca87c0` (38 m).
- **10** (Girls Hostel 2 (number by caption order only)): detections `det:microsoft-ml:86ed1f8df9bfb0a4` (92 m).
- **52** (BOYS HOSTEL): detections none nearby.
- **6, 7, 8** (one connected complex in the drawing): the large unmapped outline `det:microsoft-ml:4574c88ab06ec241` (2 284 m2, no OSM overlap) and its neighbours `bd716f75beca87c0`, `ccf4e041092ccbda` and Google point `e06bf101099dfd90` are the most likely real buildings. OSM has only two tiny outlines there (ways 425717556/558).
- **21A, 21B, 22, 23** have no overview pin, so nothing places them. They score low for that reason, not because the OSM cluster is a bad shape match.
- **55** (mechanical engineering): the wedges of the curved group are plausible, but `det:microsoft-ml:6af6f6f5bb32fbd3` (1 890 m2, no OSM outline) lies next to the playing fields, which is where the PLAYGROUND scene puts 55.
- **10/11**: `det:microsoft-ml:86ed1f8df9bfb0a4` (1 303 m2, no OSM outline) is the unmapped building on the west side of the girls-hostel group.
- **21**: `det:microsoft-ml:8ec762527380d97e` (1 496 m2, no OSM outline) lies between the multi-tower cluster and the apartment slabs.

Never shown anywhere in the illustration, so there is nothing to match: 17, 24, 39, 40, 46.

## Per block

### 1 - School of Fashion

**Ambiguous** · top score 0.5 (low)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                                                                                                                                 | Against                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/354743583](https://www.openstreetmap.org/way/354743583) | 0.5   | 266.6     | strong | Star/cross-shaped outline with stepped edges, like the vignette's cross/zigzag-stepped roof; At the dead end of the tree-lined road that leaves the gate-side fork past the pin-2 forecourt, matching the drawn order gate fork -> 2 -> 1; building:levels=5; OSM: way/354743583, 1667 m2, building:levels=5, name='Lovely Institute Of Management' | OSM name is 'Lovely Institute Of Management'; the caption says SCHOOL OF FASHION (the OSM name may be historical); Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |
| [way/427330237](https://www.openstreetmap.org/way/427330237) | 0.21  | 341.3     | weak   | Next footprint along the same road; OSM: way/427330237, 938 m2, building:levels=2                                                                                                                                                                                                                                                                   | Long narrow bar, not a compact stepped block; better for block 2                                                                                                                                                                             |

**Adversarial review: downgrade** (was Confirm on site, top score 0.6). Position carries no weight: the pin is extrapolated and lands 245-267 m from the footprint, and held-out check point C16 by the pin-2 forecourt misses by 217 m. Independent re-projection without the 4 circular landmark control points puts the pin-2 projection nearer to way/354743583 (48 m) than the pin-1 projection (245 m); road order is the only positional argument left. The cross/zigzag shape is real in OSM (4 concave pockets, solidity 0.76), but an independent source contradicts the function: OSM name 'Lovely Institute Of Management' vs caption SCHOOL OF FASHION.

**Owner checks on site:** Is the star-shaped building at the end of the road past the auditorium forecourt signed Block 1 / School of Fashion?

### 2 - Campus Cafe; Baldev Raj Auditorium

**Ambiguous** · top score 0.56 (medium) · priority: cafe

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                                                                                                 | Against                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ----- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/427330237](https://www.openstreetmap.org/way/427330237) | 0.56  | 122.6     | partial | Long narrow low bar (building:levels=2), with a curved piece and a circular footprint at one end, like the vignette's low bar with a rounded end and a circular drum; Between the gate-side fork and the block-1 candidate, as drawn; OSM: way/427330237, 938 m2, building:levels=2 | The tall square tower drawn at one end has no separate OSM footprint; Check point C16 (the fan of green strips in front of this forecourt) misfits the transform by ~217 m, so this part of the drawing is very schematic; Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |
| [way/422732974](https://www.openstreetmap.org/way/422732974) | 0.55  | 138.9     | partial | Small circular footprint (building:levels=0.2) at the end of the bar; candidate for the drawn circular drum; OSM: way/422732974, 181 m2, building:levels=0.2                                                                                                                        | Probably part of block 2, not a separate block                                                                                                                                                                                                                                                                                                       |
| [way/427330238](https://www.openstreetmap.org/way/427330238) | 0.54  | 149.2     | partial | Curved piece (building:levels=0.2) between the bar and the circle; candidate for the drawn stepped terraces; OSM: way/427330238, 587 m2, building:levels=0.2                                                                                                                        | Probably part of block 2                                                                                                                                                                                                                                                                                                                             |

**Adversarial review: keep** (was Ambiguous, top score 0.56). Kept as ambiguous. The three top candidates (bar way/427330237, curved piece way/427330238, circle way/422732974) touch each other and together match the drawn bar + drum + terraces, so the open question is which part carries the number, not which building it is. All three ways were edited in 2026 (versions 2-4), so their outlines are recent.

Lead conflicts: Index lists only BALDEV RAJ AUDITORIUM for 2; 'Campus Cafe' appears only on the vignette.

**Owner checks on site:** Is the long low building with the round drum Block 2, and is it the Baldev Raj (Mittal) Auditorium and/or a campus cafe?

### 3 - School of Physiotherapy and Paramedical Science

**Ambiguous** · top score 0.55 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                       | Against                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/354755644](https://www.openstreetmap.org/way/354755644) | 0.55  | 0.0       | partial | Compact block next to the block-4 candidate on the gate side, as drawn; Projection falls inside it; OSM: way/354755644, 1574 m2, building:levels=7, name='Lovely Institute of Technology' | OSM name is 'Lovely Institute of Technology'; the caption says SCHOOL OF PHYSIOTHERAPY... (index PHYSIOTHERAPY 3); building:levels=7; the vignette draws a lower block; Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |
| [way/426283204](https://www.openstreetmap.org/way/426283204) | 0.45  | 13.1      | weak    | 7-level footprint overlapping way 354755644; OSM: way/426283204, 231 m2, building:levels=7                                                                                                | Probably part of the same building                                                                                                                                                                                                                                                                |
| [way/354830243](https://www.openstreetmap.org/way/354830243) | 0.37  | 15.4      | weak    | near the projected pin (see distanceM); OSM: way/354830243, 957 m2, building:levels=5, name='Lovely Institute of Pharmacy'                                                                | Shape fits block 4 better                                                                                                                                                                                                                                                                         |

**Adversarial review: downgrade** (was Ambiguous, top score 0.6). OSM name 'Lovely Institute of Technology' (7 levels) does not match the caption (physiotherapy), and the pin is extrapolated.

Nearby detections without an OSM outline: `det:microsoft-ml:7930d4c28310bfd2` (50 m), `det:google-open-buildings:e06bf101099dfd90` (109 m)

**Owner checks on site:** Which building next to the pharmacy block is signed Block 3 (physiotherapy)? Is way 426283204 part of it?

### 4 - School of Pharmaceutical Science

**Confirm on site** · top score 0.75 (higher)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                | Against                                                                                                                   |
| ------------------------------------------------------------ | ----- | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [way/354830243](https://www.openstreetmap.org/way/354830243) | 0.75  | 0.0       | strong | Front made of projecting bays (sawtooth in plan), like the vignette's comb of four bays with a wider end wing; Next to an OSM lawn (osm:way/422437884, 940 m2), consistent with the GARDEN AREA scene; OSM name 'Lovely Institute of Pharmacy' agrees with the index row PHARMACY 4,7 (OSM names are community data, not official); Projection falls inside it; OSM: way/354830243, 957 m2, building:levels=5, name='Lovely Institute of Pharmacy' | Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |
| [way/354755644](https://www.openstreetmap.org/way/354755644) | 0.36  | 27.5      | weak   | near the projected pin (see distanceM); OSM: way/354755644, 1574 m2, building:levels=7, name='Lovely Institute of Technology'                                                                                                                                                                                                                                                                                                                      | Compact shape; better for block 3                                                                                         |

**Adversarial review: keep** (was Confirm on site, top score 0.82). Shape holds in OSM: a diagonal bar with a sawtooth of 4-5 teeth on one side and a hooked wing at the NW end (4 blobs after a 7 m erosion). The OSM name 'Lovely Institute of Pharmacy' is independent of the illustration, but the index lists PHARMACY at 4 AND 7, so the name supports block 4 or 7 equally; only the drawing's sawtooth separates them. Lowered from 0.82 because the pin is extrapolated (outside the control hull).

Lead conflicts: Index groups PHARMACY under 4 and 7; slide-27 calls 7 'DEPARTMENT OF PHARMACEUTICAL SCIENCE' — consistent, but two numbers for one school.

Nearby detections without an OSM outline: `det:microsoft-ml:7930d4c28310bfd2` (64 m), `det:microsoft-ml:bd716f75beca87c0` (92 m), `det:google-open-buildings:e06bf101099dfd90` (99 m)

**Owner checks on site:** Is the building with the sawtooth front facing the lawn signed Block 4 (pharmaceutical sciences)?

### 5 - (no caption)

**No plausible OSM footprint** · top score 0.31 (low)

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                                                             | Against                                                                                    |
| ------------------------------------------------------------ | ----- | --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [way/422738980](https://www.openstreetmap.org/way/422738980) | 0.31  | n/a       | weak  | Small 1-level footprint across a road from the lawn beside the block-4 candidate; OSM: way/422738980, 242 m2, building:levels=1 | The scene shows only the corner of a red flat-roofed building; there is nothing to compare |
| [way/427330237](https://www.openstreetmap.org/way/427330237) | 0.31  | n/a       | weak  | Low building across the road from the same lawn; OSM: way/427330237, 938 m2, building:levels=2                                  | Better as block 2                                                                          |

**Adversarial review: keep** (was No plausible OSM footprint, top score 0.31). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: No caption anywhere; not in the overview index; no pin 5 on the overview (overview draws an unlabelled red block in a similar spot).

**Owner checks on site:** Find a building signed Block 5 near the garden by Block 4; none is identifiable from the drawing.

### 6 - School of Architecture & Planning; Division of Construction(s); Division of Architecture & Design

**No plausible OSM footprint** · top score 0.26 (low)

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                  | Against                                                                                                                                                                            |
| ------------------------------------------------------------ | ----- | --------- | ----- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/425717556](https://www.openstreetmap.org/way/425717556) | 0.26  | 172.3     | weak  | Nearest OSM footprint (about 20 m); OSM: way/425717556, 135 m2, building:levels=none | 135 m2: far too small for the large 6-7-8 complex drawn; Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |
| [way/425717558](https://www.openstreetmap.org/way/425717558) | 0.26  | 165.6     | weak  | Nearest OSM footprint; OSM: way/425717558, 57 m2, building:levels=none               | 57 m2: far too small                                                                                                                                                               |

**Adversarial review: keep** (was No plausible OSM footprint, top score 0.26). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Nearby detections without an OSM outline: `det:microsoft-ml:bd716f75beca87c0` (111 m), `det:microsoft-ml:ccf4e041092ccbda` (116 m)

**Owner checks on site:** Locate the large 6-7-8 complex; OSM has no outline there (Microsoft detection only). Note each wing's block sign.

### 7 - Department of Pharmaceutical Science

**No plausible OSM footprint** · top score 0.37 (low)

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                      | Against                                                                                                                                  |
| ------------------------------------------------------------ | ----- | --------- | ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.37  | 84.4      | weak  | near the projected pin (see distanceM); OSM: way/422437902, 1494 m2, building:levels=10  | Shape and setting fit girls hostel 9/12 better                                                                                           |
| [way/425717556](https://www.openstreetmap.org/way/425717556) | 0.33  | 78.3      | weak  | near the projected pin (see distanceM); OSM: way/425717556, 135 m2, building:levels=none | Far too small; Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |

**Adversarial review: keep** (was No plausible OSM footprint, top score 0.37). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Nearby detections without an OSM outline: `det:google-open-buildings:e06bf101099dfd90` (4 m), `det:microsoft-ml:4574c88ab06ec241` (31 m), `det:microsoft-ml:bd716f75beca87c0` (58 m)

**Owner checks on site:** As for 6: identify the middle wing's block sign.

### 8 - School of Fine Arts; School of Design (Multimedia); Animation

**No plausible OSM footprint** · top score 0.35 (low)

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                      | Against                                                                                                                                                                          |
| ------------------------------------------------------------ | ----- | --------- | ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/425717556](https://www.openstreetmap.org/way/425717556) | 0.35  | 41.2      | weak  | near the projected pin (see distanceM); OSM: way/425717556, 135 m2, building:levels=none | Far too small for the tallest wedge-roofed wing drawn; Pin lies outside the control-point hull (gate end); the projection is an extrapolation and its distance is weak evidence. |
| [way/425717558](https://www.openstreetmap.org/way/425717558) | 0.35  | 38.8      | weak  | near the projected pin (see distanceM); OSM: way/425717558, 57 m2, building:levels=none  | Far too small                                                                                                                                                                    |

**Adversarial review: keep** (was No plausible OSM footprint, top score 0.35). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Nearby detections without an OSM outline: `det:microsoft-ml:4574c88ab06ec241` (28 m), `det:microsoft-ml:ccf4e041092ccbda` (35 m), `det:microsoft-ml:bd716f75beca87c0` (38 m)

**Owner checks on site:** As for 6: identify the tall wedge-roofed wing's block sign.

### 9 - Girls Hostel 1 (number by caption order only)

**Ambiguous** · top score 0.55 (medium) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                                    | Against                                                                                                                          |
| ------------------------------------------------------------ | ----- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.55  | 14.5      | partial | Largest footprint of the group (1 494 m2, 10 levels), two wings joined at one end, like the vignette's broad U/E-shaped block; near the projected pin (see distanceM); OSM: way/422437902, 1494 m2, building:levels=10 | The central projecting stair tower drawn is not visible in the OSM outline                                                       |
| [way/422437904](https://www.openstreetmap.org/way/422437904) | 0.45  | 4.1       | partial | Projection falls 4 m from it; 10 levels; OSM: way/422437904, 896 m2, building:levels=10                                                                                                                                | Part of the stepped 'diamond' chain (with ways 422437906/908, 425716257-259) that matches the vignette's description of block 11 |
| [way/422437908](https://www.openstreetmap.org/way/422437908) | 0.45  | 25.3      | weak    | Small chain unit near the projected pin (see distanceM); OSM: way/422437908, 219 m2, building:levels=10                                                                                                                | Too small for the largest hostel                                                                                                 |

**Adversarial review: downgrade** (was Ambiguous, top score 0.8). Contradiction: the drawing makes 9 the LARGEST of the group with a broad U/E shape. OSM way/422437902 (1 494 m2, U-shape, 2 pockets) fits that; the previous top way/422437904 (896 m2, T-shape) does not. With the non-circular fit, pin 9 is nearest to way/422437902 (8 m), with way/422437904 at 13 m. way/422437902 is also the top candidate for 12, so 9 and 12 cannot both be right. Several unmapped ML outlines sit in this group, so OSM is incomplete here.

Lead conflicts: Caption pairs 'BLOCK- 09,10, 11,12' with 'GIRLS HOSTAL 1, 2, 3, 4' in parallel order; the per-block hostel number is implied by order, not stated.

Nearby detections without an OSM outline: `det:google-open-buildings:82e1bdb2014307de` (44 m), `det:microsoft-ml:a0daa64cb726ab78` (51 m), `det:microsoft-ml:1de0553df2a5be0c` (60 m)

**Owner checks on site:** Read the block signs on each building of the girls-hostel group (U-shaped block, diamond chain, unmapped block to the west).

### 10 - Girls Hostel 2 (number by caption order only)

**No plausible OSM footprint** · top score 0.26 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                      | Against                                                                                                                                    |
| ------------------------------------------------------------ | ----- | --------- | ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.26  | 132.3     | weak  | Nearest group footprint; OSM: way/422437902, 1494 m2, building:levels=10 | Projection lands near the projected pin (see distanceM), outside the campus boundary; the drawing puts 10 at the far side of the courtyard |

**Adversarial review: keep** (was No plausible OSM footprint, top score 0.26). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Caption pairs 'BLOCK- 09,10, 11,12' with 'GIRLS HOSTAL 1, 2, 3, 4' in parallel order; the per-block hostel number is implied by order, not stated.

Nearby detections without an OSM outline: `det:microsoft-ml:86ed1f8df9bfb0a4` (92 m)

**Owner checks on site:** Find Block 10; the drawn position has no OSM outline (Microsoft detection nearby).

### 11 - Girls Hostel 3 (number by caption order only)

**Ambiguous** · top score 0.4 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                               | Against                                                                                                                                      |
| ------------------------------------------------------------ | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422437904](https://www.openstreetmap.org/way/422437904) | 0.4   | 130.0     | partial | With ways 422437906/908 and 425716257-259 it forms a chain of small square units stepping diagonally, like the vignette's 'chain of linked cubes'; OSM: way/422437904, 896 m2, building:levels=10 | The projection of pin 11 lands about 150 m west of this chain; by position the chain sits where pin 9 projects (shape and position disagree) |
| [way/422437885](https://www.openstreetmap.org/way/422437885) | 0.33  | 47.9      | weak    | Closest OSM footprint to the projection (about 24 m); OSM: way/422437885, 3386 m2, building:levels=10                                                                                             | Long tapering wedge; fits block 15 much better                                                                                               |

**Adversarial review: keep** (was Ambiguous, top score 0.4). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Caption pairs 'BLOCK- 09,10, 11,12' with 'GIRLS HOSTAL 1, 2, 3, 4' in parallel order; the per-block hostel number is implied by order, not stated.

Nearby detections without an OSM outline: `det:microsoft-ml:86ed1f8df9bfb0a4` (78 m), `det:microsoft-ml:4f271a5f250ef404` (118 m)

**Owner checks on site:** Is the diamond-shaped chain Block 11, or Block 9?

### 12 - Girls Hostel 4 (number by caption order only)

**Ambiguous** · top score 0.45 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                  | Against                                                                                    |
| ------------------------------------------------------------ | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| [way/422437902](https://www.openstreetmap.org/way/422437902) | 0.45  | 2.6       | partial | Projection falls inside (3 m); next to the junction island used as C10, where the vignette places 12 at the corner of the enclosure; OSM: way/422437902, 1494 m2, building:levels=10 | The vignette draws 12 as a compact block with a stepped roof; this outline is a two-wing U |
| [way/422437885](https://www.openstreetmap.org/way/422437885) | 0.27  | 58.0      | weak    | near the projected pin (see distanceM); OSM: way/422437885, 3386 m2, building:levels=10                                                                                              | Wedge shape fits block 15                                                                  |

**Adversarial review: downgrade** (was Ambiguous, top score 0.8). way/422437902 is the largest U-shaped block in the group. That fits the drawn shape of 9, not the 'compact block with stepped roof' of 12. Both pins project onto it within the ~48 m position error.

Lead conflicts: Caption pairs 'BLOCK- 09,10, 11,12' with 'GIRLS HOSTAL 1, 2, 3, 4' in parallel order; the per-block hostel number is implied by order, not stated.

Nearby detections without an OSM outline: `det:google-open-buildings:82e1bdb2014307de` (8 m), `det:microsoft-ml:4f271a5f250ef404` (41 m), `det:microsoft-ml:1de0553df2a5be0c` (52 m)

**Owner checks on site:** Which girls-hostel building is signed 12?

### 13 - Division of Student Welfare

**Confirm on site** · top score 0.8 (higher)

| Candidate                                                          | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Against                          |
| ------------------------------------------------------------------ | ----- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [relation/7099162](https://www.openstreetmap.org/relation/7099162) | 0.8   | 0.0       | strong | Square footprint with a central open courtyard (OSM relation with an inner ring), like the vignette's square box around an open atrium; Close to the projected pin (see distanceM); across the main road from the open-auditorium footprint, as drawn; An official LPU page says Block 13 houses the Student Welfare Wing (OFFICIAL_CROSSCHECK.md); that pairs the number with a function but places nothing; OSM: relation/7099162, 1409 m2, building:levels=10 | The index also lists BUSINESS 13 |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Checked: relation/7099162 is the ONLY footprint in the dataset with an inner ring (courtyard). It is a 46 x 41 m square with a front stub, like the drawn courtyard box with an entrance platform. The pin projects 3 m away even without the circular control points. The next footprint is 56 m away, about one position error, so shape is what decides. An official page ties Block 13 to the Student Welfare Wing (function only). Lowered to 0.80 so it does not read as certain.

Lead conflicts: Index EDUCATION list has 'BUSINESS 13', but the slide-23 vignette calls 13 'DIVISION OF STUDENT WELFARE' (index ADMINISTRATIVE list also has 'STUDENT WELFARE 13') and slide-24 puts 'MITTAL SCHOOL OF BUSINESS' at BLOCK-14.

Nearby detections without an OSM outline: `det:google-open-buildings:c6bb467e2fde7e74` (60 m)

**Owner checks on site:** Check whether the courtyard building is signed Block 13. The official page ties Block 13 to the Student Welfare Wing (number and function only; it places nothing).

### 14 - Mittal School of Business

**Ambiguous** · top score 0.65 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                            | Against                                                                                                                                                                                                |
| ------------------------------------------------------------ | ----- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [way/422437887](https://www.openstreetmap.org/way/422437887) | 0.65  | 0.0       | partial | Projection falls inside; beside the block-13 candidate and across the road from the open auditorium, as drawn; OSM: way/422437887, 1818 m2, building:levels=11 | Trapezoid/wedge outline; the vignette draws a rectangular box with a sawtooth roof edge; Index has no row for 14; the vignette caption says MITTAL SCHOOL OF BUSINESS while the index says BUSINESS 13 |
| [way/422437888](https://www.openstreetmap.org/way/422437888) | 0.6   | 12.5      | partial | Attached to way 422437887 (10 levels); possibly the same building; OSM: way/422437888, 485 m2, building:levels=10                                              | -                                                                                                                                                                                                      |

**Adversarial review: downgrade** (was Ambiguous, top score 0.82). way/422437887 is a convex trapezoid, not the drawn rectangle with a sawtooth roof edge. The adjoining way/422437888 may be part of the same building. Block 14 is not in the overview index.

Lead conflicts: Block 14 does not appear in the overview index at all; the index assigns BUSINESS to 13.

Nearby detections without an OSM outline: `det:google-open-buildings:c6bb467e2fde7e74` (117 m)

**Owner checks on site:** Is the trapezoid building (and its annex) Block 14 / Mittal School of Business?

### 15 - Uni-Centre; School of Hotel Management and Tourism

**Confirm on site** · top score 0.8 (higher)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                                                                                             | Against                                                                                           |
| ------------------------------------------------------------ | ----- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [way/422437885](https://www.openstreetmap.org/way/422437885) | 0.8   | 19.5      | strong | Long tapering slab whose wide end is rounded, like the vignette's wedge with a rounded, glazed wide end; Runs along the open-auditorium footprint, which the scene shows it abutting; near the projected pin (see distanceM) (the pin is drawn on a tall roof); OSM: way/422437885, 3386 m2, building:levels=10 | Tagged in OSM as a building:part (isBuildingPart=true); check whether a parent outline is missing |
| [way/422823431](https://www.openstreetmap.org/way/422823431) | 0.55  | 0.0       | weak   | Projection falls inside; OSM: way/422823431, 12793 m2, building:levels=4                                                                                                                                                                                                                                        | This outline is the open-auditorium roof (lead 16)                                                |

**Adversarial review: keep** (was Confirm on site, top score 0.85). The alternative way/422823431 (the open-auditorium roof, weak shape match) was lowered from 0.68 to 0.55: its score came from the pin landing inside it, and position error here is ~48 m. Shape holds: way/422437885 is a convex wedge 150 x 33 m that narrows from about 35 m to about 10 m, with a rounded wide end, next to the largest roof (way/422823431). The pin itself lands inside way/422823431 (both fits); the wedge is 14 m away, so shape and adjacency decide, not position. 'Uni-Centre' has no official block number (the official page names 'Uni-Mall (Unicentre)' without one).

Lead conflicts: 'Uni-Center' is not in the index (index lists only HOTEL MANAGEMENT 15).

Nearby detections without an OSM outline: `det:google-open-buildings:c6bb467e2fde7e74` (62 m), `det:microsoft-ml:86ed1f8df9bfb0a4` (85 m), `det:microsoft-ml:2a977a674d1fccb3` (101 m)

**Owner checks on site:** Is the long wedge along the open auditorium Block 15 (Uni-Centre / hotel management)?

### 16 - (open auditorium — inferred only from the scene caption)

**Confirm on site** · top score 0.7 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                                             | Against                                                                                                                              |
| ------------------------------------------------------------ | ----- | --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [way/422823431](https://www.openstreetmap.org/way/422823431) | 0.7   | n/a       | strong | Largest footprint on campus (12 793 m2), irregular polygon, building:levels=4, like the very large irregular roof on columns; Adjoins the block-15 candidate, as in the OPEN AUDITORIUM AND SURROUNDINGS scene; OSM: way/422823431, 12793 m2, building:levels=4 | Used as control point C8, so its position is not independent evidence; No overview pin; the block number comes from a scene pin only |

**Adversarial review: keep** (was Confirm on site, top score 0.82). The largest footprint on campus (12 794 m2, irregular pentagon) matches the drawn pavilion. It was control point C8, so its distance is circular; with C8 held out, the fit misses by 39 m. The number comes only from a scene pin, and the 'open auditorium' name only from the scene caption. Lowered to 0.70.

Lead conflicts: No block caption; not in the overview index; the overview draws the same pavilion next to 15 but with no pin 16.

**Owner checks on site:** Is the large covered open auditorium numbered 16 at all? (Only a scene pin says so.)

### 18 - School of Social Science and Language; School of Physical Education; Department of Education

**Confirm on site** · top score 0.75 (higher)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                               | Against              |
| ------------------------------------------------------------ | ----- | --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [way/422437890](https://www.openstreetmap.org/way/422437890) | 0.75  | 0.0       | strong | H-shaped outline (two end blocks joined by a narrower bar), like the vignette's H-shape; Projection falls inside; beside the junction island used as C9, as drawn; OSM: way/422437890, 1466 m2, building:levels=6 | building:levels=6    |
| [way/425699179](https://www.openstreetmap.org/way/425699179) | 0.23  | 56.3      | weak   | Thin bar near the projected pin (see distanceM); OSM: way/425699179, 363 m2, building:levels=4                                                                                                                    | Shape does not match |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Partly holds: a bar with wider end blocks and a narrower middle (H-like), but with two tabs on the south side and a bump on the north side (4 concave pockets, not the 2 of a clean H). The pin lands 2 m away in both fits, and the next footprint is 51 m away. Lowered to 0.75.

Lead conflicts: Index names only EDUCATION for 18; vignette lists three units.

Nearby detections without an OSM outline: `det:microsoft-ml:2a977a674d1fccb3` (71 m)

**Owner checks on site:** Is the H-shaped building signed Block 18?

### 19 - School of Films, Journalism and Creative Arts; Performing Arts

**Ambiguous** · top score 0.5 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                  | Against                                                             |
| ------------------------------------------------------------ | ----- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [way/422548856](https://www.openstreetmap.org/way/422548856) | 0.5   | n/a       | partial | The 19/20/21 vignette draws one connected stepped chain with a quarter-circle corner; ways 422548856-858 form a stepped, curved L inside a loop road; OSM: way/422548856, 708 m2, building:levels=10 | No overview pin for 19; The overview pins 21 on a different cluster |
| [way/422548858](https://www.openstreetmap.org/way/422548858) | 0.5   | n/a       | partial | Curved (quarter-circle) piece of the same complex; OSM: way/422548858, 525 m2, building:levels=10                                                                                                    | The vignette ties the curved corner to pin 20, not 19               |
| [way/422548857](https://www.openstreetmap.org/way/422548857) | 0.5   | n/a       | partial | Third piece of the same complex; OSM: way/422548857, 754 m2, building:levels=10                                                                                                                      | -                                                                   |

**Adversarial review: keep** (was Ambiguous, top score 0.5). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Vignette: 19 = Films, Journalism and Creative Arts; index: 19 = PERFORMING ARTS and FILM & JOURNALISM = 20. | No pin 19 on the overview.

**Owner checks on site:** Which wing of the curved complex is signed 19?

### 20 - FILM & JOURNALISM; LAW

**Ambiguous** · top score 0.47 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                | Against                                                           |
| ------------------------------------------------------------ | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [way/422548858](https://www.openstreetmap.org/way/422548858) | 0.47  | 80.2      | partial | Quarter-circle piece of the stepped complex inside a loop road, like the vignette's rounded inner corner at pin 20; OSM: way/422548858, 525 m2, building:levels=10 | near the projected pin (see distanceM) (beyond the search radius) |
| [way/422548857](https://www.openstreetmap.org/way/422548857) | 0.47  | 82.0      | partial | Part of the same complex; OSM: way/422548857, 754 m2, building:levels=10                                                                                           | Overview describes an H-like building; OSM shows a curved L       |
| [way/422548856](https://www.openstreetmap.org/way/422548856) | 0.47  | 100.8     | partial | Part of the same complex; OSM: way/422548856, 708 m2, building:levels=10                                                                                           | -                                                                 |
| [way/422738883](https://www.openstreetmap.org/way/422738883) | 0.16  | 87.7      | weak    | 2-level footprint near the complex; OSM: way/422738883, 414 m2, building:levels=2                                                                                  | Too low for the multi-storey building drawn                       |

**Adversarial review: keep** (was Ambiguous, top score 0.47). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Index puts both FILM & JOURNALISM and LAW at 20; the slide-21 vignette puts film/journalism at 19 and law at 21 and gives 20 no caption.

**Owner checks on site:** Which wing of the curved complex is signed 20?

### 21 - School of Law

**Ambiguous** · top score 0.47 (low)

| Candidate                                                      | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                | Against                                                                                                                                                  |
| -------------------------------------------------------------- | ----- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422548303](https://www.openstreetmap.org/way/422548303)   | 0.47  | 60.2      | partial | The overview puts pin 21 on a cluster of linked multi-storey blocks across a road from pin 20; ways 422548301-320 form such a cluster (10 levels); OSM: way/422548303, 1174 m2, building:levels=10 | near the projected pin (see distanceM); The vignette caption makes 21 the School of Law inside the 19/20/21 complex; the index makes 21A/B girls hostels |
| [way/422548301](https://www.openstreetmap.org/way/422548301)   | 0.47  | 90.5      | partial | Part of the same cluster; OSM: way/422548301, 1063 m2, building:levels=10                                                                                                                          | -                                                                                                                                                        |
| [way/422548304](https://www.openstreetmap.org/way/422548304)   | 0.47  | 73.1      | partial | Part of the same cluster; OSM: way/422548304, 1101 m2, building:levels=10                                                                                                                          | -                                                                                                                                                        |
| [way/422437897](https://www.openstreetmap.org/way/422437897)   | 0.35  | 43.9      | weak    | near the projected pin (see distanceM); OSM: way/422437897, 2323 m2, building:levels=10                                                                                                            | Fits apartment block 43/44 better                                                                                                                        |
| [way/1550425052](https://www.openstreetmap.org/way/1550425052) | 0.34  | 36.3      | weak    | near the projected pin (see distanceM); OSM: way/1550425052, 1402 m2, building:levels=none                                                                                                         | U-shaped, no levels tag; not a multi-tower cluster                                                                                                       |

**Adversarial review: keep** (was Ambiguous, top score 0.47). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Index has LAW at 20, not 21. | Index RESIDENTIAL lists 'GIRLS HOSTEL ... 21A,B' — a hostel numbered 21A/21B — while the vignette makes 21 the School of Law. | Overview pin 21 sits on a cluster drawn like the residential blocks, physically separate from pin 20, whereas the vignette draws 19, 20 and 21 as one connected building.

Nearby detections without an OSM outline: `det:microsoft-ml:8ec762527380d97e` (57 m), `det:google-open-buildings:6684ec2de2a23a11` (66 m), `det:google-open-buildings:ca4cc0d8e3294c47` (69 m)

**Owner checks on site:** Is the 21 sign on the curved complex (law school) or on the hostel cluster across the road?

### 21A - Girls Hostel 21A

**Ambiguous** · top score 0.18 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                                             | Against                                                                                   |
| ------------------------------------------------------------ | ----- | --------- | ----- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.18  | n/a       | weak  | Residential-looking cluster where the overview's pin 21 stands; OSM: way/422548303, 1174 m2, building:levels=10 | No pin or caption for 21A at all; any link is by appearance only and must not be asserted |

**Adversarial review: keep** (was Ambiguous, top score 0.18). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Index-only; conflicts with slide-21 'BLOCK-21 SCHOOL OF LAW'. | Relationship to the vignette 'BLOCK-22,23 GIRLS HOSTAL 5, 6.' (which has no index entry and no overview pin) is unresolved.

**Owner checks on site:** Find the buildings signed 21A and 21B (girls hostels) and note which outline they occupy.

### 21B - Girls Hostel 21B

**Ambiguous** · top score 0.18 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                                             | Against                                                                                   |
| ------------------------------------------------------------ | ----- | --------- | ----- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.18  | n/a       | weak  | Residential-looking cluster where the overview's pin 21 stands; OSM: way/422548303, 1174 m2, building:levels=10 | No pin or caption for 21B at all; any link is by appearance only and must not be asserted |

**Adversarial review: keep** (was Ambiguous, top score 0.18). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Index-only; conflicts with slide-21 'BLOCK-21 SCHOOL OF LAW'. | Relationship to the vignette 'BLOCK-22,23 GIRLS HOSTAL 5, 6.' (which has no index entry and no overview pin) is unresolved.

**Owner checks on site:** See 21A.

### 22 - Girls Hostel 5 (number by caption order only)

**Ambiguous** · top score 0.32 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                                         | Against                                                                                              |
| ------------------------------------------------------------ | ----- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.32  | n/a       | partial | The vignette draws a rectangular perimeter of linked wings with cross-wings and two inner courts; ways 422548301-320 form a grid of linked 10-level blocks with two courts; OSM: way/422548303, 1174 m2, building:levels=10 | No overview pin for 22; The same cluster carries overview pin 21; numbers 22/23 are not in the index |
| [way/422548301](https://www.openstreetmap.org/way/422548301) | 0.32  | n/a       | partial | Part of the same cluster; OSM: way/422548301, 1063 m2, building:levels=10                                                                                                                                                   | -                                                                                                    |

**Adversarial review: keep** (was Ambiguous, top score 0.32). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Not in the overview index (index girls hostels: 9,10,11,12,21A,B); no pin 22/23 on the overview. | Caption pairs 22,23 with hostels 5,6 by order only.

**Owner checks on site:** Is the large courtyard cluster of linked blocks signed 22/23 (girls hostels 5, 6)?

### 23 - Girls Hostel 6 (number by caption order only)

**Ambiguous** · top score 0.32 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                 | Against                                                      |
| ------------------------------------------------------------ | ----- | --------- | ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [way/422548304](https://www.openstreetmap.org/way/422548304) | 0.32  | n/a       | partial | Second half of the same courtyard cluster (see 22); OSM: way/422548304, 1101 m2, building:levels=10 | No overview pin for 23; Same cluster carries overview pin 21 |
| [way/422548303](https://www.openstreetmap.org/way/422548303) | 0.32  | n/a       | partial | Part of the same cluster; OSM: way/422548303, 1174 m2, building:levels=10                           | -                                                            |

**Adversarial review: keep** (was Ambiguous, top score 0.32). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Not in the overview index (index girls hostels: 9,10,11,12,21A,B); no pin 22/23 on the overview. | Caption pairs 22,23 with hostels 5,6 by order only.

**Owner checks on site:** See 22.

### 25 - School of Agriculture

**Confirm on site** · top score 0.75 (higher) · priority: agriculture

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                           | Against                                                                                                                                       |
| ------------------------------------------------------------ | ----- | --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.75  | 0.0       | strong | Comb of five parallel wings joined along one side (8 200 m2, 10 levels), like the drawn diagonal row 25-29 with connectors; 25 projects onto the outer wing at the road bend; OSM: way/422823421, 8200 m2, building:levels=10 | One OSM way covers all five parallel wings drawn as 25-29; matching a single block needs the wing to be identified on site and the way split. |
| [way/422556249](https://www.openstreetmap.org/way/422556249) | 0.47  | 23.6      | weak   | near the projected pin (see distanceM); OSM: way/422556249, 5927 m2, building:levels=10                                                                                                                                       | V-shaped; fits 36-38                                                                                                                          |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Shape holds: way/422823421 has exactly 5 units separated by paired notches (7 concave pockets), matching the drawn row of 5 blocks (25-29). Its west end is at the road bend, as drawn for 25. Pins 25-29 AND pins 35, 37 and 38 all project into or next to this way (0-13 m), so position cannot tell the row from the V. The assignment rests on topology: the row is north of the V and the admin block 30-32 is at its east end. One OSM way would carry 5 block numbers, so per-unit numbers need a site check and a split of the way. Lowered to 0.75.

Nearby detections without an OSM outline: `det:microsoft-ml:237943d699feee6c` (92 m)

**Owner checks on site:** Count the wings of the five-wing comb from the road bend and note each block sign.

### 26 - School of Agriculture

**Confirm on site** · top score 0.75 (higher) · priority: agriculture

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                          | Against                                                                                                                                       |
| ------------------------------------------------------------ | ----- | --------- | ------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.75  | 0.0       | strong | Second wing of the five-wing comb, as drawn; OSM: way/422823421, 8200 m2, building:levels=10 | One OSM way covers all five parallel wings drawn as 25-29; matching a single block needs the wing to be identified on site and the way split. |
| [way/422556249](https://www.openstreetmap.org/way/422556249) | 0.42  | 32.1      | weak   | near the projected pin (see distanceM); OSM: way/422556249, 5927 m2, building:levels=10      | Fits 36-38                                                                                                                                    |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Shape holds: way/422823421 has exactly 5 units separated by paired notches (7 concave pockets), matching the drawn row of 5 blocks (25-29). Its west end is at the road bend, as drawn for 25. Pins 25-29 AND pins 35, 37 and 38 all project into or next to this way (0-13 m), so position cannot tell the row from the V. The assignment rests on topology: the row is north of the V and the admin block 30-32 is at its east end. One OSM way would carry 5 block numbers, so per-unit numbers need a site check and a split of the way. Lowered to 0.75.

Nearby detections without an OSM outline: `det:microsoft-ml:237943d699feee6c` (117 m)

**Owner checks on site:** See 25.

### 27 - School of Chemical Engineering and Physical Science

**Confirm on site** · top score 0.7 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                   | Against                                                                                                                                       |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.7   | 1.2       | strong | Third wing of the five-wing comb; OSM: way/422823421, 8200 m2, building:levels=10     | One OSM way covers all five parallel wings drawn as 25-29; matching a single block needs the wing to be identified on site and the way split. |
| [way/422556250](https://www.openstreetmap.org/way/422556250) | 0.14  | 60.4      | weak   | near the projected pin (see distanceM); OSM: way/422556250, 940 m2, building:levels=4 | Auditorium bowl                                                                                                                               |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Same comb as 25/26. A middle unit is placed only by counting from the end, so it is weaker than the end units. Lowered to 0.70.

Lead conflicts: Index omits Chemical Engineering (lists PHYSICAL SCIENCE only).

**Owner checks on site:** See 25.

### 28 - School of Bioengineering and Biosciences; Biotechnology

**Confirm on site** · top score 0.7 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                     | Against                                                                                                                                       |
| ------------------------------------------------------------ | ----- | --------- | ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.7   | 0.0       | strong | Fourth wing of the five-wing comb; OSM: way/422823421, 8200 m2, building:levels=10      | One OSM way covers all five parallel wings drawn as 25-29; matching a single block needs the wing to be identified on site and the way split. |
| [way/422823423](https://www.openstreetmap.org/way/422823423) | 0.27  | 60.9      | weak   | near the projected pin (see distanceM); OSM: way/422823423, 1584 m2, building:levels=10 | -                                                                                                                                             |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Same comb as 25/26. A middle unit is placed only by counting from the end, so it is weaker than the end units. Lowered to 0.70.

**Owner checks on site:** See 25.

### 29 - Office of the Pro-Chancellor; Administration-II

**Confirm on site** · top score 0.7 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                     | Against                                                                                                                                       |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.7   | 0.0       | strong | Last wing of the comb, facing the open plaza, as drawn; OSM: way/422823421, 8200 m2, building:levels=10 | One OSM way covers all five parallel wings drawn as 25-29; matching a single block needs the wing to be identified on site and the way split. |
| [way/422823423](https://www.openstreetmap.org/way/422823423) | 0.4   | 37.6      | weak   | near the projected pin (see distanceM); OSM: way/422823423, 1584 m2, building:levels=10                 | Fits the 30-32 group                                                                                                                          |

**Adversarial review: keep** (was Confirm on site, top score 0.85). East end unit of the 5-unit comb, facing 30-32. The vignette and index disagree on its function (administrative numbers 29-32 appear shifted by one). Lowered to 0.70.

Lead conflicts: Vignette: 29 = Pro-Chancellor + Administration-II; index: PROCHANCELLOR = 30 and 29 = ADMINISTRATIVE. The administrative block numbers 29-32 appear shifted by one between vignette and index.

**Owner checks on site:** See 25; also confirm whether it is an administrative block.

### 30 - The Chancellery; Administration-I

**Ambiguous** · top score 0.55 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                             | Against                                         |
| ------------------------------------------------------------ | ----- | --------- | ------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [way/422823423](https://www.openstreetmap.org/way/422823423) | 0.55  | 7.5       | partial | Block at the foot of the bowl next to the comb's end, as drawn; OSM: way/422823423, 1584 m2, building:levels=10 | Outline is larger than the 'small block' drawn  |
| [way/422823420](https://www.openstreetmap.org/way/422823420) | 0.5   | 44.5      | partial | Front comb of linked wings next to the bowl (5 311 m2); OSM: way/422823420, 5311 m2, building:levels=10         | One OSM way covers several wings drawn as 30-34 |
| [way/422823424](https://www.openstreetmap.org/way/422823424) | 0.39  | 30.8      | weak    | Small 6-level footprint near the projected pin (see distanceM); OSM: way/422823424, 228 m2, building:levels=6   | -                                               |

**Adversarial review: downgrade** (was Ambiguous, top score 0.78). Blocks 30, 31 and 32 all compete for the single trapezoid way/422823423 (plus its small neighbours 422823424/426/428), and the sources disagree on 29-32. The score is mostly proximity, while the position error (~48 m) is about the same as the median building spacing (51 m).

Lead conflicts: Vignette: 30 = Chancellery; index: 30 = PROCHANCELLOR and CHANCELLOR = 31.

**Owner checks on site:** Which block at the foot of the auditorium is 30?

### 31 - Division of Admissions; Museum of Academics

**Ambiguous** · top score 0.45 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                 | Against                |
| ------------------------------------------------------------ | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [way/422823423](https://www.openstreetmap.org/way/422823423) | 0.45  | n/a       | partial | The vignette puts 31 between 30 and 32 at the front of the cluster; OSM: way/422823423, 1584 m2, building:levels=10 | No overview pin for 31 |
| [way/422823420](https://www.openstreetmap.org/way/422823420) | 0.45  | n/a       | partial | Front comb of linked wings; OSM: way/422823420, 5311 m2, building:levels=10                                         | No overview pin for 31 |

**Adversarial review: downgrade** (was Ambiguous, top score 0.54). No overview pin. Shares one footprint with 30 and 32.

Lead conflicts: Vignette: 31 = Admissions + Museum; index: 31 = CHANCELLOR and ADMINISTRATIVE, ADMISSION = 32. | No pin 31 on the overview (pins 30 and 32 are present).

**Owner checks on site:** Find Block 31 between 30 and 32 (no overview pin).

### 32 - Office of the Vice-Chancellor; Administration-III

**Ambiguous** · top score 0.6 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                                                                  | Against                          |
| ------------------------------------------------------------ | ----- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [way/422823423](https://www.openstreetmap.org/way/422823423) | 0.6   | 0.0       | partial | Projection falls inside; taller block at the front of the cluster, as drawn; An official LPU page puts the Department of Records in 'Building No. 32' (OFFICIAL_CROSSCHECK.md); that places nothing; OSM: way/422823423, 1584 m2, building:levels=10 | -                                |
| [way/422823420](https://www.openstreetmap.org/way/422823420) | 0.55  | 28.4      | partial | Front comb; near the projected pin (see distanceM); OSM: way/422823420, 5311 m2, building:levels=10                                                                                                                                                  | One OSM way covers several wings |

**Adversarial review: downgrade** (was Ambiguous, top score 0.82). The official 'Building No. 32' (Department of Records) gives the number and function only. Shares one footprint with 30 and 31. Lowered from 0.82.

Lead conflicts: Vignette: 32 = Vice-Chancellor + Administration-III; index: 32 = ADMISSION. Vice-Chancellor does not appear in the index.

**Owner checks on site:** Confirm which front block is 32 (official: Department of Records, Building No. 32).

### 33 - School of Computer Science and Engineering

**Ambiguous** · top score 0.55 (medium)

| Candidate                                                      | Score | Dist. (m) | Shape   | Why                                                                                                                    | Against                                                     |
| -------------------------------------------------------------- | ----- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [way/422823420](https://www.openstreetmap.org/way/422823420)   | 0.55  | 18.5      | partial | Front comb of linked wings with connectors, where 33 and 34 are drawn; OSM: way/422823420, 5311 m2, building:levels=10 | One OSM way covers several wings                            |
| [way/422823423](https://www.openstreetmap.org/way/422823423)   | 0.5   | 10.8      | weak    | near the projected pin (see distanceM); OSM: way/422823423, 1584 m2, building:levels=10                                | -                                                           |
| [way/1566888543](https://www.openstreetmap.org/way/1566888543) | 0.41  | 13.6      | weak    | near the projected pin (see distanceM); OSM: way/1566888543, 316 m2, building:levels=none                              | Inner arc of the auditorium (lead 35), not a teaching block |

**Adversarial review: downgrade** (was Ambiguous, top score 0.72). With the non-circular fit, the pin is nearest to way/422823423 (4 m) and way/422823421 (12 m); the 33/34 comb way/422823420 is 26 m away (rank 3).

Lead conflicts: Vignette: 33 = Computer Science and Engineering; index: 33 = COMPUTER APPLICATION (vignette puts Computer Applications at 38).

**Owner checks on site:** Which wing of the front comb is 33?

### 34 - School of Computer Science and Engineering

**Ambiguous** · top score 0.6 (medium)

| Candidate                                                      | Score | Dist. (m) | Shape   | Why                                                                                                                         | Against                                                                                                  |
| -------------------------------------------------------------- | ----- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [way/422823420](https://www.openstreetmap.org/way/422823420)   | 0.6   | 13.8      | partial | Far end of the front comb, where the vignette puts the taller end block 34; OSM: way/422823420, 5311 m2, building:levels=10 | One OSM way covers several wings                                                                         |
| [way/1566888543](https://www.openstreetmap.org/way/1566888543) | 0.46  | 3.2       | weak    | near the projected pin (see distanceM); OSM: way/1566888543, 316 m2, building:levels=none                                   | Inner arc of the auditorium                                                                              |
| [way/422556250](https://www.openstreetmap.org/way/422556250)   | 0.45  | 5.3       | weak    | near the projected pin (see distanceM); OSM: way/422556250, 940 m2, building:levels=4                                       | This is the auditorium bowl; the illustration compresses the cluster, so the projection is drawn into it |

**Adversarial review: downgrade** (was Ambiguous, top score 0.75). The N-S comb way/422823420 (4-5 units) is a fair match for the drawn 33-34 pair, but both blocks share one way, and the small way/422556253 and way/1566888543 are as close.

**Owner checks on site:** Is the far end wing of the front comb Block 34?

### 35 - Shanti Devi Mittal Auditorium

**Confirm on site** · top score 0.7 (medium)

| Candidate                                                      | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                                                                                                                                    | Against                                                               |
| -------------------------------------------------------------- | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [way/422556250](https://www.openstreetmap.org/way/422556250)   | 0.7   | 30.4      | strong  | Quarter-circle footprint in the crook of the V (way 422556249), like the drawn fan-shaped bowl closed by the curved facade of 37; An official LPU page gives Block No. 35 = Shanti Devi Mittal Auditorium (OFFICIAL_CROSSCHECK.md); that places nothing; OSM: way/422556250, 940 m2, building:levels=4 | Used as control point C6, so its position is not independent evidence |
| [way/1566888543](https://www.openstreetmap.org/way/1566888543) | 0.5   | 30.1      | partial | Inner concentric arc of the same bowl (stage/pit); OSM: way/1566888543, 316 m2, building:levels=none                                                                                                                                                                                                   | Probably part of the same auditorium                                  |
| [way/422556253](https://www.openstreetmap.org/way/422556253)   | 0.5   | 31.2      | partial | Innermost concentric arc; OSM: way/422556253, 71 m2, building:levels=1                                                                                                                                                                                                                                 | Probably part of the same auditorium                                  |

**Adversarial review: keep** (was Confirm on site, top score 0.79). Shape holds: way/422556250 is the only quarter-circle (fan) footprint, sitting inside the curve of the V as drawn. An official page puts the Shanti Devi Mittal Auditorium in Block 35 (function only). Position is NOT supporting evidence: the bowl was control point C6. Held out, the fit misses it by 57 m, and with the 4 circular points removed the pin lands inside the comb way/422823421 and the bowl ranks 6th (54 m). Lowered to 0.70. Alternatives way/1566888543 and way/422556253 (small, partial shape) were capped at 0.50; their scores were proximity-driven.

**Owner checks on site:** Check whether the bowl is signed Block 35. The official page ties Block 35 to the Shanti Devi Mittal Auditorium (number and function only; it places nothing).

### 36 - School of Electronics and Electrical Engineering; Electronics & Telecommunication

**Ambiguous** · top score 0.6 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                       | Against                                                                                                     |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [way/422556249](https://www.openstreetmap.org/way/422556249) | 0.6   | 4.8       | strong | V-shaped footprint with a notch at the apex wrapping the bowl, like the drawn V of 36 and 38 meeting at 37; 36 = one arm; OSM: way/422556249, 5927 m2, building:levels=10 | One OSM way covers the whole V (drawn as 36, 37, 38); per-block matching needs the wing identified on site. |
| [way/422556250](https://www.openstreetmap.org/way/422556250) | 0.56  | 0.0       | weak   | Projection falls inside; OSM: way/422556250, 940 m2, building:levels=4                                                                                                    | Auditorium bowl (lead 35)                                                                                   |

**Adversarial review: downgrade** (was Confirm on site, top score 0.85). The V (way/422556249, 3 large pockets) matches the drawn 36-37-38 chevron as a whole. Which arm is 36 comes only from reading the drawing's orientation, and the same way carries 37 and 38. With the non-circular fit, pin 36 is nearest to the bowl (5 m), way/1566888543 (7 m) and the comb (11 m); the V ranks 5th (20 m). An ML detection (det:microsoft-ml:237943d699feee6c, 663 m2) lies in the notch between the arms and is not drawn: a possible later building, or an OSM gap.

Lead conflicts: Minor naming difference only (Electrical vs Telecom).

**Owner checks on site:** Which arm of the V is 36?

### 37 - Central Library

**Confirm on site** · top score 0.75 (higher)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                        | Against                                                                                                     |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [way/422556249](https://www.openstreetmap.org/way/422556249) | 0.75  | 0.0       | strong | Apex of the V, behind the bowl, where the vignette draws the curved facade of 37; An official LPU page puts the Central Library in Block-37 (OFFICIAL_CROSSCHECK.md); that places nothing; OSM: way/422556249, 5927 m2, building:levels=10 | One OSM way covers the whole V (drawn as 36, 37, 38); per-block matching needs the wing identified on site. |
| [way/422556250](https://www.openstreetmap.org/way/422556250) | 0.5   | 10.4      | weak   | near the projected pin (see distanceM); OSM: way/422556250, 940 m2, building:levels=4                                                                                                                                                      | Auditorium bowl                                                                                             |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Kept because an official page puts the Central Library in Block 37, which makes it easy to check on site, and the apex of the V behind the bowl matches the drawn arched facade. The footprint is shared with 36 and 38 and would need a split. The pin projects inside the comb way/422823421 under the non-circular fit, so position does not support it. Lowered to 0.75.

Lead conflicts: Vignette: 37 = CENTRAL LIBRARY; index: 37 = RESEARCH.

**Owner checks on site:** Check whether the apex of the V is signed Block 37. The official page ties Block 37 to the Central Library (number and function only; it places nothing).

### 38 - School of Computer Applications

**Ambiguous** · top score 0.6 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                          | Against                                                                                                     |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [way/422556249](https://www.openstreetmap.org/way/422556249) | 0.6   | 6.8       | strong | Other arm of the V, running toward the 25-29 comb, as drawn; OSM: way/422556249, 5927 m2, building:levels=10 | One OSM way covers the whole V (drawn as 36, 37, 38); per-block matching needs the wing identified on site. |
| [way/422823421](https://www.openstreetmap.org/way/422823421) | 0.57  | 5.5       | weak   | near the projected pin (see distanceM); OSM: way/422823421, 8200 m2, building:levels=10                      | Fits 25-29                                                                                                  |

**Adversarial review: downgrade** (was Confirm on site, top score 0.85). Same V as 36/37. The arm toward the 25-29 comb is the drawn reading, but the pin projects inside the comb (1 m), with the V 27 m away. The index calls 38 CIVIL, contradicting the vignette.

Lead conflicts: Vignette: 38 = Computer Applications; index: 38 = CIVIL (vignette slide-11 puts Civil at 56; index puts COMPUTER APPLICATION at 33).

Nearby detections without an OSM outline: `det:microsoft-ml:237943d699feee6c` (110 m)

**Owner checks on site:** Which arm of the V is 38?

### 41 - Apartments (staff residence)

**Ambiguous** · top score 0.45 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                            | Against                                                                  |
| ------------------------------------------------------------ | ----- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [way/422437894](https://www.openstreetmap.org/way/422437894) | 0.45  | 9.2       | partial | Front slab next to the round tank footprints (ways 422886524-529), like the small round discs drawn beside 41; OSM: way/422437894, 1100 m2, building:levels=10 | Outline (1 100 m2) is not the smallest of the four, as the vignette says |
| [way/422437895](https://www.openstreetmap.org/way/422437895) | 0.45  | 32.7      | partial | Parallel slab; near the projected pin (see distanceM); OSM: way/422437895, 845 m2, building:levels=10                                                          | Fits 42 by order                                                         |

**Adversarial review: downgrade** (was Ambiguous, top score 0.77). Alternative reading B: the vignette draws 41 and 42 as separate slabs and 43-44 as one linked pair. OSM way/422437897 is exactly two masses joined by a link (2 blobs after erosion), giving 41 = way/422437895, 42 = way/422437896, 43+44 = way/422437897. Under reading B, way/422437894 (across the road by the round tanks; 1 100 m2, larger than the drawn 'smallest' 41) is not part of the vignette. Against reading B: on the overview, pin 41 is drawn beside a group of round grey tanks, and OSM way/422437894 is the slab next to the round tank footprints. That supports the matcher's reading A (41 = way/422437894, 42 = way/422437895, 43 = way/422437896, 44 = way/422437897). Neither reading wins, so all four stay open.

Nearby detections without an OSM outline: `det:microsoft-ml:237943d699feee6c` (1 m), `det:google-open-buildings:6684ec2de2a23a11` (119 m)

**Owner checks on site:** Read the block signs on the four apartment slabs next to the large hall.

### 42 - Apartments (staff residence)

**Ambiguous** · top score 0.5 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                      | Against |
| ------------------------------------------------------------ | ----- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| [way/422437895](https://www.openstreetmap.org/way/422437895) | 0.5   | 0.0       | strong  | Rectangular slab parallel to its neighbours (845 m2, 10 levels); projection falls inside; OSM: way/422437895, 845 m2, building:levels=10 | -       |
| [way/422437896](https://www.openstreetmap.org/way/422437896) | 0.5   | 23.7      | partial | Next slab; near the projected pin (see distanceM); OSM: way/422437896, 845 m2, building:levels=10                                        | -       |

**Adversarial review: downgrade** (was Confirm on site, top score 0.85). Internal contradiction: the matcher's own reason for 44 says way/422437897 is 'the vignette's linked 43-44', yet it put 43 on way/422437896. Under reading B, 42 = way/422437896 and 41 = way/422437895. way/422437895 and way/422437896 are identical 46 x 19 m rectangles, so shape cannot separate them. Reading A is supported by the overview drawing pin 41 beside round tanks (OSM way/422437894 is next to the tank footprints). Reading B is supported by the vignette's linked 43-44 pair. Both stay open.

Nearby detections without an OSM outline: `det:microsoft-ml:237943d699feee6c` (38 m), `det:google-open-buildings:6684ec2de2a23a11` (82 m), `det:microsoft-ml:8ec762527380d97e` (117 m)

**Owner checks on site:** See 41.

### 43 - Apartments (staff residence)

**Ambiguous** · top score 0.5 (low)

| Candidate                                                      | Score | Dist. (m) | Shape   | Why                                                                                                                                               | Against                                |
| -------------------------------------------------------------- | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [way/422437896](https://www.openstreetmap.org/way/422437896)   | 0.5   | 0.0       | strong  | Rectangular slab parallel to its neighbours (845 m2, 10 levels); projection falls inside; OSM: way/422437896, 845 m2, building:levels=10          | -                                      |
| [way/422437897](https://www.openstreetmap.org/way/422437897)   | 0.5   | 26.3      | partial | Two linked slabs; near the projected pin (see distanceM); the vignette says 43 and 44 are linked; OSM: way/422437897, 2323 m2, building:levels=10 | Could be the 43+44 pair as one outline |
| [way/1550425052](https://www.openstreetmap.org/way/1550425052) | 0.44  | 19.7      | weak    | near the projected pin (see distanceM); U-shaped, no levels tag; OSM: way/1550425052, 1402 m2, building:levels=none                               | -                                      |

**Adversarial review: downgrade** (was Confirm on site, top score 0.85). Reading A (matcher): 43 = way/422437896. Reading B: 43 = the long slab of way/422437897, linked to 44 as the vignette draws it. The non-circular pin lands 3 m from way/422437895 and 7 m from way/422437896, which does not decide. The newer way/1550425052 (U-shape, 1 402 m2, beside the slabs) is not in the vignette: built after the illustration, or left out of it. Reading A is supported by the overview drawing pin 41 beside round tanks. Reading B is supported by the vignette's linked 43-44 pair. Both stay open.

Nearby detections without an OSM outline: `det:google-open-buildings:6684ec2de2a23a11` (48 m), `det:microsoft-ml:237943d699feee6c` (72 m), `det:microsoft-ml:8ec762527380d97e` (83 m)

**Owner checks on site:** See 41.

### 44 - Apartments (staff residence)

**Confirm on site** · top score 0.7 (medium)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                 | Against                 |
| ------------------------------------------------------------ | ----- | --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| [way/422437897](https://www.openstreetmap.org/way/422437897) | 0.7   | 9.8       | strong | Two slabs joined by a link (2 323 m2, 10 levels), at the back next to the large shed, like the vignette's linked 43-44 at the back; OSM: way/422437897, 2323 m2, building:levels=10 | May hold both 43 and 44 |
| [way/422437896](https://www.openstreetmap.org/way/422437896) | 0.39  | 36.3      | weak   | near the projected pin (see distanceM); OSM: way/422437896, 845 m2, building:levels=10                                                                                              | -                       |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Both readings put 44 on way/422437897 (two linked masses), but in reading B the same way also carries 43. Lowered to 0.70; the owner should check both halves.

Nearby detections without an OSM outline: `det:microsoft-ml:6e219cd673e031a1` (45 m), `det:google-open-buildings:6684ec2de2a23a11` (57 m), `det:microsoft-ml:8ec762527380d97e` (81 m)

**Owner checks on site:** See 41; is the linked pair one or two block numbers?

### 45 - Boys Hostel 1

**Confirm on site** · top score 0.8 (higher) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                                                                                                 | Against |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| [way/422548300](https://www.openstreetmap.org/way/422548300) | 0.8   | 3.7       | strong | Three parallel slabs linked at their ends (3 957 m2, 10 levels), like the vignette's three echelon slabs; OSM water tower (node 4224770131) beside it, as drawn (that tower is control point C4, not the building); OSM: way/422548300, 3957 m2, building:levels=10 | -       |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Checked: way/422548300 is the ONLY footprint that splits into exactly 3 parallel slabs linked at their ends (3 blobs after erosion), as drawn. The pin lands 3 m away; the next footprint is 69 m away. 'Boys Hostel 1' is the caption's hostel number, not an official one. Lowered to 0.80.

Nearby detections without an OSM outline: `det:microsoft-ml:6e219cd673e031a1` (104 m), `det:microsoft-ml:f174064e9a908497` (117 m)

**Owner checks on site:** Is the three-slab hostel next to the water tower Boys Hostel 1 / Block 45?

### 47 - Indoor (sports) facility

**Confirm on site** · top score 0.75 (higher)

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                   | Against                                                                              |
| ------------------------------------------------------------ | ----- | --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [way/422737297](https://www.openstreetmap.org/way/422737297) | 0.75  | 0.0       | strong | Largest single hall west of the axis (10 171 m2), like the large shed drawn beside the apartments; OSM: way/422737297, 10171 m2, building:levels=none | Used as control point C5, so its position is not independent evidence; No levels tag |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Plain 119 x 86 m rectangle, the second-largest footprint. It was control point C5 (circular); held out, the fit misses by 50 m, and the nearest other footprints are 54-61 m away. 'INDOOR' is index-only (no vignette). Lowered to 0.75.

Lead conflicts: No vignette.

Nearby detections without an OSM outline: `det:microsoft-ml:6e219cd673e031a1` (90 m), `det:microsoft-ml:8e72e8e43f6d1946` (103 m), `det:microsoft-ml:237943d699feee6c` (106 m)

**Owner checks on site:** Is the large hall Block 47 (indoor sports)?

### 48 - Boys Hostel 2 (number by caption order only)

**Confirm on site** · top score 0.75 (higher) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                                                                                | Against                                                                         |
| ------------------------------------------------------------ | ----- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [way/422548297](https://www.openstreetmap.org/way/422548297) | 0.75  | 0.0       | strong | Chain of linked square blocks (5 505 m2, 10 levels) next to round green features, like the drawn chain of towers with round tanks; OSM: way/422548297, 5505 m2, building:levels=10 | One OSM way covers the whole chain, which the vignette splits between 48 and 49 |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Checked: way/422548297 breaks into 6 tower blobs after erosion, matching the drawn chain of ~6 linked towers. way/422548298 breaks into 5, matching the drawn 5-tower chain of 51. That separates the two chains. Both 48 and 49 sit on this one way, so which towers carry which number needs a site check. Hostel numbers 2/3 come from caption order only. Lowered to 0.75.

Lead conflicts: Caption pairs 48,49 with hostels 2,3 by order only.

Nearby detections without an OSM outline: `det:microsoft-ml:f372bba12e0a8db2` (59 m), `det:microsoft-ml:75f8b206a7f7b229` (75 m), `det:microsoft-ml:aa50379f55ffa4ea` (102 m)

**Owner checks on site:** Where does 48 end and 49 begin along the chain of towers?

### 49 - Boys Hostel 3 (number by caption order only)

**Confirm on site** · top score 0.75 (higher) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                               | Against                                                                         |
| ------------------------------------------------------------ | ----- | --------- | ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [way/422548297](https://www.openstreetmap.org/way/422548297) | 0.75  | 0.0       | strong | Same chain as 48; 49 is drawn toward the top end; OSM: way/422548297, 5505 m2, building:levels=10 | One OSM way covers the whole chain, which the vignette splits between 48 and 49 |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Checked: way/422548297 breaks into 6 tower blobs after erosion, matching the drawn chain of ~6 linked towers. way/422548298 breaks into 5, matching the drawn 5-tower chain of 51. That separates the two chains. Both 48 and 49 sit on this one way, so which towers carry which number needs a site check. Hostel numbers 2/3 come from caption order only. Lowered to 0.75.

Lead conflicts: Caption pairs 48,49 with hostels 2,3 by order only.

Nearby detections without an OSM outline: `det:microsoft-ml:f372bba12e0a8db2` (80 m), `det:microsoft-ml:75f8b206a7f7b229` (101 m), `det:microsoft-ml:cf9ae916a37d2c86` (108 m)

**Owner checks on site:** See 48.

### 50 - Boys Hostel 7

**Confirm on site** · top score 0.75 (higher) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                          | Against |
| ------------------------------------------------------------ | ----- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| [way/422548299](https://www.openstreetmap.org/way/422548299) | 0.75  | 0.0       | strong | Single free-standing block (9 levels) at the end of a dead-end road, as drawn; OSM: way/422548299, 936 m2, building:levels=9 | -       |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Single near-rectangular block (40 x 26 m). The pin lands inside it, and the next footprint is 98 m away. The shape is generic, so position and 'isolated at the end of a dead-end road' decide. Lowered to 0.75.

Nearby detections without an OSM outline: `det:microsoft-ml:13542854011ba39d` (83 m)

**Owner checks on site:** Is the isolated tower at the dead-end road Block 50 (Boys Hostel 7)?

### 51 - Boys Hostel (number not printed)

**Confirm on site** · top score 0.8 (higher) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape  | Why                                                                                                                          | Against |
| ------------------------------------------------------------ | ----- | --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| [way/422548298](https://www.openstreetmap.org/way/422548298) | 0.8   | 1.5       | strong | Chain of five linked blocks beside the cricket ground (10 levels), as drawn; OSM: way/422548298, 3419 m2, building:levels=10 | -       |
| [way/422738863](https://www.openstreetmap.org/way/422738863) | 0.3   | 43.1      | weak   | Small 2-level footprint near the projected pin (see distanceM); OSM: way/422738863, 210 m2, building:levels=2                | -       |

**Adversarial review: keep** (was Confirm on site, top score 0.85). Checked: 5 tower blobs after erosion, as drawn, and the pin lands inside it. The caption prints no hostel number (do not infer BH4). Lowered to 0.80.

Lead conflicts: Caption gives no hostel number; Boys Hostel 4 is not assigned anywhere in the slides (1=45, 2,3=48,49, 5,6=53,54, 7=50). Do not infer 51=BH4.

Nearby detections without an OSM outline: `det:microsoft-ml:cf9ae916a37d2c86` (35 m), `det:microsoft-ml:89e781efb006a323` (55 m)

**Owner checks on site:** Is the chain beside the cricket ground Block 51?

### 52 - BOYS HOSTEL

**No plausible OSM footprint** · top score 0.21 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape | Why                                                                                                      | Against                                                                |
| ------------------------------------------------------------ | ----- | --------- | ----- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [way/422738863](https://www.openstreetmap.org/way/422738863) | 0.21  | n/a       | weak  | Small 2-level footprint at the edge of the cricket ground; OSM: way/422738863, 210 m2, building:levels=2 | The PLAYGROUND scene puts pin 52 on the oval itself, not on a building |

**Adversarial review: keep** (was No plausible OSM footprint, top score 0.21). Checked and left unchanged: the scores are already low or the lead has no usable pin, and the notes already say that no footprint is placed.

Lead conflicts: Index lists 52 as a BOYS HOSTEL, but the only pin 52 is on the cricket ground (slide-03), not on a building. | No pin 52 on the overview; no vignette caption. | Index boys-hostel list reads '51,53,52' and omits 54, which slide-10 captions as a boys hostel.

**Owner checks on site:** Is there a Block 52 at all? The drawing puts the pin on the cricket ground.

### 53 - Boys Hostel 5 (number by caption order only)

**Ambiguous** · top score 0.5 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                                                                      | Against                                               |
| ------------------------------------------------------------ | ----- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [way/422323508](https://www.openstreetmap.org/way/422323508) | 0.5   | 0.0       | partial | One end slab of the spine-and-four-slabs complex (ways 422323508, 422547443-447), like the drawn comb/double-H; projection falls inside; OSM: way/422323508, 1310 m2, building:levels=10 | Which end slab is 53 depends only on the pin position |
| [way/422547444](https://www.openstreetmap.org/way/422547444) | 0.5   | 38.1      | partial | Slab at the other end of the same spine; OSM: way/422547444, 1267 m2, building:levels=10                                                                                                 | -                                                     |
| [way/422547443](https://www.openstreetmap.org/way/422547443) | 0.5   | 18.0      | weak    | Central spine; near the projected pin (see distanceM); OSM: way/422547443, 2972 m2, building:levels=10                                                                                   | The vignette pins 53 on an end slab, not the spine    |

**Adversarial review: downgrade** (was Ambiguous, top score 0.82). The 53/54 complex has 4 slabs of nearly the same size (1 267-1 310 m2) around the spine way/422547443, 30-45 m apart, which is less than the position error (~48 m). The two west slabs (way/422323508, way/422547447) share a sawtooth west edge. Shape cannot pick the slab. Lowered from 0.82.

Lead conflicts: Caption pairs 53,54 with hostels 5,6 by order only.

Nearby detections without an OSM outline: `det:google-open-buildings:ebbb32f16a06d452` (74 m), `det:microsoft-ml:36b3f8c4bba145b8` (76 m)

**Owner checks on site:** Which slab of the spine-and-slabs complex is 53?

### 54 - Boys Hostel 6 (number by caption order only)

**Ambiguous** · top score 0.5 (low) · priority: hostel

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                             | Against                                               |
| ------------------------------------------------------------ | ----- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [way/422547447](https://www.openstreetmap.org/way/422547447) | 0.5   | 0.0       | partial | End slab next to the block-53 candidate on the same side of the spine; projection falls inside; OSM: way/422547447, 1274 m2, building:levels=10 | Which end slab is 54 depends only on the pin position |
| [way/422547446](https://www.openstreetmap.org/way/422547446) | 0.5   | 39.6      | partial | Slab at the other end; OSM: way/422547446, 1308 m2, building:levels=10                                                                          | -                                                     |
| [way/422547443](https://www.openstreetmap.org/way/422547443) | 0.5   | 21.0      | weak    | Central spine; near the projected pin (see distanceM); OSM: way/422547443, 2972 m2, building:levels=10                                          | -                                                     |

**Adversarial review: downgrade** (was Ambiguous, top score 0.82). The 53/54 complex has 4 slabs of nearly the same size (1 267-1 310 m2) around the spine way/422547443, 30-45 m apart, which is less than the position error (~48 m). The two west slabs (way/422323508, way/422547447) share a sawtooth west edge. Shape cannot pick the slab. Lowered from 0.82.

Lead conflicts: Caption pairs 53,54 with hostels 5,6 by order only. | 54 is missing from the index BOYS HOSTEL list ('51,53,52').

Nearby detections without an OSM outline: `det:google-open-buildings:ebbb32f16a06d452` (65 m), `det:microsoft-ml:f92d70b0452e6db8` (114 m), `det:microsoft-ml:36b3f8c4bba145b8` (119 m)

**Owner checks on site:** Which slab is 54?

### 55 - School of Mechanical Engineering

**Ambiguous** · top score 0.4 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                      | Against                                                               |
| ------------------------------------------------------------ | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [way/422547449](https://www.openstreetmap.org/way/422547449) | 0.4   | n/a       | partial | Wedge of the curved radiating group on the side facing the playing fields; OSM: way/422547449, 517 m2, building:levels=9 | No overview pin for 55; position comes only from the PLAYGROUND scene |
| [way/422547451](https://www.openstreetmap.org/way/422547451) | 0.4   | n/a       | partial | Wedge of the same group, also facing the fields; OSM: way/422547451, 538 m2, building:levels=9                           | No overview pin for 55                                                |
| [way/422547448](https://www.openstreetmap.org/way/422547448) | 0.4   | n/a       | partial | End wedge of the group; OSM: way/422547448, 1421 m2, building:levels=9                                                   | No overview pin for 55                                                |

**Adversarial review: downgrade** (was Ambiguous, top score 0.5). No overview pin. Wedges way/422547449 and way/422547451 are near-identical. The C12 crescent centroid used as a control point is itself built from these ways.

Lead conflicts: Vignette: Mechanical = 55; index: MECHANICAL = 56. Block 55 is not in the index and has no overview pin.

Nearby detections without an OSM outline: `det:microsoft-ml:6af6f6f5bb32fbd3`

**Owner checks on site:** Which wedge of the curved group is 55 (mechanical engineering)? Check the unmapped building by the fields too.

### 56 - School of Civil Engineering

**Ambiguous** · top score 0.45 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                          | Against                                                                       |
| ------------------------------------------------------------ | ----- | --------- | ------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [way/422547448](https://www.openstreetmap.org/way/422547448) | 0.45  | 0.0       | partial | Wedge of the curved radiating group; projection falls inside; OSM: way/422547448, 1421 m2, building:levels=9 | The vignette calls 56 the widest middle wing; way 422547450 is the middle one |
| [way/422547450](https://www.openstreetmap.org/way/422547450) | 0.45  | 20.1      | partial | Middle wedge of the group (1 440 m2); OSM: way/422547450, 1440 m2, building:levels=9                         | -                                                                             |
| [way/422547449](https://www.openstreetmap.org/way/422547449) | 0.45  | 21.0      | weak    | Smaller wedge near the projected pin (see distanceM); OSM: way/422547449, 517 m2, building:levels=9          | -                                                                             |

**Adversarial review: downgrade** (was Ambiguous, top score 0.82). way/422547448, way/422547450 and way/422547452 are near-identical wedges (1 421-1 448 m2, 54 x 28-30 m, 9 levels). Only position separates them, and the crescent was control point C12 (circular; held out, the miss is 53 m). Lowered from 0.82.

Lead conflicts: Vignette: 56 = Civil; index: 56 = MECHANICAL and CIVIL = 38.

Nearby detections without an OSM outline: `det:microsoft-ml:c19d5c86ea4dba6e` (111 m)

**Owner checks on site:** Which wedge is 56?

### 57 - School of Polytechnic

**Ambiguous** · top score 0.45 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                | Against |
| ------------------------------------------------------------ | ----- | --------- | ------- | -------------------------------------------------------------------------------------------------- | ------- |
| [way/422547450](https://www.openstreetmap.org/way/422547450) | 0.45  | 0.0       | partial | Wedge of the curved group; projection falls inside; OSM: way/422547450, 1440 m2, building:levels=9 | -       |
| [way/422547452](https://www.openstreetmap.org/way/422547452) | 0.45  | 34.9      | partial | Outer end wedge of the group; OSM: way/422547452, 1449 m2, building:levels=9                       | -       |

**Adversarial review: downgrade** (was Ambiguous, top score 0.82). Same identical-wedge problem as 56. With the non-circular fit, the pin falls inside way/422547448, and way/422547450 ranks 5th (32 m). Lowered from 0.82.

Nearby detections without an OSM outline: `det:microsoft-ml:c19d5c86ea4dba6e` (96 m)

**Owner checks on site:** Which wedge is 57 (polytechnic)?

### 58 - Project Lab

**Ambiguous** · top score 0.35 (low)

| Candidate                                                    | Score | Dist. (m) | Shape   | Why                                                                                                                                             | Against                                                                                              |
| ------------------------------------------------------------ | ----- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [way/422547452](https://www.openstreetmap.org/way/422547452) | 0.35  | 0.0       | weak    | Projection falls inside; OSM: way/422547452, 1449 m2, building:levels=9                                                                         | A wedge of the curved group, not an L-shaped low building                                            |
| [way/422551921](https://www.openstreetmap.org/way/422551921) | 0.35  | 41.0      | partial | Long low-looking bar beside the two car parks at the far end next to the curved group, as drawn; OSM: way/422551921, 1169 m2, building:levels=6 | building:levels=6, whereas the overview draws a low building; near the projected pin (see distanceM) |

**Adversarial review: downgrade** (was Ambiguous, top score 0.6). way/422547452 is a wedge identical to 56/57, not the drawn low L-shaped building. With the non-circular fit, the pin is nearest to way/422547448. The long low way/422551921 (106 x 16 m) by the car park is at least as plausible. All candidates capped at 0.35.

Lead conflicts: Index EDUCATION list ends with a row '58' that has no label; ADMINISTRATIVE list has 'PROJECT LAB 58'. No vignette.

Nearby detections without an OSM outline: `det:microsoft-ml:c19d5c86ea4dba6e` (43 m)

**Owner checks on site:** Is the long building by the car parks Block 58 (project lab)?
