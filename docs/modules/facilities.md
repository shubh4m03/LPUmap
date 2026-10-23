# Module: facilities

**Paths:** `src/facilities/` (pure TypeScript) and `src/utils/safe-url.ts`

## Purpose

This module handles the facility directory over all places:

- lookups and counts derived from the data
- opening hours evaluated conservatively in Indian Standard Time
- the nearest facility in a category (by route distance where possible)
- validation of place relations
- safe link builders for external, phone and e-mail links

## Public interface (`src/facilities/index.ts`)

```ts
// hours
parseOpeningHours(raw: string): ParsedHours | null          // null = unsupported syntax → "unknown"
evaluateHours(raw: string | undefined, now: Date, opts?: { retrievedAt?: string; freshnessDays?: number }): HoursEvaluation
  // { state: 'open' | 'closed' | 'unknown' | 'stale'; label; nextChange?: Date; reason? }
evaluateParsedHours, formatScheduleLines(parsed), parseWeekdaySelector, WEEKDAY_CODES, HOURS_LABELS,
CAMPUS_UTC_OFFSET_MIN /* 330 */
// directory
createFacilityDirectory(places, relations): FacilityDirectory
  // all, get(id), byCategory(id), countsByCategory({ located? }?), related(id) → { relation, place, label, direction },
  // isRoutable(place)
RELATION_LABELS, isRoutablePlace
// nearest
findNearest({ origin, categoryId, directory, router?, profile = 'walk', limit = 5 }): NearestResult[]
  // { place, distanceM, distanceKind: 'route' | 'straight-line', durationS? }
NEAREST_ROUTE_CANDIDATES /* 8 */, NEAREST_DEFAULT_LIMIT /* 5 */
// relations
validateRelations(places, relations): RelationIssue[]   // { level: 'error' | 'warning', code, message, ids }
```

`src/utils/safe-url.ts` (no barrel) provides:

- `safeExternalUrl(raw)`: absolute `http(s)` URLs only, or `null`
- `telHref(phone)`: a leading `+` and 6–15 digits, or `null`
- `mailHref(email)`: a single plain address, or `null`

## Opening hours: the supported subset

Supported:

- `24/7`
- rules separated by `;`
- weekday selectors `Mo`..`Su`, with ranges (including wrap-around such as `Fr-Mo`), lists and
  combinations
- `HH:MM-HH:MM` ranges, comma-separated
- `24:00`, or `00:00` as an end, meaning midnight
- overnight ranges, which spill into the next day
- `off` and `closed`
- a rule with no weekday applies every day
- later rules override earlier ones for the days they name

Everything else returns `null`, so the state is **unknown** and the raw text is shown. That includes
`PH`/`SH`, months, weeks, years, sunrise and sunset, `+`, quoted comments, `||`, `unknown`, lowercase
day names and single-digit hours.

Evaluation uses a fixed UTC+05:30 offset, whatever the device time zone. The labels are factual:

- "Open per published hours · closes 22:00"
- "Closed per published hours · opens Mon 09:00"
- "Hours not published"
- "Hours listed but not in a format we can interpret"

If the data's `retrievedAt` is older than `APP_CONFIG.cache.hoursFreshnessDays` (180), or cannot be
read, the state is `stale`. The label then warns that the hours may be outdated, and the computed
openness moves to `reason`.

## Invariants

- No guessed openness. Unsupported or absent hours are always `unknown`, and nothing ever claims
  live status.
- Counts come only from the data. `countsByCategory({ located: true })` counts places with a
  position; the UI uses it so that unlocated places are never called "mapped".
- **Nearest.**
  - Candidates are sorted by haversine distance (ties by id).
  - With a router, the 8 closest are routed. Each result is labelled `route`, or `straight-line` when
    routing fails or throws.
  - Route results come before straight-line ones.
  - An invalid origin, or `limit` 0, returns `[]`.
- `related()` returns both directions with a human label. "Nearby" relations are labelled "Nearby
  (not a physical connection)".
- `validateRelations` reports these errors:
  - duplicate relation id
  - missing endpoint
  - self-relation
  - duplicate relation
  - `located_in` whose target is not a building
  - `accessed_via` whose target is not an entrance or gate
  - `nearby` without a distance

  It also warns about an entrance without access.

## Tests

`tests/unit/facilities/*` (5 files) and `tests/unit/utils/safe-url.test.ts`:

- the hours parser and evaluator: every supported form, every rejected form, overnight spill, IST
  independence from the device time zone, stale handling, labels
- the directory
- nearest (route versus straight-line, router failures, limits)
- relation validation
- URL, tel and mail sanitising (credentials, control characters, protocol-relative URLs, header
  injection)

Fixtures are `tests/unit/facilities/synthetic-places.ts`.

## Known limitations

- **Overnight spill and a later `off`.** `Fr 18:00-02:00; Sa off` evaluates as open at Saturday 01:00,
  because the spill belongs to Friday's rule. This is documented and tested, but it has not been
  cross-checked against opening_hours.js or the OSM wiki.
- **Nearest with a router.** With a router, `findNearest` returns at most 8 results even when
  `limit` is larger. A place outside the 8 straight-line closest is never considered, even if its
  route would be shorter.
- When the next opening is today, the label omits the weekday ("opens 14:00").
- `telHref` rejects values that list several numbers. `mailHref` rejects some valid but unusual
  addresses (quoted local parts, `%`, `&`, `?`) to rule out mailto header injection.
- The real data has almost no `opening_hours` values. Most places show "Hours not published".
