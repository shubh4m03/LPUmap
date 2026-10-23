import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { useRouteSolver } from '../../../src/app/hooks/useRouteSolver.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { DirectionsPanel } from '../../../src/components/directions/DirectionsPanel.tsx';
import type { RouteEndpoint } from '../../../src/routing/index.ts';
import { renderWithAtlas, resetAppStore } from '../app/render-helpers.tsx';
import { NAMED, UNNAMED } from '../app/synthetic-campus.ts';
import { createFakeGeolocation } from '../navigation-ui/fake-geolocation.ts';

function Harness() {
  useRouteSolver();
  return <DirectionsPanel />;
}

const NODE2: RouteEndpoint = { kind: 'point', label: 'East end', location: [75.702, 31.25] };

async function pickFromSearch(role: 'start' | 'destination', query: string, option: RegExp) {
  const box = screen.getByRole('combobox', { name: `Search for the ${role}` });
  await userEvent.clear(box);
  await userEvent.type(box, query);
  const list = screen.getByRole('listbox', { name: `Places for the ${role}` });
  await userEvent.click(within(list).getByRole('option', { name: option }));
}

describe('DirectionsPanel', () => {
  beforeEach(() => {
    resetAppStore();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    cleanup();
    useAppStore.getState().stopLocation();
    resetAppStore();
  });

  it('picks endpoints from the inline search and shows the route with steps and pace footnote', async () => {
    renderWithAtlas(<Harness />);
    await pickFromSearch('start', 'Synthetic Food', /Synthetic Food Point/);
    expect(useAppStore.getState().origin).toMatchObject({ kind: 'place', placeId: NAMED.id });
    act(() => useAppStore.getState().setDestination(NODE2));
    expect(screen.getByTestId('route-summary')).toHaveTextContent('190 m');
    expect(screen.getByText(/Times estimated at 4\.7 km\/h walking pace/)).toBeInTheDocument();
    const steps = screen.getByRole('heading', { name: /Steps/ }).closest('section')!;
    expect(within(steps).getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Start navigation' })).toBeEnabled();
  });

  it('keyboard: arrows and Enter choose a result', async () => {
    renderWithAtlas(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Search for the destination' });
    await userEvent.type(box, 'Synthetic Food');
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    expect(useAppStore.getState().destination).toMatchObject({ placeId: NAMED.id });
  });

  it('places without a position are listed but disabled, with the reason', async () => {
    renderWithAtlas(<Harness />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Search for the start' }), 'Synthetic Library');
    const option = screen.getByRole('option', { name: /Synthetic Library/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveTextContent(/No verified map position/);
    await userEvent.click(option);
    expect(useAppStore.getState().origin).toBeNull();
  });

  it('swap button swaps start and destination', async () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin(NODE2);
      useAppStore.getState().selectPlace(UNNAMED.id, { focus: false, openDetails: false });
    });
    // The start is set, so its editor is folded: only the destination offers the selected place.
    await userEvent.click(screen.getByRole('button', { name: /Selected: Unnamed building/ }));
    expect(useAppStore.getState().destination).toMatchObject({ placeId: UNNAMED.id });
    await userEvent.click(screen.getByRole('button', { name: 'Swap start and destination' }));
    expect(useAppStore.getState().origin).toMatchObject({ placeId: UNNAMED.id });
    expect(useAppStore.getState().destination).toEqual(NODE2);
  });

  it('changing the travel mode recomputes the route and explains step-free honestly', async () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West end', location: [75.7, 31.25] });
      useAppStore.getState().setDestination(NODE2);
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Cycle' }));
    expect(useAppStore.getState().profile).toBe('cycle');
    const r = useAppStore.getState().result;
    expect(r?.ok && r.profile).toBe('cycle');
    expect(screen.getByText(/km\/h riding/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Step-free' }));
    expect(screen.getByText(/Avoids mapped steps only .* not recorded/)).toBeInTheDocument();
    // Costs are proportional to length on this network: no preference control.
    expect(screen.queryByRole('radiogroup', { name: 'Route preference' })).not.toBeInTheDocument();
  });

  it('My location and navigation are disabled with a reason when location is denied', () => {
    renderWithAtlas(<Harness />);
    act(() => useAppStore.setState({ geoStatus: 'denied' }));
    const [mine] = screen.getAllByRole('button', { name: 'My location' });
    expect(mine).toBeDisabled();
    expect(mine).toHaveAccessibleDescription(/blocked for this site/);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West end', location: [75.7, 31.25] });
      useAppStore.getState().setDestination(NODE2);
    });
    const start = screen.getByRole('button', { name: 'Start navigation' });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(/Navigation needs your location/);
  });

  it('a failed request shows an error and no stale route', async () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West end', location: [75.7, 31.25] });
      useAppStore.getState().setDestination(NODE2);
    });
    expect(screen.getByTestId('route-summary')).toBeInTheDocument();
    act(() => useAppStore.getState().setDestination({ ...NODE2, location: [75.7, 31.25] }));
    expect(screen.getByText('No route found').closest('[role="alert"]')).toHaveTextContent(/same place/);
    expect(screen.queryByTestId('route-summary')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Steps/ })).not.toBeInTheDocument();
  });

  it('clicking a step flies the map to where it starts', async () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West end', location: [75.7, 31.25] });
      useAppStore.getState().setDestination(NODE2);
    });
    const steps = screen.getByRole('heading', { name: /Steps/ }).closest('section')!;
    await userEvent.click(within(steps).getAllByRole('button')[0]!);
    expect(useAppStore.getState().focusRequest).toMatchObject({
      kind: 'point',
      lngLat: [75.7, 31.25],
      zoom: 18,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Fit route' }));
    expect(useAppStore.getState().focusRequest).toMatchObject({ kind: 'fit' });
  });

  it('choose on map sets picking mode with a cancel; clear route leaves nothing behind', async () => {
    renderWithAtlas(<Harness />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Choose on map' })[0]!);
    expect(useAppStore.getState().pickingOnMap).toBe('origin');
    expect(screen.getByText(/the map or a place to set the start./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useAppStore.getState().pickingOnMap).toBeNull();

    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West end', location: [75.7, 31.25] });
      useAppStore.getState().setDestination(NODE2);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Clear route' }));
    expect(useAppStore.getState()).toMatchObject({
      origin: null,
      destination: null,
      result: null,
      alternatives: [],
    });
    expect(screen.queryByTestId('route-summary')).not.toBeInTheDocument();
  });

  it('while navigating, editing is locked and End navigation is offered', async () => {
    const geo = createFakeGeolocation();
    const uninstall = geo.install();
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
    onTestFinished(uninstall);
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West end', location: [75.7, 31.25] });
      useAppStore.getState().setDestination(NODE2);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Start navigation' }));
    expect(useAppStore.getState().navigationActive).toBe(true);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear route' })).not.toBeInTheDocument();
    // Keyboard focus moves to the button that replaced the one just pressed.
    expect(screen.getByRole('button', { name: 'End navigation' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(useAppStore.getState().navigationActive).toBe(false);
    expect(screen.getByRole('button', { name: 'Start navigation' })).toHaveFocus();
  });
});
