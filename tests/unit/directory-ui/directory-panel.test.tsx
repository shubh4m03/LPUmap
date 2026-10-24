/**
 * Building directory panel (docs/ISOMETRIC_AND_3D_DESIGN.md §7.5, §8.5) on the
 * committed dataset: honest titles, map-key search, category filter, grouping,
 * roving tabindex, routability notes and selection through the shared store.
 * The axe scan runs in the browser harness (tests/perf/iso-harness.spec.ts).
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServices, type AtlasServices } from '../../../src/app/data/services.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import {
  categoryOptions,
  campusDirectoryFor,
  directoryView,
  DirectoryPanel,
  DirectoryPeek,
  heightBadge,
  UNKEYED_GROUP_LABEL,
} from '../../../src/components/directory/index.ts';
import type { CampusData } from '../../../src/data/index.ts';
import { renderWithAtlas, resetAppStore } from '../app/render-helpers.tsx';

const read = <T,>(f: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/data', f), 'utf8')) as T;
let services: AtlasServices;
let data: CampusData;

beforeAll(() => {
  data = {
    manifest: read('manifest.json'),
    boundary: read('boundary.geojson'),
    buildings: read('buildings.geojson'),
    basemap: read('basemap.geojson'),
    places: read<{ places: CampusData['places'] }>('places.json').places,
    relations: read<{ relations: CampusData['relations'] }>('relations.json').relations,
    graph: read('graph.json'),
  };
  services = buildServices(data);
});
afterEach(() => {
  cleanup();
  resetAppStore();
});

describe('directory view model', () => {
  it('lists every campus-inventory building once, grouped by grid cell with unkeyed last', () => {
    const dir = campusDirectoryFor(data);
    const v = directoryView(dir, { query: '', categoryId: null, grouping: 'cell' });
    const inventory = data.buildings.features.filter((f) => f.properties.inCampusInventory).length;
    expect(v.rows).toHaveLength(inventory);
    expect(v.total).toBe(inventory);
    expect(new Set(v.rows.map((e) => e.id)).size).toBe(inventory);
    for (const g of v.groups.filter((g) => g.label !== UNKEYED_GROUP_LABEL))
      for (const e of g.entries) expect(g.label).toBe(`Grid cell ${e.cell}`);
    if (v.groups.some((g) => g.label === UNKEYED_GROUP_LABEL))
      expect(v.groups.at(-1)!.label).toBe(UNKEYED_GROUP_LABEL);
  });

  it('finds a building by its exact map key first', () => {
    const dir = campusDirectoryFor(data);
    const keyed = dir.entries.find((e) => e.key)!;
    const v = directoryView(dir, { query: keyed.key!.toLowerCase(), categoryId: null, grouping: 'cell' });
    expect(v.searching).toBe(true);
    expect(v.rows[0]!.id).toBe(keyed.id);
  });

  it('filters by category and offers only categories present, with counts', () => {
    const dir = campusDirectoryFor(data);
    const opts = categoryOptions(dir.entries);
    expect(opts.reduce((n, o) => n + o.count, 0)).toBe(dir.entries.length);
    const first = opts[0]!;
    const v = directoryView(dir, { query: '', categoryId: first.id, grouping: 'category' });
    expect(v.rows).toHaveLength(first.count);
    expect(v.groups).toHaveLength(1);
  });

  it('words heights honestly (estimates are marked, placeholders say "No height data")', () => {
    const dir = campusDirectoryFor(data);
    for (const e of dir.entries) {
      const b = heightBadge(e);
      if (e.renderHeightSource === 'fallback') expect(b.text).toBe('No height data');
      if (e.renderHeightSource === 'osm-levels-estimate') expect(b.text).toMatch(/est\.|estimated/);
    }
  });
});

describe('DirectoryPanel', () => {
  it('shows the honesty note and honest titles: name, else "Building <key>", else the source label', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    expect(screen.getByText(/They are not official LPU block numbers/)).toBeInTheDocument();
    const rows = screen.getAllByRole('button').filter((b) => b.closest('li'));
    const entries = campusDirectoryFor(data).entries;
    expect(rows.length).toBe(entries.length);
    const titles = new Set(rows.map((r) => r.querySelector('.font-medium')!.textContent));
    for (const e of entries) {
      const expected = e.name ?? (e.key ? `Building ${e.key}` : e.displayName);
      expect(titles.has(expected)).toBe(true);
      // An unnamed building with a key is never titled "Unnamed building" (53 identical labels otherwise).
      if (e.key) expect(expected).not.toMatch(/^Unnamed building/);
    }
  });

  it('reads map keys to screen readers as "Map key C 4, 7"', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    const keyed = campusDirectoryFor(data).entries.find((e) => e.key)!;
    const m = /^([A-Z])(\d+)-(\d+)$/.exec(keyed.key!)!;
    expect(screen.getAllByText(`Map key ${m[1]} ${Number(m[2])}, ${Number(m[3])}`).length).toBeGreaterThan(0);
  });

  it('searches by map key and selects the row through the shared store', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    const keyed = campusDirectoryFor(data).entries.find(
      (e) => e.key && e.routableReason !== 'no-place-record',
    )!;
    fireEvent.change(screen.getByLabelText('Search buildings or map keys'), { target: { value: keyed.key } });
    expect(screen.getByText(/^\d+ buildings? match/)).toBeInTheDocument();
    const row = screen.getAllByRole('button').find((b) => b.textContent?.includes(keyed.title))!;
    fireEvent.click(row);
    const s = useAppStore.getState();
    expect(s.selectedPlaceId).toBe(keyed.id);
    expect(s.focusRequest).toMatchObject({ kind: 'place', placeId: keyed.id });
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('shows an empty state for no matches', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    fireEvent.change(screen.getByLabelText('Search buildings or map keys'), {
      target: { value: 'zzzz-no-such' },
    });
    expect(screen.getByText('No buildings match')).toBeInTheDocument();
  });

  it('is one tab stop: arrow keys, Home and End move focus between rows', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    const rows = screen.getAllByRole('button').filter((b) => b.closest('li'));
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows.at(-1));
    fireEvent.keyDown(rows.at(-1)!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    expect(rows[0]!.tabIndex).toBe(0);
  });

  it('switches grouping to category and filters by category', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    fireEvent.click(screen.getByRole('radio', { name: 'Category' }));
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0);
    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    const option = [...select.options].find((o) => o.value !== '')!;
    fireEvent.change(select, { target: { value: option.value } });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });

  it('notes routability on every row', () => {
    renderWithAtlas(<DirectoryPanel />, services);
    const dir = campusDirectoryFor(data);
    const unroutable = dir.entries.find((e) => !e.routable);
    if (unroutable) expect(screen.getAllByText(unroutable.routableNote).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Directions available').length).toBe(
      dir.entries.filter((e) => e.routable).length,
    );
  });
});

describe('DirectoryPeek', () => {
  it('summarises the directory, then shows the selected building', () => {
    const browse = () => undefined;
    renderWithAtlas(<DirectoryPeek onBrowse={browse} />, services);
    expect(screen.getByText(/campus buildings · \d+ with a map key/)).toBeInTheDocument();
    cleanup();
    const keyed = campusDirectoryFor(data).entries.find((e) => e.key)!;
    useAppStore.setState({ selectedPlaceId: keyed.id });
    renderWithAtlas(<DirectoryPeek onBrowse={browse} />, services);
    const root = screen.getByRole('button', { name: 'Browse' }).parentElement!;
    expect(within(root).getByText(keyed.title)).toBeInTheDocument();
  });
});
