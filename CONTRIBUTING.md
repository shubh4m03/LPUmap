# Contributing to LPU Campus Atlas

Thank you for helping. This project has one rule above all others: **never fabricate**. That covers
names, coordinates, opening hours, routes, people, accessibility and live status. When something is
unknown, the app says it is unknown. A contribution that makes the app look more complete by guessing
will be declined, however useful it seems.

## Getting set up

Use Node.js 24 or newer (see `.nvmrc`) and npm.

```sh
npm ci
npm run dev
npx playwright install chromium   # once, for end-to-end tests
```

## Coding standards

**Contracts first**

- Every module's public interface is in [docs/MODULE_CONTRACTS.md](docs/MODULE_CONTRACTS.md) and
  described in [docs/modules/](docs/modules/).
- A module's `index.ts` is its only public entry point. Import from it, never from another module's
  internals. The documented exceptions are `src/utils/*`, which has no barrel, and the same-owner
  imports noted in the module docs.
- If you change a public interface, update the contract and the module doc in the same PR.

**TypeScript**

- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- **Explicit extensions** on every relative import (`./foo.ts`, `./Bar.tsx`). `src/data/schema.ts`,
  `src/config/*`, `src/distance/*`, `src/routing/*` and others are also run directly by Node 24's
  type stripping from `scripts/*.ts`.
- **Erasable syntax only** (`erasableSyntaxOnly`): no `enum`, no `namespace`, no constructor
  parameter properties. Use `as const` objects and union types instead.
- Use `import type` for type-only imports. ESLint enforces `consistent-type-imports`.

**Domain rules**

- **Coordinates** are `[lon, lat]` (GeoJSON order) everywhere.
- **Distances** come only from `src/distance` (`haversineM` and the polyline helpers).
- **Tunable numbers** (speeds, thresholds, budgets, colours) live in `src/config` (`APP_CONFIG`,
  `CATEGORIES`). Algorithm-internal constants are named exports with a comment, never inline
  literals.
- **Data types** come from `src/data/schema.ts` (inferred from Zod). Data crossing a trust boundary
  (fetched files, local storage, URL parameters) is validated before use.
- **Pure modules stay pure.** `distance`, `routing`, `search`, `facilities`, `navigation` and the
  geolocation filter must not import React, MapLibre or the DOM.

**Security and privacy**

- **No HTML injection.** Render text with React. `dangerouslySetInnerHTML` is banned by an ESLint
  rule. External links go through `safeExternalUrl`, phone links through `telHref` and e-mail links
  through `mailHref` (`src/utils/safe-url.ts`).
- **No new network origins.** The CSP in `public/_headers` allows `'self'` plus exactly the two
  optional imagery hosts (Esri World Imagery and the EOX backdrop, used only when a build configures
  them). Do not add third-party tiles, fonts, analytics or CDNs; a new origin needs an owner decision,
  a CSP change and an update to [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md).
- **Location stays on the device.** Never log, persist or transmit user coordinates.
- **Local storage** goes through `createStorage` (`src/utils/storage.ts`), which validates and
  versions every key under `lpu-atlas:v1:`. Add any new key (and any Cache Storage name) to the
  storage inventory in [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) and to the
  privacy facts; `tests/unit/docs/docs-integrity.test.ts` fails when a key in the code is missing
  there.

**UI**

- **Design system only.** Use the primitives in `src/components/ui` (Button, IconButton, Dialog,
  BottomSheet, SidePanel, Badge, ResultRow, EmptyState, …) and the token-backed Tailwind utilities
  (`bg-surface`, `text-muted`, `border-border-strong`, …). Raw hex colours and ad-hoc spacing scales
  are not accepted. Map colours live in `src/styles/map-theme-colors.ts`, because MapLibre cannot read CSS
  variables; keep them in step with `src/styles/tokens.css`.
- **Accessibility.** WCAG 2.2 AA is the intent. Every control needs an accessible name. Keyboard
  operation must be complete, focus must be visible and managed, and status changes are announced
  through the live region. Respect `prefers-reduced-motion`. Never use colour as the only signal.
- **Small, cohesive files.** Aim for under about 300 lines and split by responsibility.
- **Formatting** is Prettier (`npm run format`). Lint must pass with zero warnings.

## Server, D1 and migrations

The owner features run on Cloudflare Pages Functions (`functions/`, thin entry points) over
`server/` (HTTP layer, handlers, auth, domain logic, D1 repositories). Contracts:
[docs/COMMUNITY_MODULE_CONTRACTS.md](docs/COMMUNITY_MODULE_CONTRACTS.md),
[docs/BUILDING_STUDIO_DESIGN.md](docs/BUILDING_STUDIO_DESIGN.md) and
[docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md](docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md) §4; operations:
[docs/ADMIN_OPERATIONS.md](docs/ADMIN_OPERATIONS.md).

- **Server code never imports React, the DOM, MapLibre or `src/app`/`src/components`/`src/admin`.**
  It may import the pure shared modules (`src/community`, `src/building-studio` core, `src/data`,
  `src/geo`, `src/config`, the `src/isometric-art` schema). See the dependency rules in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#module-dependency-rules).
- **Typecheck and test both sides.** `npm run typecheck:server` (`tsconfig.server.json`) and
  `npm run test:server` (`vitest.server.config.ts`: `tests/server/**` on a local in-memory D1 through
  wrangler's `getPlatformProxy`) are part of `npm run check` and CI.
- **Fail closed and audit.** Admin routes answer 503 without `AUTH_MODE`; every write is one D1
  transaction with an audit row and a `revision` check (409 on conflict). New routes get an entry in
  the route audit spec and a test in `tests/server/security/`.
- **Migrations.** Add a new numbered file in `migrations/` (never edit an applied one), a down script
  in `docs/db/` that keeps the owner's data where it can, and a test in `tests/server/migrations/`
  that applies it to a fresh and a populated database, proves a failing statement leaves nothing
  applied, runs the down script and re-applies. Document the order (migration before code) in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Run `npm run db:migrate:local` for local development.
- **Never touch a remote database** from tests or scripts. Never commit `.dev.vars`, secrets, a
  password hash or an Access audience value.
- **End-to-end** admin, suggestion, Studio and artwork specs run the real handlers through
  `tests/e2e/backend/server.ts` (in-memory D1, throwaway password); extend that harness rather than
  mocking the API.

## Contributing data

Read [data/README.md](data/README.md) and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) first.

1. **Prefer fixing OpenStreetMap upstream.** A missing building name, footpath, entrance, step or
   wheelchair tag is best added in [OpenStreetMap](https://www.openstreetmap.org/) itself, following
   OSM's own rules: survey or properly licensed sources only, and no copying from Google Maps. Then
   refresh the snapshot (`npm run data:fetch -- --force`, `npm run data:check`). Everyone benefits,
   and the provenance stays clean.
2. **Real sources only.** Every curated record cites `source.name`, `source.url` and
   `source.retrievedAt`. "I remember it from campus" is not a source for this repository; record it
   in OSM after a survey instead.
3. **Never invent coordinates.** Curated records get a position only through an `anchor.target` that
   is an existing OSM id in the committed snapshot (`osm:way/123`). An unresolved anchor fails the
   build on purpose. Anchor only where the OSM feature carries the same name as the cited record and
   lies inside the campus boundary.
4. **Aliases** (`data/curated/aliases.json`) may be added only when a cited public source ties that
   exact name (for example a block number) to that exact mapped feature. No guessed block numbers.
5. **Overrides** (`data/curated/overrides.json`) must state how they were checked in the `check`
   field:
   - `physical-survey`: someone checked it on site. Marks the record `verified`, with
     `lastVerifiedAt`.
   - `official-publication`: an official LPU publication states it. Also `verified`.
   - `unverified-report`: applied, but the record becomes `unverified`, and the date is kept only in
     the provenance notes.

   Overrides can set `name`, `categoryId`, `description`, `openingHours` and `wheelchair`. Opening
   hours use OSM `opening_hours` syntax; see the supported subset in
   [docs/modules/facilities.md](docs/modules/facilities.md).

6. **Organizations** (`data/curated/organizations.json`) are produced by
   `npm run data:fetch-public` from official pages. Do not hand-edit names. Anchors are the only
   hand-curated part, and the refresher preserves them.
7. **LPU content is not ours.** Store only short factual identifiers and citations. Never commit LPU
   prose, images, logos or cached HTML; `data/.cache/` is git-ignored for this reason.
8. **Personal data is out of scope.** That includes faculty names, phone extensions of individuals
   and photos.
9. After any data change, run `npm run data:check`. Read the count-change warnings and
   `docs/DATA_QUALITY_REPORT.md`, then commit the raw, curated and generated files together.

JSON Schemas for the curated formats are regenerated in `data/schemas/` on every build, for editor
validation.

## Test requirements

- **Every behaviour change comes with a test.** Pure logic gets a unit test in
  `tests/unit/<module>/`. UI gets a React Testing Library test; prefer role- and name-based queries.
  A bug fix gets a regression test that fails without the fix.
- **Fixtures** live in `tests/fixtures/` (or next to the suite). Invented geometry or data must be
  named `synthetic-*`, so it can never be mistaken for real LPU data.
- **Never weaken a meaningful assertion** to make a test pass. Fix the cause, or explain in the PR
  why the expectation was wrong.
- Data pipeline changes need `tests/integration/pipeline*.test.ts` to pass. The real-snapshot test
  guards the committed dataset.
- User-visible flows need an end-to-end check in `tests/e2e/` across the Playwright viewports (see
  [docs/QA_STRATEGY.md](docs/QA_STRATEGY.md)). A test that applies only to some viewports skips with
  a reason that has a rule in `scripts/ci/skip-policy.ts`; any other skip fails CI.
- A test that measures wall-clock time goes in the serial `test:perf` list in `package.json` (and is
  excluded from `test`); `tests/unit/ci/gates.test.ts` enforces it. Never relax a budget to pass.
- Server behaviour needs a test in `tests/server/` (local in-memory D1); a security-relevant change
  also needs an attack case in `tests/server/security/`.

## Pull request checklist

- [ ] `npm run check` passes locally: format, lint, both typechecks (`typecheck`,
      `typecheck:server`), the browser check, unit and integration tests, the serial budget suites
      (`test:perf`), the server suites (`test:server`), `data:check`, `art:check`, build,
      `art:check-dist`, smoke, bundle budgets (`perf:bundle`) and e2e. CI runs the same gates.
- [ ] No Playwright test is skipped outside the rules in `scripts/ci/skip-policy.ts` (the e2e run
      prints the skip summary; a new viewport-specific skip needs a rule with its reason).
- [ ] Server changes: `npm run typecheck:server` and `npm run test:server` pass; a new D1 migration
      has a down script in `docs/db/`, a migration test and a deployment note.
- [ ] No fabricated data. Every new or changed record cites a real source, and no coordinates were
      typed in by hand.
- [ ] Public interfaces unchanged, or `docs/MODULE_CONTRACTS.md` and `docs/modules/*` updated.
- [ ] Explicit `.ts`/`.tsx` import extensions, erasable TypeScript only, no new `any`.
- [ ] No `dangerouslySetInnerHTML`, no unsanitised external URLs, no new third-party origins.
- [ ] No new dependency without discussion. If one is added, it has an exact version and the
      lockfile is committed.
- [ ] New local-storage keys are documented in `docs/SECURITY_AND_PRIVACY.md` and the privacy facts.
- [ ] UI uses design-system primitives and tokens. Keyboard, screen-reader names, focus, contrast and
      reduced motion were checked.
- [ ] Tests added or updated. Synthetic fixtures are named `synthetic-*`.
- [ ] Docs updated where behaviour, commands or limitations changed.

## Reporting a data error without code

Use "Report a correction" in the app. It produces a plain-text report, without your location, that
you can copy, download or (if the deployment configures it) open as a prefilled issue.
