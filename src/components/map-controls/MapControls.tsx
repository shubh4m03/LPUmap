import { useAnnounce, useTheme } from '../../accessibility/index.ts';
import { getMapController } from '../../app/map-controller.ts';
import { useAppStore } from '../../app/store/index.ts';
import { IconButton, cx } from '../ui/index.ts';
import { LocateButton } from './LocateButton.tsx';

const STACK = 'flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2';
/**
 * Buttons inside a clipped stack: the focus ring is drawn inset (an outset ring
 * would be cut off by `overflow-hidden`), and the pressed state is shown with a
 * tinted background + accent icon (variant classes, so they win over the base colours).
 */
const IN_STACK =
  'rounded-none border-0 shadow-none focus-visible:-outline-offset-2 ' +
  'aria-pressed:bg-accent-soft aria-pressed:text-accent-text';

/** Vertical map control stack (right side). `compact` is the phone variant. */
export function MapControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const mode3d = useAppStore((s) => s.mode3d);
  const toggleMode3d = useAppStore((s) => s.toggleMode3d);
  const layersOpen = useAppStore((s) => s.activePanel === 'layers');
  const openPanel = useAppStore((s) => s.openPanel);
  const closePanel = useAppStore((s) => s.closePanel);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const { resolved, setPreference } = useTheme();
  const announce = useAnnounce();
  const size = compact ? 'sm' : 'md';

  const toggle3d = () => {
    toggleMode3d();
    announce(mode3d ? 'Flat 2D map' : '3D buildings on');
  };

  return (
    <div role="group" aria-label="Map controls" className={cx('flex flex-col gap-2', className)}>
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
      <div className={STACK}>
        <IconButton
          icon="compass"
          label="Reset map to north"
          size={size}
          className={IN_STACK}
          onClick={() => getMapController()?.resetNorth()}
        />
        <IconButton
          icon={mode3d ? 'cube' : 'map-2d'}
          label="3D buildings"
          aria-pressed={mode3d}
          size={size}
          className={IN_STACK}
          onClick={toggle3d}
        />
        <IconButton
          icon="layers"
          label="Map layers"
          aria-pressed={layersOpen}
          size={size}
          className={IN_STACK}
          onClick={() => (layersOpen ? closePanel() : openPanel('layers'))}
        />
        {compact ? null : (
          <IconButton
            icon="reset"
            label="Reset view to the whole campus"
            className={IN_STACK}
            onClick={() => requestFocus({ kind: 'reset' })}
          />
        )}
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
