import { useSyncExternalStore } from 'react';
import { getAnnouncerState, subscribeAnnouncer } from './announcer.ts';

/**
 * Visually hidden polite + assertive live regions. Mount exactly once (app root) so
 * the regions exist before the first message; announce via `useAnnounce()`.
 */
export function LiveRegion() {
  const state = useSyncExternalStore(subscribeAnnouncer, getAnnouncerState, getAnnouncerState);
  return (
    <div className="sr-only">
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="live-region-polite">
        {state.polite ? <span key={state.polite.id}>{state.polite.text}</span> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-region-assertive">
        {state.assertive ? <span key={state.assertive.id}>{state.assertive.text}</span> : null}
      </div>
    </div>
  );
}
