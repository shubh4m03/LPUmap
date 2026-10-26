import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useAnnounce } from '../../accessibility/index.ts';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { useAppStore } from '../../app/store/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { useFavorites, useRecents } from '../../favorites/index.ts';
import { Button, Dialog, Kbd, SearchInput } from '../ui/index.ts';
import { PaletteEmpty, PaletteIdleHint } from './PaletteEmpty.tsx';
import { PaletteList } from './PaletteList.tsx';
import { buildIdleSections, buildResultSections, flattenSections } from './palette-model.ts';
import { usePaletteActions } from './usePaletteActions.ts';

const RESULT_LIMIT = 30;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Ctrl/⌘+K command palette: places, categories, layers and commands in one combobox. */
export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const closePalette = useAppStore((s) => s.closePalette);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open={open}
      onClose={closePalette}
      title="Search the campus atlas"
      size="md"
      initialFocus={inputRef}
      className="h-[88dvh] sm:h-auto sm:max-h-[min(640px,80dvh)]"
    >
      <PaletteBody inputRef={inputRef} />
    </Dialog>
  );
}

function PaletteBody({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const { searchIndex, getPlace } = useAtlas();
  const initialQuery = useAppStore((s) => s.paletteInitialQuery);
  const listMode = useAppStore((s) => s.listMode);
  const recentIds = useRecents((s) => s.ids);
  const favoriteIds = useFavorites((s) => s.ids);
  const { activate, routeTo } = usePaletteActions();
  const announce = useAnnounce();
  const listboxId = useId();
  const hintId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [activeState, setActiveState] = useState<{ items: unknown; index: number }>({
    items: null,
    index: 0,
  });
  const debounced = useDebounced(query.trim(), APP_CONFIG.search.debounceMs);
  const searching = debounced.length > 0;

  const sectionsFor = useCallback(
    (q: string) => {
      if (!q) return buildIdleSections(recentIds, favoriteIds, getPlace);
      const hits = searchIndex.search(q, { limit: RESULT_LIMIT });
      return buildResultSections(hits, { listMode, getPlace });
    },
    [searchIndex, listMode, getPlace, recentIds, favoriteIds],
  );
  const sections = useMemo(() => sectionsFor(debounced), [sectionsFor, debounced]);
  const items = useMemo(() => flattenSections(sections), [sections]);
  // The active option resets to the first one whenever the result list changes.
  const active = activeState.items === items ? activeState.index : 0;
  const setActive = (index: number) => setActiveState({ items, index });
  const current = Math.min(active, Math.max(items.length - 1, 0));
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  useEffect(() => {
    if (!searching) return;
    announce(items.length === 0 ? 'No results' : `${items.length} result${items.length === 1 ? '' : 's'}`);
  }, [items, searching, announce]);

  useEffect(() => {
    document.getElementById(optionId(current))?.scrollIntoView?.({ block: 'nearest' });
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter/Tab typed before the debounce settled must act on what is typed now,
    // not on the previous (possibly idle "Recent") list.
    const pending = query.trim() !== debounced && (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey));
    const list = pending ? flattenSections(sectionsFor(query.trim())) : items;
    const n = list.length;
    if (n === 0) return;
    const item = list[pending ? 0 : current];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    } else if (e.key === 'Enter' && item) {
      e.preventDefault();
      activate(item);
    } else if (e.key === 'Tab' && !e.shiftKey && (item?.kind === 'place' || item?.kind === 'artwork')) {
      e.preventDefault();
      const reason = routeTo(item);
      if (reason) announce(`Cannot plan a route: ${reason}`, 'assertive');
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <SearchInput
        ref={inputRef}
        aria-label="Search places, categories and commands"
        placeholder="Search places, categories, commands"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery('')}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={items.length > 0 ? optionId(current) : undefined}
        aria-describedby={hintId}
        maxLength={100}
      />
      <p id={hintId} className="hidden items-center gap-1.5 text-xs text-subtle sm:flex">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>Tab</Kbd> route to a place · <Kbd>Esc</Kbd> clear,
        then close
      </p>
      <PaletteList
        id={listboxId}
        sections={sections}
        activeIndex={current}
        optionId={optionId}
        onHover={setActive}
        onSelect={activate}
        label={searching ? `Results for ${debounced}` : 'Recent and saved places'}
      />
      {searching && sections.some((s) => s.id === 'places') ? (
        <Button
          size="sm"
          variant="ghost"
          icon="chevron-right"
          iconPosition="end"
          className="self-start"
          onClick={() => {
            useAppStore.getState().showResults(debounced);
            useAppStore.getState().closePalette();
          }}
        >
          Keep place results open in a panel
        </Button>
      ) : null}
      {searching && items.length === 0 ? <PaletteEmpty query={debounced} /> : null}
      {!searching && items.length === 0 ? <PaletteIdleHint /> : null}
    </div>
  );
}
