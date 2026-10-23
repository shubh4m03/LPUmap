# Official-source cross-check: block numbers on LPU's own pages

**Status: review items for the owner, not applied data.** Retrieved
2026-10-23 22:15–22:25 UTC (2026-10-24 IST). The machine-readable
version is `official-block-confirmations.json` in this folder. It holds every
URL checked, with its HTTP status and retrieval time.

This file pairs block numbers with entities, using LPU's own wording. **None
of these statements places a block on the map, and none identifies an OSM
footprint.** Matching a confirmed number to a building still needs separate
evidence, such as a survey on site or an official map. No official map exists
on the pages checked. The Behance illustration is quoted below only for
comparison. It was not used as evidence for any row.

## Confirmed by official LPU pages (4)

| Block    | Entity                                            | Official URL                                                              | Quote (≤ 20 words)                                                                       | Retrieved (UTC)      |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------- |
| **37**   | Central Library (largest of 12 branches)          | https://www.lpu.in/academics/libraries.php                                | "Total number of 12 branches with the biggest Central Library located in Block-37."      | 2026-10-23T22:24:40Z |
| **35**   | Shanti Devi Mittal Auditorium                     | https://www.lpu.in/events/freshmeninduction/minute-to-minute-schedule.php | "Shanti Devi Mittal Auditorium (Block No. 35)"                                           | 2026-10-23T22:15:38Z |
| **13**   | Student Welfare Wing (training for student clubs) | https://www.lpu.in/campus-life/art-and-culture.php                        | "Join us at Block 13, Student Welfare Wing, and train in various societies free of cost" | 2026-10-23T22:17:55Z |
| **32** ¹ | Department of Records (document verification)     | https://www.lpu.in/esanad/                                                | "Department of Records at Building No. 32, Room No. 101 (Window No. 2)"                  | 2026-10-23T22:17:22Z |

¹ The page says **"Building No."**, not "Block". It does not state that the
two use the same numbering, although that is likely. The owner should confirm.
The page also names a staff contact; that name was deliberately not recorded.

Caveats:

- **Block 35:** the schedule page says the 2026 schedule "will be updated
  soon", so the table shown may be from an earlier induction year. The
  auditorium's block number is unlikely to change, but the page is undated.
- **Block 37:** the same sentence appears in the repo cache from
  2026-10-23T10:03Z and is already cited in `docs/research/LPU_PUBLIC_SOURCES.md`.
  It was fetched again live for this check.

## Implicit only (not counted as confirmed)

| Code   | Where                                        | Quote                            | Why not confirmed                                                                                                |
| ------ | -------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 32-213 | Minute-to-minute schedule, international day | "Venue: Conference Hall, 32-213" | Reading this as Block 32, Room 213 is our inference. The page does not say so. The session is dated 26-July-2023 |

## Comparison with the Behance leads (context only)

This section compares each official statement with the Behance captions in `block-leads.json`
(written by another agent). The Behance captions resolve nothing on their own.

| Block | Official statement            | Behance vignette caption               | Behance overview index                                  | Outcome                                                                                                            |
| ----- | ----------------------------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 37    | Central Library               | CENTRAL LIBRARY                        | RESEARCH                                                | Official source **supports the vignette**, contradicts the index                                                   |
| 35    | Shanti Devi Mittal Auditorium | SHANTI DEVI MITTAL AUDITORIUM          | SHANTIDEVI AUDITORIUM                                   | Official source **agrees with both**                                                                               |
| 13    | Student Welfare Wing          | DIVISION OF STUDENT WELFARE            | STUDENT WELFARE 13 (admin list); BUSINESS 13 (edu list) | Official source **supports the vignette and the admin list**, contradicts "BUSINESS 13"                            |
| 32    | Department of Records         | OFFICE OF VICE CHANCELLORY / ADMIN-III | ADMISSION                                               | **Neither confirmed nor contradicted.** A building can house several offices; the official page names only Records |

Two points for the owner. First, on all three blocks where the official pages and the
Behance sources overlap (13, 35, 37), the Behance **block-vignette** captions agree with the official
wording, while the overview index is wrong for 13 and 37. That is weak evidence
that the vignettes are the more reliable Behance source, but only three data
points support it. Second, the official name "Baldev Raj Mittal Unipolis" carries no
block number on any page checked. It should not be equated with the Behance
"BLOCK-2 … BALDEV RAJ AUDITORIUM".

## Searched, no block number found

| Entity                                                  | Pages searched (all official)                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uni Health Centre / "uni-hospital"                      | student-services/healthcare.php (re-fetched), campus-life/on-campus-jobs.php                                                                          |
| Hostels / residences                                    | student-services/residence.php, international/accommodation.php, freshmeninduction/where-to-stay.php. Only the hostel label "BH4 Playgrounds" appears |
| Division of Admissions / reporting venue                | admission/admissions.php, admission/reporting-schedule.php, freshmeninduction/reporting-process.php, contact-us/contact-us.php                        |
| All 27 schools                                          | /schools/ and its 27 school pages (repo cache from 2026-10-23); none prints a block or campus address line                                            |
| Baldev Raj Mittal Unipolis                              | Named as a venue on the induction schedule, with no block number                                                                                      |
| Uni-Mall (Unicentre), shopping and food                 | student-services/shopping-dining.php, induction schedule                                                                                              |
| Department of Sports                                    | campus-life/sports.php                                                                                                                                |
| Banks, ATMs, post office                                | student-services/banking-postal-services.php                                                                                                          |
| Chancellery, Vice-Chancellor and administration offices | about-lpu/organization-structure.php, rti/, tenders/, student-grievance-redressal.php, anti-ragging.php, caste-based-discrimination.php               |
| International affairs office                            | international/contact-us.php, international-student-services.php, reporting-schedule-pickup-services.php                                              |
| The other 11 library branches                           | academics/libraries.php                                                                                                                               |
| Entrepreneurship, laboratories, research                | campus-life/entrepreneurship.php, academics/laboratories.php, academics/research.php                                                                  |
| Official campus map or how-to-reach page                | sitemap.xml (1,267 URLs) filtered for map, reach, campus and location; freshmeninduction/local-attractions.php and airport-cab-service.php            |

Site searches on the official news site and blog returned nothing usable:
`happenings.lpu.in/?s=` for "block no", "block 32", "block 34" and "block 38",
and `www.lpu.in/blog/?s=` for "block", "block no" and "block-37". The results
were either empty or about blockchain.

## Method and compliance

- Only **official domains** were used: `www.lpu.in` and `happenings.lpu.in`.
  `library.lpu.in` was **not fetched**, because its robots.txt disallows our
  User-Agent. No non-official source (blogs, Quora, Google Maps, Justdial,
  Wikipedia) was consulted, so the "secondary, not used" list is empty.
- `https://www.lpu.in/robots.txt` was re-read on 2026-10-23T22:14Z. Its
  `User-agent: *` group applies, and none of the fetched paths is disallowed.
  Every URL was checked with Python's `RobotFileParser` before it was fetched.
- User-Agent `LPU-Campus-Atlas-research/0.1`. No email or account id was
  placed in any header. Requests ran one at a time, at least 3 s apart: 58
  logged page GETs, including robots.txt, the sitemap and 8 search queries.
  Each batch also made one robots.txt check per host. In
  addition, 29 pages cached in the repo on 2026-10-23 were re-read offline and
  not requested again.
- The raw HTML stays in the session scratchpad and was not written to the repo.
  Following the site terms (`docs/research/LPU_PUBLIC_SOURCES.md`), only the
  four short factual quotes above are kept.
- The text was searched for `block|blk|bldg|building` followed by a number,
  `<n> block`, `uni-hospital`, and `NN-NNN` room codes.
- OSM context, read only: no feature in `data/raw/osm/campus-bbox.osm`, the
  working-copy `public/data/buildings.geojson` (parsed: 131 features, no name
  matches) or `HEAD:public/data/buildings.geojson` (535 features) is named for
  any of these entities. So no name-based anchor is possible either.

## Suggested next steps for the owner

1. Decide whether "Building No. 32" (eSanad page) counts as Block 32.
2. Even the confirmed blocks (13, 32, 35, 37) still need a footprint match from
   **independent** evidence, such as a site visit, a sign photo or an official map.
   Position must not come from the Behance overview.
3. To find more official ties, try printed documents under `/downloads/`. That
   path is disallowed by robots.txt, so this needs the owner's own access or a
   request to LPU. The other option is to ask the university for a campus block
   list.
