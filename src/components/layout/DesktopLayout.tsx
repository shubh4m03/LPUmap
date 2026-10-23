import { useRef, type ReactNode } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import { MapControls } from '../map-controls/MapControls.tsx';
import { NavigationHud } from '../navigation/NavigationHud.tsx';
import { SearchTrigger } from '../search/SearchTrigger.tsx';
import { Button, IconButton, SidePanel } from '../ui/index.ts';
import { PanelBackButton, PanelBody } from './PanelContent.tsx';
import { usePanelTitle } from './panel-titles.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { PickingBanner } from './PickingBanner.tsx';
import { usePanelFocusRescue } from './usePanelFocusRescue.ts';

/** ≥ 768px: full-bleed map, floating search, left side panel, right control stack. */
export function DesktopLayout({ map }: { map: ReactNode }) {
  const activePanel = useAppStore((s) => s.activePanel);
  const collapsed = useAppStore((s) => s.panelCollapsed);
  const setCollapsed = useAppStore((s) => s.setPanelCollapsed);
  const closePanel = useAppStore((s) => s.closePanel);
  const title = usePanelTitle(activePanel);
  const panelRef = useRef<HTMLDivElement>(null);
  usePanelFocusRescue(panelRef);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <main id="main" aria-label="Campus map" className="absolute inset-0">
        {map}
      </main>
      <div className="pointer-events-none absolute top-4 left-4 z-(--ds-z-panels) flex flex-col gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <SearchTrigger className="w-96" />
          <MoreMenu />
        </div>
        {activePanel !== 'none' && collapsed ? (
          <Button
            variant="secondary"
            icon="chevron-right"
            iconPosition="end"
            className="pointer-events-auto self-start shadow-2"
            onClick={() => setCollapsed(false)}
          >
            Show panel: {title}
          </Button>
        ) : null}
      </div>
      {activePanel !== 'none' && !collapsed ? (
        <div
          ref={panelRef}
          className="absolute top-20 bottom-8 left-4 z-(--ds-z-panels) flex w-96 overflow-hidden rounded-xl shadow-3"
        >
          <SidePanel
            title={title}
            onClose={closePanel}
            className="max-w-none rounded-xl border border-border"
            headerActions={
              <>
                <PanelBackButton />
                <IconButton
                  icon="minus"
                  label="Minimise panel to see more of the map"
                  size="sm"
                  onClick={() => setCollapsed(true)}
                />
              </>
            }
          >
            <PanelBody panel={activePanel} />
          </SidePanel>
        </div>
      ) : null}
      <div className="pointer-events-none absolute top-4 right-4 z-(--ds-z-controls)">
        <MapControls className="pointer-events-auto" />
      </div>
      <div className="pointer-events-none absolute top-4 right-20 left-[30rem] z-(--ds-z-controls) flex max-w-md flex-col gap-2">
        <NavigationHud />
        <PickingBanner />
      </div>
    </div>
  );
}
