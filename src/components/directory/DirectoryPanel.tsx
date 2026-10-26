import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { selectDirectoryItem } from '../../app/artwork-selection.ts';
import { useAppStore } from '../../app/store/index.ts';
import type { ArtworkThumbnail, DirectoryEntry, DirectoryItem } from '../../directory/index.ts';
import type { ArtworkOnlyEntry } from '../../isometric-art/directory.ts';
import { getRequestedIsometricVariant } from '../../isometric-art/variant-state.ts';
import { Badge, EmptyState, SearchInput, SegmentedControl, cx } from '../ui/index.ts';
import {
  ARTWORK_STATUS,
  artworkSectionOptions,
  artworkStatusOf,
  categoryOptions,
  directorySummary,
  directoryView,
  facilityText,
  heightBadge,
  type DirectoryGroup,
  type DirectoryGrouping,
} from './directory-view-model.ts';
import { ArtworkNumberGlyph, MapKeyGlyph } from './MapKeyGlyph.tsx';
import { useCampusDirectory } from './use-campus-directory.ts';

const MAP_GROUPINGS = [
  { value: 'cell', label: 'Grid cell' },
  { value: 'category', label: 'Category' },
] as const;
const ALL_GROUPINGS = [...MAP_GROUPINGS, { value: 'artwork', label: 'Illustration' }] as const;

/**
 * Building directory (docs/ISOMETRIC_AND_3D_DESIGN.md §7.5, §8.5;
 * docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5): the accessible list of every
 * campus building drawn in any mode and of every item of the campus
 * illustration. Search covers names, honest labels, map keys, exact
 * illustration labels and artwork numbers; a row selects the building (or the
 * illustration item) in whichever view is active (selection lives in the
 * shared store). One tab stop for the list (roving tabindex): arrow keys, Home
 * and End move between rows.
 */
export function DirectoryPanel() {
  const dir = useCampusDirectory();
  const selectedPlaceId = useAppStore((s) => s.selectedPlaceId);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // The illustrated overview lists its own blocks first; every other view starts with grid cells.
  const [grouping, setGrouping] = useState<DirectoryGrouping>(() => {
    const s = useAppStore.getState();
    return dir.artwork &&
      s.viewMode === 'isometric' &&
      (getRequestedIsometricVariant() ?? 'illustrated') === 'illustrated'
      ? 'artwork'
      : 'cell';
  });
  const [active, setActive] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const summaryId = useId();
  const categoryFieldId = useId();

  const view = useMemo(
    () => directoryView(dir, { query, categoryId, grouping }),
    [dir, query, categoryId, grouping],
  );
  const artworkGrouping = grouping === 'artwork';
  const categories = useMemo(
    () => (artworkGrouping ? artworkSectionOptions(dir) : categoryOptions(dir.entries)),
    [dir, artworkGrouping],
  );
  const activeIndex = Math.min(active, Math.max(0, view.items.length - 1));

  const onRowKeyDown = (ev: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (ev.key === 'ArrowDown') next = Math.min(view.items.length - 1, index + 1);
    else if (ev.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = view.items.length - 1;
    if (next === null) return;
    ev.preventDefault();
    setActive(next);
    rowRefs.current[next]?.focus();
  };

  const allCount = artworkGrouping ? view.items.length : dir.entries.length;
  let rowIndex = 0;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-4 pt-3 pb-3">
        <SearchInput
          label="Search buildings or map keys"
          placeholder={
            dir.artwork ? 'Name, map key or block label, e.g. C4-07' : 'Name or map key, e.g. C4-07'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onClear={() => setQuery('')}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <label htmlFor={categoryFieldId} className="text-sm font-medium text-text">
              {artworkGrouping ? 'Section on the illustration' : 'Category'}
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
              <option value="">
                {artworkGrouping ? 'All sections' : 'All categories'}
                {query.trim() === '' || !artworkGrouping ? ` (${allCount})` : ''}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.count})
                </option>
              ))}
            </select>
          </div>
          {view.searching && !artworkGrouping ? null : (
            <SegmentedControl
              label="Group by"
              options={dir.artwork ? ALL_GROUPINGS : MAP_GROUPINGS}
              value={grouping}
              onChange={(g) => {
                setGrouping(g);
                // App categories and the illustration's printed sections are different lists.
                setCategoryId(null);
                setActive(0);
              }}
            />
          )}
        </div>
        <p id={summaryId} className="text-sm text-muted">
          {directorySummary(view)}.{' '}
          {artworkGrouping
            ? 'Grouped as the illustration prints its blocks. Its numbers are the illustration’s own; they are not official LPU block numbers.'
            : 'Map keys are this app’s own references. They are not official LPU block numbers.'}
        </p>
        <p role="status" className="sr-only">
          {statusText(view.items, view.searching)}
        </p>
      </div>
      {view.items.length === 0 ? (
        <EmptyState
          icon="building"
          title={artworkGrouping ? 'Nothing on the illustration matches' : 'No buildings match'}
          description={
            artworkGrouping
              ? 'Try a printed label, a block number such as 25, or another section.'
              : 'Try a different name, a map key such as C4-07, or another category. Only mapped campus buildings are listed.'
          }
        />
      ) : (
        view.groups.map((g) => (
          <section key={g.id} aria-labelledby={`${summaryId}-${g.id}`} className="py-1">
            <GroupHeading id={`${summaryId}-${g.id}`} group={g} />
            <ul>
              {g.items.map((item) => {
                const i = rowIndex++;
                const common = {
                  selected: item.id === selectedPlaceId,
                  tabIndex: i === activeIndex ? 0 : -1,
                  ref: (el: HTMLButtonElement | null) => {
                    rowRefs.current[i] = el;
                  },
                  onFocus: () => setActive(i),
                  onKeyDown: (ev: KeyboardEvent<HTMLButtonElement>) => onRowKeyDown(ev, i),
                  onSelect: () => selectDirectoryItem(item),
                };
                return (
                  <li key={`${g.id}:${item.id}`}>
                    {item.kind === 'building' ? (
                      <DirectoryRow entry={item.entry} showArtwork={artworkGrouping} {...common} />
                    ) : (
                      <ArtworkRow
                        entry={item.entry}
                        groupHeading={g.printedCaption ? g.label : null}
                        {...common}
                      />
                    )}
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

/** "3 buildings match" / "2 buildings and 1 illustration item listed". */
function statusText(items: readonly DirectoryItem[], searching: boolean): string {
  const b = items.filter((i) => i.kind === 'building').length;
  const a = items.length - b;
  const buildings = `${b} ${b === 1 ? 'building' : 'buildings'}`;
  const art = a > 0 ? ` and ${a} illustration ${a === 1 ? 'item' : 'items'}` : '';
  if (!searching) return `${buildings}${art} listed`;
  return `${buildings}${art} ${b === 1 && a === 0 ? 'matches' : 'match'}`;
}

function GroupHeading({ id, group: g }: { id: string; group: DirectoryGroup }) {
  return (
    <div className="sticky top-0 z-1 flex items-center gap-3 bg-surface px-4 py-1.5">
      {g.thumbnail ? <Thumbnail thumbnail={g.thumbnail} caption={g.label} /> : null}
      <h3 id={id} className="min-w-0 text-xs font-semibold tracking-wide text-muted">
        {g.printedCaption ? (
          <>
            <span className="sr-only">Caption printed on the illustration: </span>
            <span className="whitespace-pre-wrap text-text">{g.label}</span>
          </>
        ) : (
          <span className="uppercase">{g.label}</span>
        )}{' '}
        <span className="font-normal">({g.items.length})</span>
      </h3>
    </div>
  );
}

/** The whole vignette, scaled to fit (never cropped or stretched). */
function Thumbnail({ thumbnail: t, caption }: { thumbnail: ArtworkThumbnail; caption: string }) {
  return (
    <img
      src={t.src}
      width={t.width}
      height={t.height}
      loading="lazy"
      decoding="async"
      alt={`Illustration vignette printed with the caption ${caption}`}
      className="h-10 w-auto shrink-0 rounded-sm border border-border bg-surface-sunken object-contain"
      style={{ aspectRatio: `${t.width} / ${t.height}` }}
    />
  );
}

interface RowProps {
  selected: boolean;
  tabIndex: number;
  ref: (el: HTMLButtonElement | null) => void;
  onFocus(): void;
  onKeyDown(ev: KeyboardEvent<HTMLButtonElement>): void;
  onSelect(): void;
}

const ROW_CLASS =
  'flex min-h-12 w-full cursor-pointer items-start gap-3 px-4 py-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ds-focus-ring)';
const rowState = (selected: boolean) =>
  selected ? 'bg-surface-hover shadow-[inset_3px_0_0_var(--ds-accent)]' : 'hover:bg-surface-hover';

function DirectoryRow({
  entry: e,
  showArtwork,
  selected,
  tabIndex,
  ref,
  onFocus,
  onKeyDown,
  onSelect,
}: RowProps & { entry: DirectoryEntry; showArtwork: boolean }) {
  const h = heightBadge(e);
  const printed = showArtwork ? e.artwork.flatMap((l) => l.labels.filter((x) => x.role === 'display')) : [];
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      aria-current={selected ? 'true' : undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={onSelect}
      className={cx(ROW_CLASS, rowState(selected))}
    >
      <MapKeyGlyph mapKey={e.key} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-text">{e.title}</span>
        <span className="truncate text-sm text-muted">{e.subtitle}</span>
        {printed.length > 0 ? (
          <span className="overflow-hidden text-sm text-ellipsis whitespace-nowrap text-muted">
            On the illustration:{' '}
            <span className="whitespace-pre text-text">{printed.map((l) => l.text).join(' · ')}</span>
          </span>
        ) : null}
        <span className="flex flex-wrap gap-1 pt-0.5">
          {e.artwork.length > 0 ? (
            <Badge tone={ARTWORK_STATUS.verified.tone}>{ARTWORK_STATUS.verified.label}</Badge>
          ) : null}
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

function ArtworkRow({
  entry: e,
  selected,
  tabIndex,
  ref,
  onFocus,
  onKeyDown,
  onSelect,
  groupHeading,
}: RowProps & { entry: ArtworkOnlyEntry; groupHeading: string | null }) {
  const status = ARTWORK_STATUS[artworkStatusOf(e)];
  // The block heading is already the group heading inside its caption group.
  const block = e.labels.find(
    (l) => l.role === 'visible-block' && l.text !== e.title && l.text !== groupHeading,
  );
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      aria-current={selected ? 'true' : undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={onSelect}
      className={cx(ROW_CLASS, rowState(selected))}
    >
      <ArtworkNumberGlyph artworkNumber={e.artworkNumber} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* Printed text is shown exactly: double spaces are kept even when the line is cut short. */}
        <span className="overflow-hidden text-sm font-medium text-ellipsis whitespace-pre text-text">
          {e.title}
        </span>
        <span className="truncate text-sm text-muted">
          {block ? <span className="whitespace-pre">{block.text} · </span> : null}
          Campus illustration
        </span>
        <span className="flex flex-wrap gap-1 pt-0.5">
          <span title={status.description} className="inline-flex">
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
          <Badge tone="warning">Not routable</Badge>
        </span>
      </span>
    </button>
  );
}
