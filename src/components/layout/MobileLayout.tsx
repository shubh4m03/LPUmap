import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { DirectoryPeek } from '../directory/DirectoryPeek.tsx';
import { MapControls } from '../map-controls/MapControls.tsx';
import { NavigationHud } from '../navigation/NavigationHud.tsx';
import { SearchTrigger } from '../search/SearchTrigger.tsx';
import { BottomSheet } from '../ui/index.ts';
import { useSheetCoverPx, useViewportHeight } from './map-padding.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { PanelBackButton, PanelBody } from './PanelContent.tsx';
import { usePanelLabel, usePanelTitle } from './panel-titles.ts';
import { QuickActions } from './QuickActions.tsx';
import { useAttributionTop, useMobileToastOffset } from './toast-offset.ts';
import { usePanelFocusRescue } from './usePanelFocusRescue.ts';

/** < 768px: map with a top search pill, compact controls, quick actions bar and a bottom sheet. */
export function MobileLayout({ map }: { map: ReactNode }) {
  const activePanel = useAppStore((s) => s.activePanel);
  const snap = useAppStore((s) => s.sheetSnap);
  const setSnap = useAppStore((s) => s.setSheetSnap);
  const closePanel = useAppStore((s) => s.closePanel);
  const title = usePanelTitle(activePanel);
  const label = usePanelLabel(activePanel);
  const sheetRef = useRef<HTMLDivElement>(null);
  usePanelFocusRescue(sheetRef);
  // Lift the map attribution above the sheet so it is never covered. `!` is required:
  // Tailwind utilities live in a cascade layer, and MapLibre's unlayered stylesheet
  // (`.maplibregl-ctrl-bottom-right { bottom: 0 }`) would otherwise always win.
  const viewportH = useViewportHeight();
  const coverPx = useSheetCoverPx(viewportH);
  // Toasts sit above the attribution's measured top edge (an imagery credit can wrap over lines).
  const mainRef = useRef<HTMLElement>(null);
  const attributionTop = useAttributionTop(mainRef, `${coverPx}:${viewportH}`);
  useMobileToastOffset(viewportH, attributionTop);
  const mainStyle = { '--atlas-attrib-offset': `${coverPx}px` } as CSSProperties;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <main
        ref={mainRef}
        id="main"
        aria-label="Campus map"
        style={mainStyle}
        className="relative min-h-0 flex-1 [&_.maplibregl-ctrl-bottom-right]:bottom-(--atlas-attrib-offset)!"
      >
        {map}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-(--ds-z-controls) flex items-start gap-2 pt-safe pr-safe pl-safe">
          <div className="pointer-events-auto min-w-0 flex-1">
            <SearchTrigger compact />
          </div>
          <MoreMenu className="pointer-events-auto" />
        </div>
        <div className="pointer-events-none absolute top-[calc(max(0.75rem,var(--ds-safe-top))+3.75rem)] right-[max(0.75rem,var(--ds-safe-right))] z-(--ds-z-controls)">
          <MapControls compact className="pointer-events-auto" />
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-8 z-(--ds-z-controls) flex flex-col gap-2">
          <NavigationHud />
        </div>
      </main>
      <QuickActions className="shrink-0 border-t border-border bg-surface-raised pb-[var(--ds-safe-bottom)]" />
      <div ref={sheetRef}>
        <BottomSheet
          open={activePanel !== 'none'}
          onClose={closePanel}
          title={title}
          label={label}
          snap={snap}
          onSnapChange={setSnap}
          headerActions={<PanelBackButton />}
          // §8.4: the directory's peek shows the selected building or "N campus buildings · Browse".
          peek={activePanel === 'directory' ? <DirectoryPeek onBrowse={() => setSnap('half')} /> : undefined}
        >
          <div className="-mx-4">
            <PanelBody panel={activePanel} />
          </div>
        </BottomSheet>
      </div>
    </div>
  );
}
