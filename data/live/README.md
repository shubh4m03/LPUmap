# data/live — dynamic feeds (intentionally empty)

This folder holds **no data** in v1, and that is deliberate.

Mess menus, campus events, shuttle/bus timings, crowd levels and "open now"
status change daily or hourly. For Lovely Professional University we found **no
official, public, machine-readable and reuse-permitted source** for any of them
(investigated 2026-10-23; details and URLs in
[`docs/research/LPU_PUBLIC_SOURCES.md`](../../docs/research/LPU_PUBLIC_SOURCES.md)):

| Feed | What exists publicly | Why it is not shipped |
|---|---|---|
| Mess / dining menus | `student-services/residence.php` and `shopping-dining.php` describe that a mess, food courts and kiosks exist. | No menu, no meal times, no per-mess listing. |
| Day-scholar bus / shuttle | `student-services/transport.php` lists off-campus pickup points and tentative annual charges, and says the next session's details are "to be updated". | No timetable, no departure times, no on-campus shuttle; it is not a schedule. |
| Events | `campus-life/campus-events.php` and the `happenings.lpu.in` RSS feed are retrospective news write-ups. | No upcoming dates, venues or times; copyright text, non-commercial terms. |
| Live status / opening hours | None. | Nothing official to read from. |

Until such a source exists, the app shows an **honest empty state**
("No official schedule is published, so none is shown"). It never shows
sample, cached-forever or crowd-sourced data as if it were official.

## Contract a future feed must meet

A feed may be added here only if **all** of the following hold. Any reviewer
should reject a feed that misses one.

1. **Official source.** Published by LPU (or the operator named by LPU) at a
   stable public URL with no login. Allowed by `robots.txt` and the site's
   terms for our use. Record the URL and the terms you checked.
2. **Provenance on every file.** Top-level fields:
   - `source`: `{ "name": string, "url": "https://…" }`
   - `retrievedAt`: ISO 8601 timestamp of the fetch (not of the build)
   - `validFrom` / `validUntil`: ISO dates the content claims to cover, if stated
   - `staleAfterHours`: number (see below)
3. **Staleness window.** Each feed declares how old it may get before the UI
   must stop presenting it as current. Suggested maximums: menus 24 h, bus
   timetables 7 days (and never past `validUntil`), events 24 h. A stale feed
   renders as "Last updated <date> — may be out of date", and an expired one
   (past `validUntil`) renders as unavailable.
4. **Schema first.** Add a Zod schema in `src/data/schema.ts` (bump
   `DATA_SCHEMA_VERSION` if needed) and validate the file in the data pipeline
   and at load time. Unknown fields stay unknown. Never default a missing time
   to a guessed value.
5. **Places by id only.** Any location reference uses an existing place id
   (`osm:…` or `cur:…`). A feed must never introduce coordinates or a venue
   that is not already a sourced place.
6. **Fail closed.** A failed refresh keeps the previous file, never writes a
   partial one, and never fabricates entries. The refresher follows the same
   rules as `scripts/fetch-public-data.ts`: obey robots.txt, run one request at
   a time with backoff, send the neutral `LPU-Campus-Atlas-research/0.1` User-Agent, and refuse a
   suspicious drop in record count.
7. **No personal data.** No names of staff or students, phone numbers of
   individuals, or anything not meant for public reuse.
