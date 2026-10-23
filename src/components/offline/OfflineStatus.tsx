/**
 * Connection and app-update status, mounted once at the app root (outside the
 * data provider, inside ToastProvider). Uses useOnlineStatus() and
 * useServiceWorkerUpdate() from src/offline; needs no app-store state.
 *
 * - Offline: a persistent banner says what still works.
 * - Back online: a short toast.
 * - New version waiting: a banner with "Update now" / "Later" (never reloads by itself).
 * - Offline copy ready: one toast. Registration failure: one warning toast.
 */
import type { JSX } from 'react';
import { useOnlineStatus, useServiceWorkerUpdate } from '../../offline/index.ts';
import { Button, Icon } from '../ui/index.ts';
import { OFFLINE_MESSAGE } from './messages.ts';
import { useStatusToasts } from './useStatusToasts.ts';

export function OfflineStatus(): JSX.Element | null {
  const online = useOnlineStatus();
  const sw = useServiceWorkerUpdate();
  useStatusToasts(online, sw);

  if (online && !sw.updateAvailable) return null;
  return (
    <div
      className={
        // Panel layer, below the mobile sheet: a full-height (modal) sheet covers the
        // banner instead of the banner covering the sheet's title and close button.
        'pointer-events-none fixed z-(--ds-z-panels) flex flex-col gap-2 ' +
        // Phones: below the search bar, clear of the map control column on the right.
        'top-[calc(max(0.75rem,var(--ds-safe-top))+3.75rem)] right-16 left-[max(0.75rem,var(--ds-safe-left))] ' +
        // Larger screens: right of the side panel (w-96 at left-4) and raised above the
        // bottom-right toast stack and map attribution, so neither covers it.
        'md:top-auto md:right-4 md:bottom-24 md:left-[26rem] md:max-w-lg'
      }
    >
      {!online ? (
        <div
          role="status"
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text shadow-2"
        >
          <Icon name="wifi-off" size={18} className="mt-0.5 shrink-0 text-warning" />
          <span>{OFFLINE_MESSAGE}</span>
        </div>
      ) : null}
      {sw.updateAvailable ? (
        <div
          role="status"
          className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text shadow-2"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Icon name="download" size={18} className="shrink-0 text-accent-text" />A new version of the app
            and campus data is ready.
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="primary" onClick={sw.applyUpdate}>
              Update now
            </Button>
            <Button size="sm" variant="ghost" onClick={sw.dismiss}>
              Later
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}
