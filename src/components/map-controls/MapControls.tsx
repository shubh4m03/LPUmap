import { useTheme } from '../../accessibility/index.ts';
import { getMapController } from '../../app/map-controller.ts';
import { useAppStore } from '../../app/store/index.ts';
import { IconButton, cx } from '../ui/index.ts';
import { LocateButton } from './LocateButton.tsx';
import { ViewModeSwitcher } from './ViewModeSwitcher.tsx';

const STACK = 'flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2';
/**
 * Buttons inside a clipped stack: the focus ring is drawn inset (an outset ring
 * would be cut off by `overflow-hidden`), and the pressed state is shown with a
 * tinted background + accent icon (variant classes, so they win over the base colours).
 */
const IN_STACK =
  'rounded-none border-0 shadow-none focus-visible:-outline-offset-2 ' +
  'aria-pressed:bg-accent-soft aria-pressed:text-accent-text';

/**
 * Vertical map control stack (right side). `compact` is the phone variant.
 * The controls drive whichever view is active (MapLibre map or the overview,
 * both register a MapController); the view-mode switcher replaces the old 3D toggle.
 */
export function MapControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const overview = useAppStore((s) => s.viewMode === 'isometric');
  const layersOpen = useAppStore((s) => s.activePanel === 'layers');
  const openPanel = useAppStore((s) => s.openPanel);
  const closePanel = useAppStore((s) => s.closePanel);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const { resolved, setPreference } = useTheme();
  const size = compact ? 'sm' : 'md';
  // Phones get "Reset view" too (G-13): once the campus is panned or zoomed away, it is the one-tap
  // way back. While the bottom sheet is open it steps aside: the sheet lifts the map attribution
  // to just under the column, and a longer column would cover it (close the sheet, or use the
  // command palette, to reset then).
  const sheetOpen = useAppStore((s) => s.activePanel !== 'none');
  const showReset = !compact || !sheetOpen;

  return (
    <div role="group" aria-label="Map controls" className={cx('flex flex-col items-end gap-2', className)}>
      {compact ? null : (
        <div className={STACK}>
          <IconButton
            icon="plus"
            label="Zoom in"
            className={IN_STACK}
            onClick={() => getMapController()?.zoomIn()}
          />
          <IconButton
            icon="minus"
            label="Zoom out"
            className={IN_STACK}
            onClick={() => getMapController()?.zoomOut()}
          />
        </div>
      )}
      <ViewModeSwitcher compact={compact} />
      <div className={STACK}>
        <IconButton
          icon="compass"
          label={overview ? 'Reset the overview rotation' : 'Reset map to north'}
          size={size}
          className={IN_STACK}
          onClick={() => getMapController()?.resetNorth()}
        />
        <IconButton
          icon="layers"
          label="Map layers"
          aria-pressed={layersOpen}
          size={size}
          className={IN_STACK}
          onClick={() => (layersOpen ? closePanel() : openPanel('layers'))}
        />
        {showReset ? (
          <IconButton
            icon="reset"
            label="Reset view to the whole campus"
            size={size}
            className={IN_STACK}
            onClick={() => requestFocus({ kind: 'reset' })}
          />
        ) : null}
      </div>
      <LocateButton size={size} />
      {compact ? null : (
        <IconButton
          icon={resolved === 'dark' ? 'sun' : 'moon'}
          label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          variant="secondary"
          onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
        />
      )}
    </div>
  );
}
