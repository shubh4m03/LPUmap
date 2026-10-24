/**
 * Navigation and walk-tracking HUD. Mounted once by each map layout (overlay)
 * and by the list layout (inline). It renders the live card while navigating
 * or tracking, and the tracking summary dialog when a session ends.
 *
 * Placement (overlay): desktop — compact card bottom-centre of the map area
 * beside the side panel; mobile — top card under the search pill and the
 * safe area, leaving the right-hand map controls uncovered. On mobile the
 * same top slot carries the "choose on map" prompt, which the bottom sheet
 * would otherwise cover.
 */
import { Suspense, useEffect, useRef, type RefObject } from 'react';
import { useIsMobile } from '../../accessibility/index.ts';
import { useAppStore } from '../../app/store/index.ts';
import { cx } from '../ui/index.ts';
import { useBackgroundPause, useNavAnnouncements } from './hooks.ts';
import { MapPickPrompt } from './MapPickPrompt.tsx';
// The live cards and the summary load on demand (they are only needed once a trip starts).
import { LazyNavCard, LazyTrackingCard, LazyTrackingSummaryDialog } from '../layout/deferred-panels.ts';
import { PanelSuspense } from '../layout/PanelSuspense.tsx';

const CARD =
  'pointer-events-auto w-full rounded-xl border border-border bg-surface-raised p-3 text-text shadow-3';

// Right inset: clear of the phone control column, whose view-mode switcher is two 44 px options wide
// (90 px with borders, MapStage COMPACT_CONTROLS_PX) plus an 8 px gap, so a prompt or card never hides a mode.
const MOBILE_TOP =
  'pointer-events-none fixed top-[calc(max(0.75rem,var(--ds-safe-top))+3.75rem)] right-[calc(max(0.75rem,var(--ds-safe-right))+6.125rem)] left-[max(0.75rem,var(--ds-safe-left))] z-(--ds-z-controls)';

export function NavigationHud({ placement = 'overlay' }: { placement?: 'overlay' | 'inline' }) {
  const navigating = useAppStore((s) => s.navigationActive);
  const tracking = useAppStore((s) => s.trackingActive);
  const picking = useAppStore((s) => s.pickingOnMap !== null);
  const summaryOpen = useAppStore((s) => s.trackingSummary !== null);
  const panelOpen = useAppStore((s) => s.activePanel !== 'none' && !s.panelCollapsed);
  const isMobile = useIsMobile();
  const backgroundPaused = useBackgroundPause();
  useNavAnnouncements();
  const mobileTopRef = useRef<HTMLDivElement>(null);
  const covering = placement === 'overlay' && isMobile && (navigating || tracking || picking);
  useHudCoverReport(mobileTopRef, covering);

  const card =
    navigating || tracking ? (
      <section
        aria-label={navigating ? 'Navigation' : 'Walk tracking'}
        className={cx(
          CARD,
          placement === 'overlay' &&
            (isMobile ? 'max-h-[45dvh] overflow-y-auto overscroll-contain' : 'max-w-md'),
        )}
      >
        <PanelSuspense label={navigating ? 'Loading navigation…' : 'Loading walk tracking…'}>
          {navigating ? (
            <LazyNavCard backgroundPaused={backgroundPaused} />
          ) : (
            <LazyTrackingCard backgroundPaused={backgroundPaused} />
          )}
        </PanelSuspense>
      </section>
    ) : null;

  let positioned = card;
  if (placement === 'overlay') {
    if (isMobile) {
      positioned =
        card || picking ? (
          <div ref={mobileTopRef} className={cx(MOBILE_TOP, 'flex flex-col gap-2')}>
            {card}
            {picking ? <MapPickPrompt /> : null}
          </div>
        ) : null;
    } else if (card) {
      positioned = (
        <div
          className={cx(
            // Keep clear of the right-hand controls and, on wide screens, of the toast stack.
            'pointer-events-none fixed right-20 bottom-10 z-(--ds-z-controls) flex justify-center xl:right-[26rem]',
            panelOpen ? 'left-[26rem]' : 'left-4',
          )}
        >
          {card}
        </div>
      );
    }
  }

  return (
    <>
      {positioned}
      {summaryOpen ? (
        <Suspense fallback={null}>
          <LazyTrackingSummaryDialog />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * Reports the height of the mobile top card to the store, so the map padding keeps
 * the user's position (and a focused place) out from under it. Resets to 0 when gone.
 */
function useHudCoverReport(ref: RefObject<HTMLDivElement | null>, active: boolean): void {
  useEffect(() => {
    const set = useAppStore.getState().setHudCoverPx;
    const el = ref.current;
    if (!active || !el) {
      set(0);
      return;
    }
    const measure = () => set(el.getBoundingClientRect().height);
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      set(0);
    };
  }, [ref, active]);
}
