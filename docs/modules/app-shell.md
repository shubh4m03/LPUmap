# Module: app shell and feature UIs

**Paths:**

- `index.html`, `src/main.tsx`
- `src/app/`:
  - `App.tsx`, `MapStage.tsx`
  - `data/` (loading boundary and services)
  - `store/` (Zustand slices)
  - `hooks/`
  - `commands.ts`, `deep-link.ts`, `place-actions.ts`, `maplibre-worker.ts`
- Feature components under `src/components/`:
  - `layout`, `search`, `place`, `categories`, `layers`, `directions`, `navigation`
  - `favorites`, `settings`, `report`, `about`, `info`, `offline`, `map-controls`

## Purpose

The shell composes the domain modules into the product. It loads and validates the dataset, builds
services, holds UI state, and lays out the map and panels for desktop, phone and map-free (list)
use. It also wires keyboard shortcuts, browser history, deep links, geolocation and announcements.

## Structure

- **`main.tsx`** runs `validateConfig()` and `initTheme()` (before the first render, so there is no
  theme flash), then mounts `<App/>` inside `ToastProvider` and mounts `LiveRegion` once.
- **`App`** renders the skip link, `DataProvider` (with a lazily loaded `AppShell`) and
  `OfflineStatus`.
- **`DataProvider`** calls `loadCampusData()` and shows `LoadingScreen` or `DataErrorScreen` (retry,
  plus a message specific to the error code). It builds services once with `buildServices()` and
  provides them through `useAtlas()`.
- **`buildServices(data)`** creates:
  - `directory`: the facility directory
  - `searchIndex`: categories (+50 boost), places, layers and commands
  - `router`
  - `getPlace`, `categoryCounts`, `locatedCounts` and `sourceName`
- **The store** (`useAppStore`, Zustand) has five slices:

  | Slice       | State                                                                                                                                         |
  | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | `ui`        | Panel stack, palette, menu, report target, category, results query, sheet snap, desktop collapse, list mode and its reason                    |
  | `selection` | `selectedPlaceId` and camera focus requests                                                                                                   |
  | `map`       | `mode3d` (default: 3D at 768 px and wider), `showLabels`, `visibleGroups`. Not persisted                                                      |
  | `route`     | Origin and destination endpoints, profile, preference, result, alternatives, pick-on-map, "My location" endpoint, reroute                     |
  | `nav`       | Geolocation status and the last sample (memory only), navigation progress, follow-me, walk tracking and summary. Started only by user actions |

  Components subscribe with narrow selectors.

- **Layouts:**
  - `DesktopLayout`: side panel plus map.
  - `MobileLayout`: bottom sheet plus a quick-actions bar.
  - `ListLayout`: used when WebGL2 is missing or the map reports a fatal error. It keeps search,
    details, categories and directions.

  Map padding follows the open panel or sheet. Several panels are code-split and load on demand.

- **Hooks:**
  - `useGlobalShortcuts`: <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> toggles the palette;
    <kbd>/</kbd> opens it outside text fields; <kbd>Escape</kbd> closes the topmost layer.
  - `useHistoryLayers`: one history entry per open layer, so Back closes it.
  - `useDeepLink`: reads and writes `?place=` with `replaceState`.
  - `useRouteSolver`: recomputes alternatives when endpoints, profile or preference change.
  - `useGeoFeedback`: announcements and the camera for location.
  - `useCommandRunner`: runs palette commands.
  - `useNow`.
- **Commands** (`src/app/commands.ts`), each wired to a real action:
  - toggle 3D, toggle the dark theme, reset the view
  - show layers, show my location, track my walk
  - saved places, about, settings
  - report a correction, campus information
- **MapStage** connects the store to `MapView`: theme, 3D, groups, labels, selection, the route
  overlay (with completed and alternative parts), user location with its accuracy, and map clicks
  and picks. Follow-me stops when the user pans. It also installs the e2e hook.

## Public surface

The shell has no library-style API. Its contracts are:

- **URL:** `?place=<id>`, where the id matches `osm:(node|way|relation)/<digits>` or `cur:<slug>`;
  and `?e2e=1`, the read-only test hook described in
  [map-buildings3d.md](map-buildings3d.md).
- **Keyboard:** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd>, <kbd>/</kbd>, <kbd>Escape</kbd>, and
  browser Back.
- **Store actions** used across feature components, for example `selectPlace`, `openPanel`,
  `setOrigin`/`setDestination`, `startNavigation`, `startTracking` and `enterListMode`. Their types
  are in `src/app/store/types.ts`, `route-types.ts` and `nav-types.ts`.

## Invariants

- **Honest wording:**
  - Unlocated places are never called "mapped".
  - Distances say whether they are route or straight-line.
  - Inferred "nearby" relations say they are not physical connections.
  - Services without a public source are shown as unavailable, with links to the official pages
    (`src/components/info/info-sources.ts`).
- **Modals:** the palette, report and menu dialogs exclude each other. Focus moves to an opened
  panel's heading and returns to the trigger.
- **Location:** requested only from buttons or commands (`startLocation`, `startNavigation`,
  `startTracking`, "My location" endpoints). A one-shot "My location" releases the watch afterwards
  unless location was already on.
- **Rerouting:** never automatic. "Recalculate from here" is an explicit action, and only from a
  fresh fix.
- **Status:** status messages go through the live region (polite; assertive for arrival, off-route
  and reroute results).

## Tests

`tests/unit/app/*`, `shell/*`, `directions/*`, `navigation-ui/*` and `platform-ui/*` (19 files at
the time of writing) cover:

- store slices and selectors
- deep-link parsing
- data provider screens
- the command palette (including Enter before the debounce settles)
- place details (provenance, related places, actions)
- layers and categories (honest counts)
- the directions panel and endpoint editing
- the navigation HUD (focus, single announcements, the disabled recenter button)
- history layering with an asynchronous `history.go`
- focus rescue
- settings, saved places, the report dialog, and the About and info panels

The shared synthetic dataset is `tests/unit/app/synthetic-campus.ts`. Playwright workflows A–F are
described in [QA_STRATEGY.md](../QA_STRATEGY.md).

## Known limitations

These come from the UI-stage browser reviews. They are not all re-verified after later changes.

- **Changed after the review; recheck in a browser.**
  - The review found that a modal opened from inside a full-height BottomSheet made the two focus
    traps conflict. `useFocusTrap` now keeps a stack of traps, and only the newest one acts.
  - The review found that the one-time "Ready to work offline" toast could cover a dialog's footer on
    phones. Toasts now keep clear of open modals (`src/components/ui/modal-presence.ts`,
    `toast-offset.ts`).
- **Banners under the full sheet.** On phones, while the sheet is at full height, the offline and
  update banners are hidden under it.
- **Truncated relation subtitles.** Long related-place subtitles are truncated in the 384 px panel;
  the full text is in the accessible name.
- **Palette Escape.** The first <kbd>Escape</kbd> clears the query and the second closes the
  palette (the hint says so).
- **Far-away first fix.** When the user is far off campus, the first fix after starting location
  moves the map to an empty area until a place or route is focused.
- **LocateButton** stop also ends navigation and tracking, by design.
- **Unverified in a real browser:** touch-dragging the sheet, Web Share, the real service-worker
  update prompt, and screen-reader output. See
  [QA_STRATEGY.md](../QA_STRATEGY.md#what-needs-human-or-on-device-verification).
