import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRouteSolver } from '../../../src/app/hooks/useRouteSolver.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { MY_LOCATION_LABEL } from '../../../src/app/store/route-slice.ts';
import { DirectionsPanel } from '../../../src/components/directions/DirectionsPanel.tsx';
import { failureAdvice } from '../../../src/components/directions/directions-model.ts';
import { MapPickPrompt } from '../../../src/components/navigation/MapPickPrompt.tsx';
import type { RouteEndpoint, RouteFailure } from '../../../src/routing/index.ts';
import { renderWithAtlas, resetAppStore } from '../app/render-helpers.tsx';

function Harness() {
  useRouteSolver();
  return <DirectionsPanel />;
}

const WEST: RouteEndpoint = { kind: 'point', label: 'West end', location: [75.7, 31.25] };
const EAST: RouteEndpoint = { kind: 'point', label: 'East end', location: [75.702, 31.25] };
const fail = (reason: RouteFailure['reason']): RouteFailure => ({ ok: false, reason, message: 'x' });

describe('endpoint editing', () => {
  beforeEach(() => {
    resetAppStore();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    cleanup();
    useAppStore.getState().stopLocation();
    resetAppStore();
  });

  it('folds a set endpoint behind "Change", keeping keyboard focus in the field', async () => {
    renderWithAtlas(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Search for the start' });
    await userEvent.type(box, 'Synthetic Food');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(useAppStore.getState().origin).not.toBeNull();
    // The editor folded and focus moved to its toggle instead of being lost.
    expect(screen.queryByRole('combobox', { name: 'Search for the start' })).not.toBeInTheDocument();
    const change = screen.getByRole('button', { name: 'Change the start' });
    expect(change).toHaveFocus();
    expect(change).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(change);
    const again = screen.getByRole('combobox', { name: 'Search for the start' });
    expect(again).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Done changing the start' }));
    expect(screen.queryByRole('combobox', { name: 'Search for the start' })).not.toBeInTheDocument();
  });

  it('a set route keeps the summary close to the top (both editors folded)', () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin(WEST);
      useAppStore.getState().setDestination(EAST);
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId('route-summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change the destination' })).toBeInTheDocument();
  });

  it('choose on map lowers the phone sheet and restores it when picking ends', async () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().openPanel('directions');
      useAppStore.getState().setSheetSnap('half');
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose on map' })[1]!);
    expect(useAppStore.getState()).toMatchObject({ pickingOnMap: 'destination', sheetSnap: 'peek' });
    act(() => {
      // What the map does on a click: set the endpoint, end picking.
      useAppStore.getState().setDestination(EAST);
      useAppStore.getState().setPickingOnMap(null);
    });
    expect(useAppStore.getState().sheetSnap).toBe('half');
  });

  it('the phone map prompt cancels picking', async () => {
    renderWithAtlas(<MapPickPrompt />);
    expect(screen.queryByText(/to set the start/)).not.toBeInTheDocument();
    act(() => useAppStore.getState().setPickingOnMap('origin'));
    expect(
      screen.getByText('Tap the map or a place to set the start.').closest('[role="status"]'),
    ).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useAppStore.getState().pickingOnMap).toBeNull();
  });
});

describe('failureAdvice', () => {
  const mine: RouteEndpoint = { kind: 'point', label: MY_LOCATION_LABEL, location: [75.75, 31.3] };

  it('explains an unreachable "My location" without repeating the router message', () => {
    expect(failureAdvice(fail('origin-unsnappable'), 'walk', mine, EAST)).toMatch(/current position/);
    expect(failureAdvice(fail('destination-unsnappable'), 'walk', WEST, mine)).toMatch(/current position/);
    // A picked point: the router's message already says what to do.
    expect(failureAdvice(fail('origin-unsnappable'), 'walk', WEST, EAST)).toBeNull();
  });

  it('suggests Walk only for step-free (the cycle message already says so)', () => {
    expect(failureAdvice(fail('no-path'), 'step-free')).toMatch(/Try Walk/);
    expect(failureAdvice(fail('no-path'), 'cycle')).toBeNull();
    expect(failureAdvice(fail('no-path'), 'walk')).toBeNull();
  });
});
