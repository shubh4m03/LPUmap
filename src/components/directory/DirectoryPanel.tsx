import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAppStore } from '../../app/store/index.ts';
import type { DirectoryEntry } from '../../directory/index.ts';
import { Badge, EmptyState, SearchInput, SegmentedControl, cx } from '../ui/index.ts';
import {
  categoryOptions,
  directorySummary,
  directoryView,
  facilityText,
  heightBadge,
  type DirectoryGrouping,
} from './directory-view-model.ts';
import { MapKeyGlyph } from './MapKeyGlyph.tsx';
import { useCampusDirectory } from './use-campus-directory.ts';

const GROUPINGS = [
  { value: 'cell', label: 'Grid cell' },
  { value: 'category', label: 'Category' },
] as const;

/**
 * Building directory (docs/ISOMETRIC_AND_3D_DESIGN.md §7.5, §8.5): the
 * accessible list of every campus building drawn in any mode. Search covers
 * names, honest labels and map keys; a row selects the building in whichever
 * view is active (selection lives in the shared store). One tab stop for the
 * list (roving tabindex): arrow keys, Home and End move between rows.
 */
export function DirectoryPanel() {
  const dir = useCampusDirectory();
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  const listMode = useAppStore((s) => s.listMode);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<DirectoryGrouping>('cell');
  const [active, setActive] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const summaryId = useId();
  const categoryFieldId = useId();

  const view = useMemo(
    () => directoryView(dir, { query, categoryId, grouping }),
    [dir, query, categoryId, grouping],
  );
  const categories = useMemo(() => categoryOptions(dir.entries), [dir]);
  const activeIndex = Math.min(active, Math.max(0, view.rows.length - 1));

  const select = (e: DirectoryEntry) => {
    const s = useAppStore.getState();
    if (e.routableReason === 'no-place-record') {
      // Not a place record: frame it without opening details for a record that does not exist.
      s.selectPlace(e.id, { focus: false, openDetails: false });
      if (!listMode) s.requestFocus({ kind: 'point', lngLat: e.location });
      return;
    }
    s.selectPlace(e.id, { focus: !listMode });
  };

  const onRowKeyDown = (ev: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (ev.key === 'ArrowDown') next = Math.min(view.rows.length - 1, index + 1);
    else if (ev.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = view.rows.length - 1;
    if (next === null) return;
    ev.preventDefault();
    setActive(next);
    rowRefs.current[next]?.focus();
  };

  let rowIndex = 0;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-4 pt-3 pb-3">
        <SearchInput
          label="Search buildings or map keys"
          placeholder="Name or map key, e.g. C4-07"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onClear={() => setQuery('')}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={categoryFieldId} className="text-sm font-medium text-text">
              Category
            </label>
            <select
              id={categoryFieldId}
              value={categoryId ?? ''}
              onChange={(e) => {
                setCategoryId(e.target.value === '' ? null : e.target.value);
                setActive(0);
              }}
              className="h-11 w-full min-w-0 rounded-md border border-border-strong bg-surface-sunken px-3 text-base text-text focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--ds-focus-ring)"
            >
              <option value="">All categories ({dir.entries.length})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.count})
                </option>
              ))}
            </select>
          </div>
          {view.searching ? null : (
            <SegmentedControl
              label="Group by"
              options={GROUPINGS}
              value={grouping}
              onChange={(g) => {
                setGrouping(g);
                setActive(0);
              }}
            />
          )}
        </div>
        <p id={summaryId} className="text-sm text-muted">
          {directorySummary(view)}. Map keys are this app&apos;s own references. They are not official LPU
          block numbers.
        </p>
        <p role="status" className="sr-only">
          {view.searching
            ? `${view.rows.length} ${view.rows.length === 1 ? 'building matches' : 'buildings match'}`
            : `${view.rows.length} buildings listed`}
        </p>
      </div>
      {view.rows.length === 0 ? (
        <EmptyState
          icon="building"
          title="No buildings match"
          description="Try a different name, a map key such as C4-07, or another category. Only mapped campus buildings are listed."
        />
      ) : (
        view.groups.map((g) => (
          <section key={g.id} aria-labelledby={`${summaryId}-${g.id}`} className="py-1">
            <h3
              id={`${summaryId}-${g.id}`}
              className="sticky top-0 z-1 bg-surface px-4 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase"
            >
              {g.label} <span className="font-normal">({g.entries.length})</span>
            </h3>
            <ul>
              {g.entries.map((e) => {
                const i = rowIndex++;
                return (
                  <li key={e.id}>
                    <DirectoryRow
                      entry={e}
                      selected={e.id === selectedPlaceId}
                      tabIndex={i === activeIndex ? 0 : -1}
                      ref={(el) => {
                        rowRefs.current[i] = el;
                      }}
                      onFocus={() => setActive(i)}
                      onKeyDown={(ev) => onRowKeyDown(ev, i)}
                      onSelect={() => select(e)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

interface DirectoryRowProps {
  entry: DirectoryEntry;
  selected: boolean;
  tabIndex: number;
  ref: (el: HTMLButtonElement | null) => void;
  onFocus(): void;
  onKeyDown(ev: KeyboardEvent<HTMLButtonElement>): void;
  onSelect(): void;
}

function DirectoryRow({
  entry: e,
  selected,
  tabIndex,
  ref,
  onFocus,
  onKeyDown,
  onSelect,
}: DirectoryRowProps) {
  const h = heightBadge(e);
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      aria-current={selected ? 'true' : undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={onSelect}
      className={cx(
        'flex min-h-12 w-full cursor-pointer items-start gap-3 px-4 py-2 text-left',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ds-focus-ring)',
        selected ? 'bg-surface-hover shadow-[inset_3px_0_0_var(--ds-accent)]' : 'hover:bg-surface-hover',
      )}
    >
      <MapKeyGlyph mapKey={e.key} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-text">{e.title}</span>
        <span className="truncate text-sm text-muted">{e.subtitle}</span>
        <span className="flex flex-wrap gap-1 pt-0.5">
          <Badge tone={h.tone}>{h.text}</Badge>
          <Badge>{facilityText(e)}</Badge>
          {e.routable ? (
            <Badge tone="success" icon="walk">
              Directions available
            </Badge>
          ) : (
            <Badge tone="warning">{e.routableNote}</Badge>
          )}
        </span>
      </span>
    </button>
  );
}
