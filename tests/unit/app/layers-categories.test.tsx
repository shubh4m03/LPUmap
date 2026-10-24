import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { CategoryPanel } from '../../../src/components/categories/CategoryPanel.tsx';
import { LayersPanel } from '../../../src/components/layers/LayersPanel.tsx';
import { OPTIONAL_LAYER_TEXT } from '../../../src/components/layers/optional-layer-text.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';

describe('LayersPanel', () => {
  beforeEach(resetAppStore);
  afterEach(cleanup);

  it('shows counts derived from located data and "None mapped yet" for empty groups', () => {
    renderWithAtlas(<LayersPanel />);
    const food = screen.getByRole('switch', { name: /Food & mess/ });
    expect(food).toHaveAccessibleDescription('2 on the map');
    expect(screen.getByRole('switch', { name: /ATMs & banks/ })).toHaveAccessibleDescription('1 on the map');
    // The library exists but has no map position, so its layer has nothing to draw.
    expect(screen.getByRole('switch', { name: /Libraries & study/ })).toHaveAccessibleDescription(
      'None mapped yet',
    );
    expect(screen.getByRole('switch', { name: /Water & washrooms/ })).toHaveAccessibleDescription(
      'None mapped yet',
    );
  });

  it('toggles groups and labels, and restores defaults', async () => {
    renderWithAtlas(<LayersPanel />);
    const food = screen.getByRole('switch', { name: /Food & mess/ });
    await userEvent.click(food);
    expect(food).toHaveAttribute('aria-checked', 'false');
    expect(useAppStore.getState().visibleGroups.has('food')).toBe(false);
    await userEvent.click(screen.getByRole('switch', { name: 'Show labels' }));
    expect(useAppStore.getState().showLabels).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(useAppStore.getState().visibleGroups.has('food')).toBe(true);
    expect(useAppStore.getState().showLabels).toBe(true);
  });

  it('includes the building-height legend', () => {
    renderWithAtlas(<LayersPanel />);
    expect(screen.getByText('Measured height')).toBeInTheDocument();
    expect(screen.getByText('Height unknown (placeholder)')).toBeInTheDocument();
    // Classes that are not drawn are not in the key.
    expect(screen.queryByText('Owner-placed model')).toBeNull();
    expect(screen.queryByText('Unverified detected footprint')).toBeNull();
  });

  it('offers the two opt-in layers, off by default, explaining what they are', async () => {
    renderWithAtlas(<LayersPanel />);
    const nearby = screen.getByRole('switch', { name: 'Nearby, outside campus' });
    const detected = screen.getByRole('switch', { name: 'Unverified detected footprints' });
    expect(nearby).toHaveAttribute('aria-checked', 'false');
    expect(detected).toHaveAttribute('aria-checked', 'false');
    expect(nearby).toHaveAccessibleDescription(OPTIONAL_LAYER_TEXT.nearbyOutsideCampus);
    expect(nearby).toHaveAccessibleDescription(/“Outside campus”/);
    expect(detected).toHaveAccessibleDescription(/not checked on the ground/);
    await userEvent.click(detected);
    expect(useAppStore.getState().showDetectedFootprints).toBe(true);
    // The legend now explains the dashed outlines it draws.
    expect(screen.getByText('Unverified detected footprint')).toBeInTheDocument();
    await userEvent.click(nearby);
    expect(useAppStore.getState().showNearbyOutsideCampus).toBe(true);
    act(() => useAppStore.setState({ viewMode: 'isometric' }));
    expect(screen.getByText('The isometric overview does not draw these layers.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(useAppStore.getState()).toMatchObject({
      showNearbyOutsideCampus: false,
      showDetectedFootprints: false,
    });
  });
});

describe('CategoryPanel', () => {
  beforeEach(resetAppStore);
  afterEach(cleanup);

  it('shows an honest empty state for a category with no records', async () => {
    act(() => useAppStore.getState().openCategory('water'));
    renderWithAtlas(<CategoryPanel />);
    expect(screen.getByText('No drinking-water points are mapped yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Report a missing drinking water/ }));
    expect(useAppStore.getState().reportTarget).toMatchObject({ kind: 'missing-facility' });
  });

  it('does not call places without a map position "mapped"', () => {
    act(() => useAppStore.getState().openCategory('library'));
    renderWithAtlas(<CategoryPanel />);
    expect(screen.getByText(/^1 place · .*1 without a verified map position/)).toBeInTheDocument();
    expect(screen.queryByText(/mapped place/)).toBeNull();
  });

  it('without an origin lists places and asks for a location to sort', () => {
    act(() => useAppStore.getState().openCategory('food'));
    renderWithAtlas(<CategoryPanel />);
    expect(screen.getByText(/turn on your location or select a place/)).toBeInTheDocument();
    expect(screen.getByText(/^2 places/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Synthetic Food Point|Stale Hours Cafe/ })).toHaveLength(2);
  });

  it('sorts by distance from the user, with labelled walking distances', () => {
    useAppStore.setState({
      lastSample: {
        lngLat: [75.7021, 31.25],
        accuracyM: 5,
        timestamp: Date.now(),
        speedMps: null,
        headingDeg: null,
      },
    });
    act(() => useAppStore.getState().openCategory('food'));
    renderWithAtlas(<CategoryPanel />);
    const rows = screen.getAllByRole('button', { name: /Synthetic Food Point|Stale Hours Cafe/ });
    expect(rows[0]).toHaveTextContent('Stale Hours Cafe');
    // Both are reachable over the synthetic path graph, so walking distances are shown.
    expect(rows[0]).toHaveTextContent(/walk · under 1 min/);
    expect(rows[1]).toHaveTextContent(/walk/);
    expect(screen.getByText(/nearest to your location first/)).toBeInTheDocument();
  });
});
