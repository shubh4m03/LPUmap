# Module: design system

**Paths:**

- `src/components/ui/` (primitives)
- `src/components/icons/`
- `src/accessibility/`
- `src/styles/`: `tokens.css`, `index.css` (Tailwind 4 entry), `contrast.ts`

## Purpose

Accessible, themeable building blocks so that feature UIs never hand-roll dialogs, sheets, buttons or
colours. Light and dark themes come from one set of design tokens, and their contrast is verified by
tests.

## Public interface

### `src/components/ui/index.ts`

| Export                                                              | Notes                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `SpinnerGlyph`                                            | Variants: primary, secondary, ghost, danger. Sizes: sm, md, lg. `loading` sets `aria-busy` and blocks clicks. Options for an icon and full width                                                                                                                                                          |
| `IconButton`                                                        | A `label` is required; it becomes `aria-label` and a tooltip                                                                                                                                                                                                                                              |
| `TextInput`, `SearchInput`                                          | Needs `label` or `aria-label` (enforced by the type). Hint and error are linked with `aria-describedby`. The search input clears on Escape                                                                                                                                                                |
| `Dialog`                                                            | Portal, `aria-modal`, focus trap and restore, ref-counted scroll lock, `initialFocus`, `dismissOnScrim`                                                                                                                                                                                                   |
| `BottomSheet`                                                       | Snaps at peek, half and full. Peek and half are regions (content inert at peek); full is a modal dialog with a focus trap. The handle cycles snaps with Enter or Space; pointer drag with spring-back. Also `closestSnap`, `nextSnap`, `snapHeightsPx`, `SNAP_ORDER`, `SHEET_PEEK_PX`, `SHEET_TOP_GAP_PX` |
| `SidePanel`                                                         | An `aside` landmark for the desktop layout                                                                                                                                                                                                                                                                |
| `Badge`, `VerificationBadge`, `VERIFICATION_BADGE`                  | Tones. The verification status is shown as text, an icon and a tooltip, never colour alone                                                                                                                                                                                                                |
| `ToggleChip`, `Switch`, `SegmentedControl<T>`                       | `aria-pressed`; `role="switch"`; a radiogroup with roving tabindex and arrow, Home and End keys                                                                                                                                                                                                           |
| `ResultRow`                                                         | An option or a button, with `aria-selected` and highlighted title segments                                                                                                                                                                                                                                |
| `EmptyState`, `ErrorState`                                          | `ErrorState` is `role="alert"` with an optional retry                                                                                                                                                                                                                                                     |
| `Spinner`, `Skeleton`                                               | `role="status"` with a required label                                                                                                                                                                                                                                                                     |
| `ToastProvider`, `useToast()`                                       | `show(opts)` returns an id; `dismiss(id)`. Polite live region. 5 s by default, or 8 s with an action; `durationMs: null` keeps the toast until dismissed. Pauses on hover and focus; at most 3 at once                                                                                                    |
| `VisuallyHidden`, `Kbd`, `cx`, `lockBodyScroll`, `useScrollLock`    | Utilities                                                                                                                                                                                                                                                                                                 |
| `Icon`, `iconForCategory`, `ICON_NAMES`, `isIconName`, `LiveRegion` | Re-exported for convenience                                                                                                                                                                                                                                                                               |

### `src/components/icons`

`Icon`: inline SVG on a 24 px grid, with a 1.75 stroke in `currentColor`. With a `title` it is
`role="img"`; otherwise it is `aria-hidden`. Also `ICON_PATHS`, and `iconForCategory`, which falls
back to "pin".

### `src/accessibility/index.ts`

- `LiveRegion`, plus `announce` and `useAnnounce` (polite or assertive), and `clearAnnouncements`.
- `useFocusTrap` and `getTabbable`.
- `useMediaQuery`, `useIsMobile` (< 768 px), `useReducedMotion`, `useCoarsePointer`.
- Theme: `useTheme()` returns `{ preference, resolved, setPreference }`. Also `initTheme()`, which is
  called before the first render, plus `createThemeStore`, `applyTheme`, `THEME_STORAGE_KEY`
  (`lpu-atlas:v1:theme`) and `THEME_COLORS`.
- `SkipLink`.

### `src/styles`

- `tokens.css`: `--ds-*` custom properties as plain per-theme blocks. Light is `:root` and
  `html[data-theme='light']`; dark is `html[data-theme='dark']`. The same dark values also apply
  under `prefers-color-scheme: dark` when no light theme is set. `light-dark()` is deliberately not
  used, so that older Safari versions get correct colours.
- `index.css`: Tailwind 4 `@theme inline` mapping to utilities such as `bg-surface`, `text-muted`,
  `border-border-strong`, `outline-focus`, `shadow-1..3`, `rounded-*`, `ease-standard` and `pb-safe`.
- `contrast.ts`: `CONTRAST_PAIRS` and helpers to parse tokens and compute WCAG ratios.

## Invariants

- Feature code uses these primitives and token utilities, never raw colours.
- Every interactive primitive has an accessible name, by type or by prop.
- Every declared foreground/background token pair meets its WCAG target in **both** themes: 4.5:1 for
  text, 3:1 for UI and the focus ring.
- Modals trap and restore focus, and lock body scroll with a reference count. When modals nest (for
  example a confirm dialog opened from a full-height sheet), only the most recently activated trap
  acts.
- Motion respects `prefers-reduced-motion`.
- No `dangerouslySetInnerHTML` (enforced by ESLint).

## Tests

`tests/unit/components/*` (6 files) and `tests/unit/accessibility/*` (4 files):

- Behaviour and keyboard interaction of each primitive. BottomSheet snaps and drag use a mocked
  layout.
- Toasts: timing, pause and limit.
- Icons.
- Focus trap.
- Live region.
- Theme store (system, light, dark; storage failures).
- Contrast of every token pair, parsed from `tokens.css`.
- axe on a kitchen-sink render. The colour-contrast rule is off in jsdom and covered by the contrast
  test instead.

## Known limitations

- jsdom does not enforce `inert` and has no layout. Real-browser bottom-sheet dragging and inert
  content at peek need Playwright or a manual check. `getTabbable` checks visibility on the element
  itself, not its ancestors.
- A toast's live region announces the whole item, so screen readers may also read the "Dismiss
  notification" button.
- With the "system" theme, OS theme changes are tracked live only while a `useTheme()` consumer is
  mounted. The theme is not synced across tabs.
- Icon geometry, dark-theme shadows and the theming of the MapLibre attribution have been reviewed
  only in screenshots, not by a designer.
