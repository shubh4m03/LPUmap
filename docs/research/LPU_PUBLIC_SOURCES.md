# LPU public sources: what was examined and what we use

Research date: **2026-10-23**. All requests were plain HTTPS GETs with a
descriptive User-Agent, run one at a time with at least 2–3 s between them.
No login, form, API key or private portal was used, and no access control was
bypassed. Wikipedia was not fetched; Wikidata covers the same facts under CC0.

Outcome: `data/curated/organizations.json` has **32 records**. These are 27
schools/disciplines from the official schools index, 2 umbrella school names
printed on school pages, and 3 named facilities. All are `kind: "organization"`
with **no coordinates**. Only one is anchored to the map: "School of Design",
whose OSM building carries exactly that name. `scripts/fetch-public-data.ts`
reproduces the file.

## robots.txt findings

- `https://www.lpu.in/robots.txt` (HTTP 200). Our crawler matches no named
  group, so the `User-agent: *` group applies. It disallows `/admin`, `/test`,
  `/demo*`, `/files`, `/downloads`, `/Login.aspx`, `/sustainable`,
  `/annual-report`, `/edurev`, `/academics/iqac.php`, `/result.php`, several
  legacy/campaign paths, and tracking-parameter URLs (`/*?utm_source=` etc.).
  `/schools/`, `/student-services/`, `/academics/libraries.php`, `/campus-life/`,
  `/about-lpu/`, `/faculty/` and the legal pages are **not** disallowed.
  Sitemap: `https://www.lpu.in/sitemap.xml` (1,267 URLs, used only to find pages).
- NIRF PDFs and other documents under `/downloads/` are disallowed, so they were
  **not fetched**.
- `https://iviewd.com/robots.txt`: allows all, `Crawl-delay: 3`.
- `https://happenings.lpu.in/robots.txt`: allows all.

## Terms of use (important for reuse)

`https://www.lpu.in/terms-conditions.php` says all site content (text, graphics,
images, logos) is copyright LPU or its licensors. Visitors may view and
download it "for personal, non-commercial use only", and any other
reproduction or distribution is prohibited. `https://www.lpu.in/disclaimer.php`
says the information may be incomplete or out of date and should be confirmed
with officials.

Consequences:

- We copy **no prose, images or logos**. We keep only short factual
  identifiers: the official name of a school or facility, the page URL and the
  page title as a citation. Descriptions are our own one-line templates.
- Raw HTML is cached only under the git-ignored `data/.cache/lpu/` and is
  **never committed or redistributed**. `data/raw/lpu/public-pages.snapshot.json`
  holds only URLs, titles, byte counts, SHA-256 hashes and the index labels.
- Every record is `verificationStatus: "imported"`. Per the disclaimer, the UI
  should not present them as verified.

## Every URL examined

| URL                                                                                             | Contains                                                                                                                                                   | Map position?          | Decision                                                                                               |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------ |
| https://www.lpu.in/robots.txt                                                                   | Crawl rules (above)                                                                                                                                        | —                      | Obeyed; checked by the script on every run                                                             |
| https://www.lpu.in/sitemap.xml                                                                  | 1,267 page URLs                                                                                                                                            | —                      | Used only to discover pages                                                                            |
| https://www.lpu.in/                                                                             | Home page: rankings and news. Links a "Virtual Tour"                                                                                                       | No                     | Not used                                                                                               |
| https://www.lpu.in/schools/                                                                     | "LPU Schools and Department List": 27 cards, each with a discipline label and a link to `/schools/<slug>/`                                                 | No                     | **Used**: source of the school list                                                                    |
| https://www.lpu.in/schools/&lt;slug&gt;/ (27 pages, e.g. `/schools/law/`, `/schools/business/`) | School pages: hero heading, programmes, dean's message. Some print a full name ("School of Law", "Mittal School of Business")                              | No                     | **Used**: official name where printed (rule below)                                                     |
| https://www.lpu.in/student-services/ and …/residence.php                                        | Hostels & residences: room types, fees for 2026-27, a mess and laundry exist, managed by "Pro Bricks". No hostel names or blocks                           | No                     | Not used (no named, positioned facility)                                                               |
| https://www.lpu.in/student-services/healthcare.php                                              | "Uni Health Centre": 24×7 emergency, beds, chemist, ambulances, helpline numbers                                                                           | No                     | **Used**: name only (`cur:uni-health-centre`). Phone numbers not imported (see Not available)          |
| https://www.lpu.in/student-services/shopping-dining.php                                         | A "university mall" with food courts, cafés and stores, some named by brand                                                                                | No                     | Not used: third-party brands, no positions                                                             |
| https://www.lpu.in/student-services/banking-postal-services.php                                 | Partnerships with five banks (unnamed), an e-lobby, ATMs "strategically located", an on-campus post office                                                 | No                     | Not used: nothing named or positioned                                                                  |
| https://www.lpu.in/student-services/transport.php                                               | Day-scholar bus routes from Punjab cities with pickup points and "tentative annual charges"; parking exists                                                | No                     | Not used: not a timetable (see `data/live/README.md`)                                                  |
| https://www.lpu.in/academics/libraries.php                                                      | 12 library branches; "Central Library located in Block-37"; service timings                                                                                | No (block number only) | **Used**: `cur:central-library`, with its Block-37 statement in the description. Not placed on the map |
| https://www.lpu.in/campus-life/sports.php                                                       | Achievements and a sports list; "Department of Sports" with public contact details                                                                         | No                     | **Used**: name only (`cur:department-of-sports`)                                                       |
| https://www.lpu.in/about-lpu/infrastructure.php                                                 | Photo gallery of labs, sculptures and green campus                                                                                                         | No                     | Not used                                                                                               |
| https://www.lpu.in/campus-life/campus-events.php                                                | Past event write-ups                                                                                                                                       | No                     | Not used: news, not a schedule                                                                         |
| https://www.lpu.in/campus-life/visitors.php                                                     | Notable past visitors                                                                                                                                      | No                     | Not used                                                                                               |
| https://www.lpu.in/faculty/                                                                     | Faculty landing page with categories and a "filter by school" control                                                                                      | No                     | Not used (see faculty directory)                                                                       |
| https://www.lpu.in/faculty/regular-faculty.php                                                  | Faculty listing page; profiles of named people                                                                                                             | No                     | **Not used**: personal data                                                                            |
| https://www.lpu.in/terms-conditions.php                                                         | Terms of use (above)                                                                                                                                       | —                      | Governs reuse                                                                                          |
| https://www.lpu.in/disclaimer.php                                                               | Accuracy disclaimer                                                                                                                                        | —                      | Governs presentation                                                                                   |
| https://iviewd.com/lpu2/                                                                        | Third-party 360° panorama viewer (page title "360 Virtual Tour, LPU Jalandhar") linked from lpu.in                                                         | No coordinates exposed | Not used: panoramas, no reuse licence                                                                  |
| https://happenings.lpu.in/feed/                                                                 | RSS of LPU news posts (latest 2026-10-21)                                                                                                                  | No                     | Not used: news, not events with dates and venues                                                       |
| https://www.wikidata.org/wiki/Special:EntityData/Q5756621.json                                  | Lovely Professional University: official website `https://www.lpu.in`, inception 2005, coordinate 31.25536 N 75.70389 E, ROR `00et6q107`, alias "LPU". CC0 | Point only             | Cited for facts; the app already uses the OSM boundary, so nothing imported                            |

Not examined: `ums.lpu.in` (login portal), `library.lpu.in` (OPAC search tool),
`webapi.lpu.in` (undocumented API that the site calls from JavaScript), and
anything under disallowed paths.

## How names are chosen (reproducible rule)

1. The card label on `/schools/` is the baseline name, e.g. "Commerce and
   Economics".
2. If the school's own page prints "School of &lt;label&gt;" (treating `&` and
   "and" as equal), that printed form is used. Example: "School of Hotel
   Management & Tourism".
3. A proper-noun prefix before "School" is kept only when that exact form
   appears at least twice. Flattened text can glue a neighbouring heading onto
   the name, which produced "Time School of Law" before this rule. With it,
   "Mittal School of Business" is kept.
4. A match is rejected when the name continues ("School of Planning and
   Architecture, New Delhi") or names another institution ("School of
   Planning, GNDU"). The planning page mentions both, so its record stays
   "Planning".
5. The label becomes an alias only if it is not already contained in the name.
   It currently never is, so no aliases ship. No abbreviation (e.g. "MSOB") was
   printed on the pages, so none was added.
6. Umbrella names ("School of Design", "School of Liberal and Creative Arts")
   and facilities ("Central Library", "Uni Health Centre", "Department of
   Sports") are listed in the script, but a record is emitted only if the name
   is found verbatim in the fetched page.

## Map anchors

Anchors are curated by hand and preserved by the refresher. The rule: anchor
only where an OSM feature carries the **same name** as the official record and
lies inside the campus boundary (relation 21599790).

| OSM feature   | OSM name                                                       | Centroid (lon, lat) | Official match                                                                                                                     | Decision                                              |
| ------------- | -------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| way 425717552 | School of Design (`office=educational_institution`, 10 levels) | 75.70703, 31.25665  | "School of Design" printed on the fashion, interior and multimedia pages                                                           | **Anchored** to `cur:school-of-design`                |
| way 354743583 | Lovely Institute Of Management                                 | 75.70886, 31.25860  | Not printed on any fetched official page                                                                                           | No record, no anchor. The building keeps its OSM name |
| way 354755644 | Lovely Institute of Technology                                 | 75.70689, 31.25789  | Not printed on any fetched official page                                                                                           | No record, no anchor                                  |
| way 354830243 | Lovely Institute of Pharmacy                                   | 75.70727, 31.25762  | Not on the fetched pages. The current unit is "School of Pharmaceutical Sciences", and assuming they are the same would be a guess | No anchor                                             |

## Faculty directory: decision

Official faculty listing pages exist (`/faculty/` and subpages). They are
**not shipped in v1**:

- They are personal data (names, photos, designations) of identifiable people.
- The site terms forbid reproduction beyond personal, non-commercial use.
- They are not a structured, reuse-licensed dataset, and the listing loads
  through an undocumented API.
- Faculty office locations are not published, so a directory would add
  nothing to the map.

Revisit only if LPU publishes an official, structured directory with explicit
reuse permission.

## Not available (honest empty states)

| Item                           | Finding                                                                                                                                                                                                                         | What the app does                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Mess menus                     | No official public menu found. Residence page only says a mess exists                                                                                                                                                           | Empty state; no menu                                                     |
| Shuttle / bus schedule         | Transport page lists pickup points and annual charges, no times. No on-campus shuttle info                                                                                                                                      | "No official schedule published"                                         |
| Faculty offices                | Not published; directory not imported (above)                                                                                                                                                                                   | Not offered                                                              |
| Block-number positions         | Pages mention blocks ("Central Library … Block-37") but no official map gives block positions. "Block NN" names are absent from OSM                                                                                             | Block numbers are not placed on the map. Central Library stays unlocated |
| Washrooms / water points       | Not published; not mapped in OSM                                                                                                                                                                                                | Category shows an empty state                                            |
| Opening hours                  | Library services give timings (circulation 8:00 am–9:00 pm, documentation 9:00 am–5:00 pm). The health centre says it runs 24×7. None is tied to a mapped feature, and the disclaimer warns that information may be out of date | Not imported as `openingHours`; hours show as unknown                    |
| Bank / ATM names and locations | "Five banks" and ATMs mentioned, none named or positioned                                                                                                                                                                       | Only OSM-mapped ATMs/banks appear                                        |
| Official campus map            | None found on the fetched pages. The only visual is the third-party 360° tour                                                                                                                                                   | Map is built from OSM only                                               |
| Events feed                    | Only retrospective news (page + RSS)                                                                                                                                                                                            | No events module data                                                    |

## Refreshing

```sh
npm run data:fetch-public -- --dry-run   # fetch, print diff, write nothing
npm run data:fetch-public                # write organizations.json + snapshot
npm run data:fetch-public -- --offline   # re-extract from data/.cache/lpu only
```

The script fetches about 31 pages, one at a time, with 2 s between requests.
It uses a 20 s timeout and 3 retries with exponential backoff on network
errors, 429 and 5xx. It refuses redirects off www.lpu.in. If extraction yields
zero records, or drops more than 40% against the current file, it exits with
code 2 and leaves the file untouched. The normal build does not need it.

Requests send the neutral User-Agent `LPU-Campus-Atlas-research/0.1`, with no contact or personal identifier.
robots.txt groups are matched on its exact product token (`LPU-Campus-Atlas-research`; the
2026-10-23 snapshot was taken under the earlier token `LPUCampusAtlasDataBot`), never
by substring, and a robots.txt that redirects off-site aborts the run. With `--offline`,
`retrievedAt` is the date of the oldest cached page (file modification time), not the
day of the re-extraction, so provenance never looks fresher than the HTML it came from.
