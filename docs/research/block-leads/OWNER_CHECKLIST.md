# Owner checklist: block-number confirmations

> **Status: review items, not applied data.** Every footprint below is an _unverified candidate_. Each
> block number in this file came from an undated third-party illustration (Behance "LPU isometric map
> design") or from an official page that gives only the number and function. None of them places a
> building. Do not write a block number into the dataset until you have confirmed it with **your own**
> evidence: a sign on the building or an official LPU document that names the building. Location or
> appearance alone is never enough.
>
> This checklist was built after the adversarial review ([`REVIEW.md`](REVIEW.md)). Scores and
> alternatives for each lead are in [`CANDIDATES.md`](CANDIDATES.md) and
> [`block-candidates.json`](block-candidates.json). The map is
> [`candidates-overview.png`](candidates-overview.png), our own drawing of OSM data.

## How to record each confirmation

For each item, record the following. The `osmId` values are this repo's IDs, and the coordinates are the
dataset's anchor points.

1. **The sign.** Photograph the block sign or nameplate. Note the exact text, the date, and which face of
   which footprint it is on.
2. **The footprint.** Name the footprint by `osmId`. If one OSM way holds several blocks, note which part
   (for example, "west end unit", "SSW arm") and where the boundary between blocks runs.
3. **Room plates (optional extra evidence).** An official LPU induction page lists a venue as
   "Conference Hall, 32-213". That _suggests_, but does not establish, that room codes begin with the
   block number. If the plates inside a building follow a `NN-xxx` pattern, photograph one. Treat it as
   supporting evidence only until the convention is confirmed.
4. **The source.** Record whether the evidence is a site sign or an official document (with URL and
   date). Do not cite the Behance illustration as evidence.
5. **Splits.** Where one OSM way covers several blocks, splitting it in OpenStreetMap is a separate OSM
   edit. Base it on your own survey or permitted imagery. **Never trace from, or cite, the Behance
   illustration in OSM.**

## Ordered checklist (most valuable first)

### 1. School of Agriculture, Blocks 25-26 (and 27-29 on the same walk)

- **Candidate:** [`way/422823421`](https://www.openstreetmap.org/way/422823421), anchor 31.25263 N,
  75.70337 E. This is a 195 m E-W row of **5 joined units**, 10 levels, north of the V-shaped building.
- **Confirm on site:**
  - Walk the row from its **west end** (by the road bend) to its east end, and photograph the block sign
    on each of the 5 units.
  - The lead predicts 25, 26, 27, 28 and 29 from west to east, with 25-26 = Agriculture, 27 = Chemical
    Engineering / Physical Science, 28 = Bioengineering, and 29 = administration.
  - Also record whether the units are separate buildings joined by connectors. If so, one OSM way should
    become 5.
- **Watch for:**
  - The illustration's two sources disagree on 29 (vignette: Pro-Chancellor / Administration-II; index:
    "ADMINISTRATIVE").
  - Position gives no help here: pins 35, 37 and 38 also project onto this way.
- **Official route:** none found. No school page prints a block number.

### 2. Central Library, Block 37 (and 36 / 38, the arms of the same building)

- **Candidate:** [`way/422556249`](https://www.openstreetmap.org/way/422556249), anchor 31.25190 N,
  75.70374 E. This is a V-shaped building, 10 levels. Its apex wraps the quarter-circle bowl, and its two
  arms run west and south-south-west.
- **Already official (number and function only):** "the biggest Central Library located in Block-37"
  (lpu.in libraries page). That page **does not say which building**.
- **Confirm on site:**
  - Is the library entrance in this building, and is it signed Block 37?
  - Which part is 37: the apex behind the bowl (as the lead suggests) or the whole V?
  - What are the signs on the **west arm** (lead: 38, Computer Applications; the index says CIVIL) and the
    **SSW arm** (lead: 36, Electronics & Electrical)?
  - Note any building in the notch between the arms. An ML detection of 663 m² lies there, and it is not
    in OSM or in the drawing.
- **Downgraded in review:** the 36 and 38 arm assignments are ambiguous; only 37 stays confirm-on-site.

### 3. Main academic and administration blocks, 30-34

- **Candidates:**
  - [`way/422823423`](https://www.openstreetmap.org/way/422823423): trapezoid at the east end of the
    25-29 row, anchor 31.25259 N, 75.70464 E. Leads **30, 31 and 32 all compete for it**.
  - Small attached ways `422823424`, `422823426` and `422823428`.
  - [`way/422823420`](https://www.openstreetmap.org/way/422823420): N-S row of 4-5 units south of it,
    anchor 31.25184 N, 75.70479 E. Candidate for 33-34 (Computer Science and Engineering).
- **Official lead:** "Department of Records at Building No. 32, Room No. 101 (Window No. 2)" (lpu.in eSanad
  page). Ask at or visit the Records window. The building where Room 101 of the Department of Records is
  located **is Building 32**, by an official source. Also note whether its sign says "Block 32".
- **Confirm on site:**
  - The block signs on the trapezoid and its attached parts. The sources disagree on 29-32: they look
    shifted by one between the vignette and the index.
  - Which units of the N-S row carry 33 and 34, and whether there are more than two blocks in it.

### 4. Shanti Devi Mittal Auditorium, Block 35

- **Candidate:** [`way/422556250`](https://www.openstreetmap.org/way/422556250), the quarter-circle bowl
  inside the curve of the V, anchor 31.25206 N, 75.70408 E.
- **Already official (number and function only):** induction schedule venue "Shanti Devi Mittal
  Auditorium (Block No. 35)". The page may show an earlier year's table.
- **Confirm on site:**
  - Is the auditorium this bowl, and is it signed Block 35?
  - Is it an enclosed hall or an open amphitheatre? OSM says 4 levels.
  - Is the auditorium a separate block from the V-shaped building around it?
- **Note:** this footprint was used as a control point, so its projected position is not evidence. The
  match rests on its unique fan shape plus the official function.

### 5. Division of Student Welfare, Block 13

- **Candidate:** [`relation/7099162`](https://www.openstreetmap.org/relation/7099162), anchor 31.25497 N,
  75.70613 E. This is a 46 × 41 m square with a central courtyard (the only courtyard footprint in the
  dataset), 10 levels, with a front stub.
- **Already official (number and function only):** "Block 13, Student Welfare Wing" (lpu.in art-and-culture
  page). It places nothing.
- **Confirm on site:**
  - Is this courtyard building signed Block 13, and does it house the Student Welfare wing?
  - The overview index also lists "BUSINESS 13". Note what else is signed there.

### 6. Uni-Centre / School of Hotel Management, Block 15 (and the pavilion "16", 14, 18 nearby)

- **Candidate for 15:** [`way/422437885`](https://www.openstreetmap.org/way/422437885), a 150 m wedge that
  narrows westward with a rounded east end, anchor 31.25572 N, 75.70507 E.
- **Confirm on site:**
  - Is the wedge signed Block 15?
  - Does it hold Hotel Management and/or the "Uni-Mall (Unicentre)"? The official shopping page names the
    Uni-Mall with no block number.
- **On the same walk:**
  - **16:** [`way/422823431`](https://www.openstreetmap.org/way/422823431), the largest roof on campus,
    next to the wedge. Does it have a block number at all? "Open auditorium" is inferred only from a scene
    caption.
  - **14:** [`way/422437887`](https://www.openstreetmap.org/way/422437887), Mittal School of Business, which
    may include `way/422437888`. Ambiguous.
  - **18:** [`way/422437890`](https://www.openstreetmap.org/way/422437890), a bar with wider end blocks.
    Education / Social Science.

### 7. Boys' hostels: 45, 48/49, 50, 51 (then 53/54 and 52)

- **Candidates:**

  | Lead                 | Footprint                                                      | Anchor                 | Shape                                        |
  | -------------------- | -------------------------------------------------------------- | ---------------------- | -------------------------------------------- |
  | 45 ("Boys Hostel 1") | [`way/422548300`](https://www.openstreetmap.org/way/422548300) | 31.25129 N, 75.70004 E | 3 linked parallel slabs                      |
  | 48/49                | [`way/422548297`](https://www.openstreetmap.org/way/422548297) | 31.24965 N, 75.70025 E | Chain of 6 towers                            |
  | 51                   | [`way/422548298`](https://www.openstreetmap.org/way/422548298) | 31.24868 N, 75.69951 E | Chain of 5 towers, beside the cricket ground |
  | 50 ("Boys Hostel 7") | [`way/422548299`](https://www.openstreetmap.org/way/422548299) | 31.24945 N, 75.69827 E | Single block at a dead end                   |

- **Confirm on site:**
  - Record the **block number** and the **hostel name or number (BH-n)** separately; they are different
    numbering systems.
  - On the 6-tower chain, which towers are 48 and which are 49?
  - For 51, the caption gives no hostel number. Do not assume BH-4. The official induction page mentions
    "BH4 Playgrounds" only as a venue.
- **Then, if time allows:**
  - 53/54: four near-identical slabs around a spine at the south-west; shape and position cannot pick
    the slab.
  - 52: the illustration's only pin 52 is on the cricket ground; there is no building candidate.
- **Official route:** the residence pages give no hostel block numbers. A hostel allotment letter or the
  hostel office would count as an official document.

### 8. Girls' hostels: 9-12 (and 21, 21A/21B, 22/23)

- **Candidates (all ambiguous after review):**
  - [`way/422437902`](https://www.openstreetmap.org/way/422437902): U-shape, 1 494 m², anchor 31.25658 N,
    75.70584 E.
  - [`way/422437904`](https://www.openstreetmap.org/way/422437904): T-shape, anchor 31.25694 N, 75.70539 E.
  - The review found the first pass contradictory: 9 is drawn as the _largest U/E_, which fits
    `422437902`, but that way was the top candidate for 12.
  - Several hostel buildings here are **not in OSM**. ML detections lie west and south of the group.
- **Confirm on site:**
  - Block number and hostel name on every building of the group, including the unmapped ones. Note them
    for future mapping.
  - Whether "Girls Hostel 1-4" corresponds to blocks 9-12 in that order. The caption pairs them only by
    order.
- **Also on the way:** the multi-slab cluster at [`way/422548303`](https://www.openstreetmap.org/way/422548303)
  (anchor 31.25328 N, 75.70085 E) and its neighbours `422548301` and `422548304`.
  - The overview pins **21** there.
  - The index lists **21A/21B** as girls' hostels.
  - A vignette has **22/23** as girls' hostels 5/6.
  - Another vignette makes **21 the School of Law**.

  Only the signs can resolve this.

### 9. Baldev Raj Auditorium / Campus Cafe, Block 2 (and 1, 3, 4 at the gate end)

- **Candidates:** three touching parts near the gate-side forecourt, which together look like the drawn
  low bar with a round drum:
  - [`way/427330237`](https://www.openstreetmap.org/way/427330237): long low bar, 2 levels, anchor
    31.25823 N, 75.70798 E.
  - [`way/427330238`](https://www.openstreetmap.org/way/427330238): curved piece.
  - [`way/422732974`](https://www.openstreetmap.org/way/422732974): circle.
- **Confirm on site:**
  - Is this complex signed Block 2?
  - Is there a campus cafe, an auditorium named "Baldev Raj", or both?
  - Which part carries the number?
  - **Do not conflate** it with the officially named "Baldev Raj Mittal Unipolis" venue; nothing links the
    two.
- **Gate-end neighbours.** Positions here are extrapolated by more than 200 m and carry no weight.
  - **1:** [`way/354743583`](https://www.openstreetmap.org/way/354743583), a star / cross shape, anchor
    31.25861 N, 75.70886 E. The caption says School of Fashion, but OSM names it "Lovely Institute Of
    Management". Read the sign.
  - **4:** [`way/354830243`](https://www.openstreetmap.org/way/354830243), a sawtooth bar, OSM name
    "Lovely Institute of Pharmacy", anchor 31.25758 N, 75.70730 E. Is it Block 4 or Block 7? The index
    lists pharmacy under both.
  - **3:** [`way/354755644`](https://www.openstreetmap.org/way/354755644), OSM name "Lovely Institute of
    Technology". The caption says Physiotherapy.
  - **6-7-8:** probably **unmapped** in OSM. ML detections lie south of the gate road. Record the signs
    for future mapping.

### 10. Apartments 41-44 and the indoor hall 47

- **Candidates:**
  - Slabs [`way/422437894`](https://www.openstreetmap.org/way/422437894),
    [`422437895`](https://www.openstreetmap.org/way/422437895) and
    [`422437896`](https://www.openstreetmap.org/way/422437896).
  - The two-part [`way/422437897`](https://www.openstreetmap.org/way/422437897), anchor 31.25183 N,
    75.70120 E.
  - The large hall [`way/422737297`](https://www.openstreetmap.org/way/422737297) to the south.
- **Two readings remain open:**
  - **A:** 41 = `894` (beside the round tanks), 42 = `895`, 43 = `896`, 44 = `897`.
  - **B:** 41 = `895`, 42 = `896`, 43 + 44 = the two linked halves of `897`.
- **Confirm on site:**
  - The block sign on each slab and on **both halves** of `897`.
  - Whether the U-shaped `way/1550425052` next to them has a block number. It is not in the illustration.
  - Whether the large hall is signed Block 47 and is an indoor sports facility. "INDOOR" is from the
    index only.

## Do not use without new evidence

- **55-58 (south-west crescent):** three wedges are near-identical in OSM. Only signs can assign 55
  (Mechanical), 56 (Civil), 57 (Polytechnic) or 58 (Project Lab), and the illustration's two sources
  disagree on 55/56.
- **5, 17, 24, 39, 40, 46:** no caption, or never shown in the illustration.
- **Any number taken from the illustration's position alone.** The review measured a position error of
  about 50 m, which is one building spacing (see `REVIEW.md` §1).
