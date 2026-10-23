import { useTheme } from '../../accessibility/index.ts';
import { useAppStore, type OpenPanelId } from '../../app/store/index.ts';
import { Dialog, IconButton, Icon, cx, type IconName } from '../ui/index.ts';

const ENTRIES: ReadonlyArray<{ panel: OpenPanelId; label: string; icon: IconName }> = [
  { panel: 'favorites', label: 'Saved places', icon: 'heart' },
  { panel: 'layers', label: 'Map layers', icon: 'layers' },
  { panel: 'info', label: 'Campus information', icon: 'school' },
  { panel: 'settings', label: 'Settings & privacy', icon: 'settings' },
  { panel: 'about', label: 'About & data sources', icon: 'info' },
];

const ROW = cx(
  'flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-text hover:bg-surface-hover',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
);

/** Menu button with the secondary destinations (saved places, settings, info, about, report). */
export function MoreMenu({ className }: { className?: string }) {
  // In the store (not local state) so the mobile sheet can step down from full height
  // while the menu dialog is open: two modal focus traps would fight over focus.
  const open = useAppStore((s) => s.menuOpen);
  const setOpen = useAppStore((s) => s.setMenuOpen);
  const openPanel = useAppStore((s) => s.openPanel);
  const openReport = useAppStore((s) => s.openReport);
  const { resolved, setPreference } = useTheme();
  const go = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <IconButton
        icon="menu"
        label="Menu"
        variant="secondary"
        size="lg"
        aria-haspopup="dialog"
        className={cx('rounded-full shadow-2', className)}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="Menu" size="sm">
        <ul className="-mx-2 flex flex-col">
          {ENTRIES.map((e) => (
            <li key={e.panel}>
              <button type="button" className={ROW} onClick={() => go(() => openPanel(e.panel))}>
                <Icon name={e.icon} className="text-muted" />
                {e.label}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={ROW} onClick={() => go(() => openReport({}))}>
              <Icon name="flag" className="text-muted" />
              Report a correction
            </button>
          </li>
          <li>
            <button
              type="button"
              className={ROW}
              onClick={() => go(() => setPreference(resolved === 'dark' ? 'light' : 'dark'))}
            >
              <Icon name={resolved === 'dark' ? 'sun' : 'moon'} className="text-muted" />
              {resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            </button>
          </li>
        </ul>
      </Dialog>
    </>
  );
}
