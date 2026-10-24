/**
 * The admin path test, in its own module because src/main.tsx imports it into
 * the public entry: it must not pull any other admin code (or text) with it.
 */
export const ADMIN_BASE_PATH = '/admin';

/** True for /admin and anything below it (not /administrator). */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_BASE_PATH || pathname.startsWith(`${ADMIN_BASE_PATH}/`);
}
