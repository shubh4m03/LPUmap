/**
 * The only admin module in the public entry: a lazy boundary. Everything else
 * under src/admin/ is downloaded only when this renders (on /admin paths).
 */
import { lazy, Suspense } from 'react';
import { Spinner } from '../components/ui/Spinner.tsx';

/** Shown when the admin chunk cannot be downloaded (offline, interrupted deploy): never a blank page. */
function AdminLoadFailed() {
  return (
    <p role="alert" className="p-6 text-text">
      The admin could not be loaded. Check your connection and reload the page.
    </p>
  );
}

const AdminApp = lazy(() =>
  import('./AdminApp.tsx').then(
    (m) => ({ default: m.AdminApp }),
    () => ({ default: AdminLoadFailed }),
  ),
);

export function AdminRoot() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner label="Loading the admin…" />
        </div>
      }
    >
      <AdminApp />
    </Suspense>
  );
}
