/**
 * The owner admin app at /admin (a lazy chunk; src/main.tsx loads it only on
 * /admin paths, so none of this is in the public entry). Shell: session gate
 * → layout (header / nav / main / aside slots) → the active section.
 */
import { Suspense, useEffect, useState } from 'react';
import { Button } from '../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../components/ui/cx.ts';
import { Spinner } from '../components/ui/Spinner.tsx';
import { AdminContext, createAdminServices, useAdminSessionClient, type AdminServices } from './context.ts';
import type { SessionInfo } from './api/schemas.ts';
import { AdminLayout } from './layout/AdminLayout.tsx';
import { SectionBoundary } from './layout/SectionBoundary.tsx';
import { useAdminRouter } from './router.ts';
import { ADMIN_SECTION_LABELS, ADMIN_SECTIONS, adminHref, DEFAULT_ADMIN_SECTION } from './routes.ts';
import { SECTION_COMPONENTS } from './sections/registry.ts';
import { SessionGate } from './session/SessionGate.tsx';

export interface AdminAppProps {
  /** Injected in tests; built once otherwise. */
  services?: AdminServices;
}

/** Marks the admin as not for search engines and names the tab. */
function useAdminDocument(): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Admin · LPU Campus Atlas';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.title = previousTitle;
      meta.remove();
    };
  }, []);
}

export function AdminApp({ services }: AdminAppProps) {
  const [svc] = useState(() => services ?? createAdminServices());
  useAdminDocument();
  useEffect(() => {
    void svc.session.check();
  }, [svc]);
  return (
    <AdminContext value={svc}>
      <SessionGate>{(session) => <AdminShell session={session} />}</SessionGate>
    </AdminContext>
  );
}

function AdminShell({ session }: { session: SessionInfo }) {
  const { route, navigate } = useAdminRouter();
  const client = useAdminSessionClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Unknown /admin paths go to the default section (never a blank page).
  useEffect(() => {
    if (route === null) navigate({ section: DEFAULT_ADMIN_SECTION }, { replace: true });
  }, [route, navigate]);

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    const r = await client.logout();
    setSigningOut(false);
    if (!r.ok) setSignOutError(r.message);
    else if (r.redirectTo) window.location.assign(r.redirectTo);
  };

  const Section = route ? SECTION_COMPONENTS[route.section] : null;

  return (
    <AdminLayout
      header={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
            <p className="font-semibold">Campus Atlas admin</p>
            <p className="min-w-0 truncate text-sm text-muted">
              Signed in as <span className="font-medium text-text">{session.actor}</span>
              {session.mode === 'access' ? ' (Cloudflare Access)' : ''}
            </p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            {signOutError ? (
              <p role="alert" className="max-w-xs text-xs text-danger">
                {signOutError}
              </p>
            ) : null}
            <Button size="sm" variant="secondary" loading={signingOut} onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      }
      nav={
        <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
          {ADMIN_SECTIONS.map((s) => {
            const current = route?.section === s;
            return (
              <li key={s} className="shrink-0">
                <a
                  href={adminHref({ section: s })}
                  aria-current={current ? 'page' : undefined}
                  onClick={(e) => {
                    if (
                      e.defaultPrevented ||
                      e.button !== 0 ||
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.altKey
                    )
                      return;
                    e.preventDefault();
                    navigate({ section: s });
                  }}
                  className={cx(
                    'flex min-h-10 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap',
                    'pointer-coarse:min-h-11',
                    current ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-surface-hover',
                    FOCUS_RING,
                  )}
                >
                  {ADMIN_SECTION_LABELS[s]}
                </a>
              </li>
            );
          })}
        </ul>
      }
      main={
        route && Section ? (
          <SectionBoundary resetKey={route.section}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center p-6">
                  <Spinner label={`Loading ${ADMIN_SECTION_LABELS[route.section]}…`} />
                </div>
              }
            >
              <Section route={route} navigate={navigate} />
            </Suspense>
          </SectionBoundary>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <Spinner label="Opening the admin…" />
          </div>
        )
      }
    />
  );
}
