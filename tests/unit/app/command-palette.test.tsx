import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { CommandPalette } from '../../../src/components/search/CommandPalette.tsx';
import { useRecents } from '../../../src/favorites/index.ts';
import { buildServices } from '../../../src/app/data/services.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';
import { NAMED, syntheticCampus } from './synthetic-campus.ts';

function open(query = '') {
  act(() => useAppStore.getState().openPalette(query));
}

async function typeQuery(text: string) {
  const input = screen.getByRole('combobox');
  await userEvent.type(input, text);
  await waitFor(() =>
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-label', `Results for ${text}`),
  );
  return input;
}

describe('CommandPalette', () => {
  beforeEach(() => {
    resetAppStore();
    useRecents.getState().clear();
  });
  afterEach(cleanup);

  it('is a modal dialog with a combobox wired to a listbox', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    const dialog = await screen.findByRole('dialog', { name: 'Search the campus atlas' });
    const input = within(dialog).getByRole('combobox');
    expect(input).toHaveFocus();
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('Enter pressed before the debounce settles acts on the typed query, not the idle list', async () => {
    useRecents.getState().push('osm:node/1');
    renderWithAtlas(<CommandPalette />);
    open();
    const input = await screen.findByRole('combobox');
    // One synchronous change + Enter, well inside the debounce window.
    await userEvent.type(input, 'water{Enter}', { delay: null });
    expect(useAppStore.getState()).toMatchObject({ categoryId: 'water', activePanel: 'category' });
    expect(useAppStore.getState().selectedPlaceId).toBeNull();
  });

  it('groups results, moves the active option with arrows/Home/End and announces the count', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    const input = await typeQuery('food');
    const groups = screen.getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Categories');
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(2);
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await userEvent.keyboard('{End}');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]!.id);
    await userEvent.keyboard('{Home}');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    await userEvent.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]!.id);
    await waitFor(() =>
      expect(screen.getByTestId('live-region-polite')).toHaveTextContent(`${options.length} results`),
    );
  });

  it('Enter on a category opens the category panel and closes the palette', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    await typeQuery('food');
    await userEvent.keyboard('{Enter}');
    expect(useAppStore.getState()).toMatchObject({
      paletteOpen: false,
      activePanel: 'category',
      categoryId: 'food',
    });
  });

  it('Enter on a place selects it; Tab on a routable place plans a route', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    await typeQuery('Synthetic Food Point');
    const places = screen.getByRole('group', { name: 'Places' });
    const option = within(places).getAllByRole('option')[0]!;
    // Move to the place option, then Tab.
    while (screen.getByRole('combobox').getAttribute('aria-activedescendant') !== option.id) {
      await userEvent.keyboard('{ArrowDown}');
    }
    await userEvent.keyboard('{Tab}');
    expect(useAppStore.getState()).toMatchObject({ activePanel: 'directions', paletteOpen: false });
    expect(useAppStore.getState().destination).toMatchObject({
      kind: 'place',
      placeId: 'osm:node/1',
      nodeId: 0,
    });

    open();
    await typeQuery('Synthetic Food Point');
    const again = within(screen.getByRole('group', { name: 'Places' })).getAllByRole('option')[0]!;
    await userEvent.click(again);
    expect(useAppStore.getState().selectedPlaceId).toBe('osm:node/1');
  });

  it('a place without a position is selectable but never routed', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    await typeQuery('Synthetic Library');
    const option = within(screen.getByRole('group', { name: 'Places' })).getAllByRole('option')[0]!;
    expect(option).toHaveTextContent('No verified map position');
    while (screen.getByRole('combobox').getAttribute('aria-activedescendant') !== option.id) {
      await userEvent.keyboard('{ArrowDown}');
    }
    await userEvent.keyboard('{Tab}');
    expect(useAppStore.getState().destination).toBeNull();
    expect(useAppStore.getState().paletteOpen).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId('live-region-assertive')).toHaveTextContent('No verified map position'),
    );
    await userEvent.keyboard('{Enter}');
    expect(useAppStore.getState().selectedPlaceId).toBe('cur:synthetic-library');
    expect(useAppStore.getState().focusRequest).toBeNull();
  });

  it('shows an honest empty state with a report action', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    await typeQuery('qqqzzz');
    expect(screen.getByText('No mapped place matches “qqqzzz”.')).toBeInTheDocument();
    expect(screen.getByText(/Most campus buildings are not yet named in OpenStreetMap/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Report missing place' }));
    expect(useAppStore.getState().reportTarget).toEqual({ kind: 'missing-facility', placeName: 'qqqzzz' });
  });

  it('runs commands', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    await typeQuery('3D');
    await userEvent.keyboard('{Enter}');
    expect(useAppStore.getState().paletteOpen).toBe(false);
  });

  it('"Track my walk" starts the walk-tracking session', async () => {
    renderWithAtlas(<CommandPalette />);
    open();
    await typeQuery('track my walk');
    const option = screen.getAllByRole('option')[0]!;
    expect(option).toHaveTextContent('Track my walk');
    await userEvent.keyboard('{Enter}');
    expect(useAppStore.getState()).toMatchObject({ paletteOpen: false, trackingActive: true });
    expect(useAppStore.getState().trackingStartedAt).not.toBeNull();
    act(() => useAppStore.getState().stopLocation());
  });

  it('tells two results with the same title apart by their subtitle', async () => {
    const data = syntheticCampus();
    const host = data.places.find((p) => p.id === NAMED.id)!;
    data.places.push({ ...host, id: 'cur:synthetic-office', kind: 'organization' });
    data.relations.push({
      id: 'rel-org',
      type: 'located_in',
      from: 'cur:synthetic-office',
      to: host.id,
      inferred: false,
      method: 'curated',
      provenance: host.provenance,
    });
    renderWithAtlas(<CommandPalette />, buildServices(data));
    open();
    await typeQuery('Synthetic Food Point');
    const rows = screen
      .getAllByRole('option')
      .filter((o) => o.textContent?.startsWith('Synthetic Food Point'))
      .map((o) => o.textContent);
    expect(rows).toHaveLength(2);
    expect(new Set(rows).size).toBe(2);
    expect(rows.some((t) => t?.includes('Facility'))).toBe(true);
    expect(rows.some((t) => t?.includes('Department or office · in Synthetic Food Point'))).toBe(true);
  });

  it('lists recent places for an empty query', async () => {
    useRecents.getState().push('osm:node/6');
    renderWithAtlas(<CommandPalette />);
    open();
    const group = await screen.findByRole('group', { name: 'Recent' });
    expect(within(group).getByRole('option')).toHaveTextContent('Synthetic Bank');
  });
});
