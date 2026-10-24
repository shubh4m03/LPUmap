/**
 * History-API routing inside /admin (no router dependency). `navigate`
 * pushes (or replaces) a URL and notifies subscribers; Back/Forward work via
 * `popstate`. Sections receive the parsed route and the navigate function.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { adminHref, parseAdminRoute, type AdminRoute, type AdminSection } from './routes.ts';

const NAV_EVENT = 'atlas-admin-navigate';

export type AdminRouteTarget = {
  section: AdminSection;
  id?: string | null;
  query?: Readonly<Record<string, string>>;
};
export type AdminNavigate = (to: AdminRouteTarget | string, opts?: { replace?: boolean }) => void;

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAV_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAV_EVENT, listener);
  };
}

const locationKey = () => `${window.location.pathname}${window.location.search}`;

/** Pushes or replaces the URL (same-origin /admin paths only) and notifies the router. */
export function navigateAdmin(to: AdminRouteTarget | string, opts: { replace?: boolean } = {}): void {
  const href = typeof to === 'string' ? to : adminHref(to);
  if (!href.startsWith('/admin')) throw new Error(`Not an admin path: ${href}`);
  if (href === locationKey()) return;
  try {
    if (opts.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
  } catch {
    window.location.assign(href);
    return;
  }
  window.dispatchEvent(new Event(NAV_EVENT));
}

export interface AdminRouterState {
  /** null → unknown /admin path (the app replaces it with the default section). */
  route: AdminRoute | null;
  navigate: AdminNavigate;
}

export function useAdminRouter(): AdminRouterState {
  const key = useSyncExternalStore(subscribe, locationKey, locationKey);
  const route = useMemo(() => {
    const q = key.indexOf('?');
    return parseAdminRoute(q < 0 ? key : key.slice(0, q), q < 0 ? '' : key.slice(q));
  }, [key]);
  const navigate = useCallback<AdminNavigate>((to, opts) => navigateAdmin(to, opts), []);
  return { route, navigate };
}
