import { useRef } from 'react';
import { useIsMobile } from '../../accessibility/index.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { CATEGORIES } from '../../config/categories.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { NavigationHud } from '../navigation/NavigationHud.tsx';
import { SearchTrigger } from '../search/SearchTrigger.tsx';
import { IconButton, ResultRow, iconForCategory } from '../ui/index.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { PanelBackButton, PanelBody } from './PanelContent.tsx';
import { usePanelLabel, usePanelTitle } from './panel-titles.ts';
import { usePanelFocusRescue } from './usePanelFocusRescue.ts';

/** Map-free mode (no WebGL or a fatal map error): search, details and categories as lists. */
export function ListLayout() {
  const reason = useAppStore((s) => s.listModeReason);
  const activePanel = useAppStore((s) => s.activePanel);
  const closePanel = useAppStore((s) => s.closePanel);
  const title = usePanelTitle(activePanel);
  const label = usePanelLabel(activePanel);
  const isMobile = useIsMobile();
  const mainRef = useRef<HTMLElement>(null);
  usePanelFocusRescue(mainRef);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-3 pt-safe pr-safe pb-safe pl-safe">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{APP_CONFIG.brand.name}</h1>
        <div className="flex items-center gap-2">
          <SearchTrigger compact={isMobile} className="flex-1" />
          <MoreMenu />
        </div>
        <p role="status" className="rounded-md bg-warning-soft p-3 text-sm text-text">
          {reason ?? 'The map is unavailable.'} You are using the list view.
        </p>
        <NavigationHud placement="inline" />
      </header>
      <main ref={mainRef} id="main" className="rounded-xl border border-border bg-surface-raised">
        {activePanel === 'none' ? (
          <CategoryHome />
        ) : (
          <section aria-label={label}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <PanelBackButton />
              <h2 id="list-panel-title" className="min-w-0 flex-1 truncate text-base font-semibold">
                {title}
              </h2>
              <IconButton icon="close" label="Close" size="sm" onClick={closePanel} />
            </div>
            <PanelBody panel={activePanel} />
          </section>
        )}
      </main>
    </div>
  );
}

function CategoryHome() {
  const { categoryCounts } = useAtlas();
  const openCategory = useAppStore((s) => s.openCategory);
  return (
    <section aria-labelledby="list-home-title" className="py-2">
      <h2 id="list-home-title" className="px-4 py-2 text-base font-semibold">
        Browse by category
      </h2>
      <ul>
        {CATEGORIES.map((c) => {
          const n = categoryCounts[c.id] ?? 0;
          return (
            <li key={c.id}>
              <ResultRow
                title={c.label}
                subtitle={n === 0 ? 'None mapped yet' : `${n} in the dataset`}
                icon={iconForCategory(c.icon)}
                iconColor={c.color}
                onSelect={() => openCategory(c.id)}
                className="px-4"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
