/**
 * Admin shell layout with three slots:
 *  - `nav`: section navigation (a left column from 1024 px, collapsible; a scrollable tab row on
 *    phones and tablets, so a tablet's width goes to the section — the Studio map);
 *  - `main`: the active section (full-bleed, so the Studio can host a map);
 *  - aside: filled by the active section through <AdminAside> (a portal), shown only while used.
 * The header shows who is signed in and the sign-out control.
 *
 * Phones: the header is one compact row and the tabs one 44 px row, so the
 * section below (the Studio map) keeps most of the screen height.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { cx, FOCUS_RING } from '../../components/ui/cx.ts';
import { Icon } from '../../components/icons/Icon.tsx';
import { AdminLayoutContext, type AdminLayoutApi } from './layout-context.ts';

export interface AdminLayoutProps {
  header: ReactNode;
  nav: ReactNode;
  main: ReactNode;
  /** Accessible name of the aside region when a section fills it. */
  asideLabel?: string;
}

export function AdminLayout({ header, nav, main, asideLabel = 'Details' }: AdminLayoutProps) {
  const [asideEl, setAsideEl] = useState<HTMLElement | null>(null);
  const [asideUsers, setAsideUsers] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);

  const registerAside = useCallback(() => {
    setAsideUsers((n) => n + 1);
    return () => setAsideUsers((n) => n - 1);
  }, []);
  const api = useMemo<AdminLayoutApi>(
    () => ({ asideElement: asideEl, registerAside, navCollapsed, setNavCollapsed }),
    [asideEl, registerAside, navCollapsed],
  );

  return (
    <AdminLayoutContext value={api}>
      <div className="flex h-dvh min-h-0 flex-col bg-surface text-text">
        <header
          data-testid="admin-header"
          className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-3 py-1 md:px-4 md:py-2"
        >
          <button
            type="button"
            className={cx(
              'hidden size-9 items-center justify-center rounded-md text-muted hover:bg-surface-hover lg:inline-flex',
              FOCUS_RING,
            )}
            aria-label={navCollapsed ? 'Show navigation' : 'Hide navigation'}
            aria-expanded={!navCollapsed}
            aria-controls="admin-nav"
            onClick={() => setNavCollapsed((c) => !c)}
          >
            <Icon name="menu" size={20} />
          </button>
          {header}
        </header>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <nav
            id="admin-nav"
            aria-label="Admin sections"
            className={cx(
              'shrink-0 border-b border-border bg-surface-raised lg:w-56 lg:border-r lg:border-b-0',
              navCollapsed && 'lg:hidden',
            )}
          >
            {nav}
          </nav>
          <main id="admin-main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-auto">
            {main}
          </main>
          <aside
            ref={setAsideEl}
            aria-label={asideLabel}
            hidden={asideUsers === 0}
            className="min-h-0 shrink-0 overflow-auto border-t border-border bg-surface-raised lg:w-80 lg:border-t-0 lg:border-l"
          />
        </div>
      </div>
    </AdminLayoutContext>
  );
}
