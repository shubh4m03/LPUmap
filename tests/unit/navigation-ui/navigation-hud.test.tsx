import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { NavigationHud } from '../../../src/components/navigation/NavigationHud.tsx';
import type { LngLat } from '../../../src/data/index.ts';
import type { RouteEndpoint } from '../../../src/routing/index.ts';
import { renderWithAtlas, resetAppStore, syntheticServices } from '../app/render-helpers.tsx';
import { createFakeGeolocation, storageSnapshot, type FakeGeolocation } from './fake-geolocation.ts';

const WEST: RouteEndpoint = { kind: 'point', label: 'West end', location: [75.7, 31.25] };
const EAST: RouteEndpoint = { kind: 'point', label: 'East end', location: [75.702, 31.25] };

let geo: FakeGeolocation;
let uninstall: () => void;
let t0: number;
/** Emit a synthetic fix `dtS` seconds after the scenario start. */
const at = (lngLat: LngLat, dtS: number, accuracyM = 8) =>
  act(() => geo.emit(lngLat, accuracyM, t0 + dtS * 1000));

function startNavigating() {
  const services = syntheticServices();
  const route = services.router.route({ from: WEST, to: EAST, profile: 'walk' });
  if (!route.ok) throw new Error('synthetic route failed');
  act(() => {
    const s = useAppStore.getState();
    s.setOrigin(WEST);
    s.setDestination(EAST);
    s.setRouteResult(route, [route]);
    s.startNavigation();
  });
  return services;
}

const live = () => screen.getByTestId('live-region-assertive');

describe('NavigationHud with scripted samples', () => {
  let storageBefore: string;
  beforeEach(() => {
    resetAppStore();
    geo = createFakeGeolocation();
    uninstall = geo.install();
    Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
    t0 = Date.now();
    localStorage.clear();
    sessionStorage.clear();
    storageBefore = storageSnapshot();
  });
  afterEach(() => {
    expect(storageSnapshot()).toBe(storageBefore);
    cleanup();
    useAppStore.getState().stopLocation();
    uninstall();
    resetAppStore();
  });

  it('renders nothing when idle', () => {
    renderWithAtlas(<NavigationHud />);
    expect(screen.queryByRole('region', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('follows progress, pauses on weak GPS, flags off-route only after consecutive fixes, recalculates, arrives', async () => {
    const services = startNavigating();
    renderWithAtlas(<NavigationHud />, services);
    expect(screen.getByRole('region', { name: 'Navigation' })).toHaveTextContent('To East end');
    expect(screen.getByText('Waiting for GPS…')).toBeInTheDocument();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    // No fix yet: recentring cannot work, so the button says why instead of doing nothing.
    expect(screen.getByRole('button', { name: /Centre the map on me/ })).toBeDisabled();

    at([75.7, 31.25], 0);
    expect(screen.getByRole('button', { name: 'Centre the map on me' })).toBeEnabled();
    expect(screen.getByText(/190 m left/)).toBeInTheDocument();
    expect(screen.getByText('GPS ±8 m')).toBeInTheDocument();
    expect(screen.getByText(/Planned route 190 m/)).toBeInTheDocument();
    expect(screen.getByText(/Straight line to destination 190 m/)).toBeInTheDocument();

    at([75.701, 31.25], 20);
    expect(screen.getByText(/95 m left/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Route progress' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    at([75.7012, 31.25], 25, 120); // low accuracy
    expect(screen.getByText('Weak GPS signal — progress paused')).toBeInTheDocument();
    expect(screen.getByText(/95 m left/)).toBeInTheDocument();

    // ~44 m north of the path: off-route only after three consecutive fixes.
    at([75.701, 31.2504], 40);
    at([75.701, 31.2504], 45);
    expect(screen.queryByText('You seem to be off the route')).not.toBeInTheDocument();
    at([75.701, 31.2504], 50);
    expect(screen.getByText('You seem to be off the route')).toBeInTheDocument();
    expect(live()).toHaveTextContent(/off the route/);
    // Announced once through the live region, not a second time by an alert role.
    expect(screen.getByText('You seem to be off the route').closest('[role="alert"]')).toBeNull();
    expect(live()).not.toHaveTextContent(/\d+\.\d{3}/); // never coordinates

    await userEvent.click(screen.getByRole('button', { name: 'Recalculate from here' }));
    expect(useAppStore.getState().origin?.label).toBe('Your position (recalculated)');
    expect(screen.queryByText('You seem to be off the route')).not.toBeInTheDocument();
    expect(screen.queryByText('Still on the original route')).not.toBeInTheDocument();

    at([75.702, 31.25], 80);
    at([75.702, 31.25], 85);
    expect(screen.getByText('You have arrived')).toBeInTheDocument();
    expect(live()).toHaveTextContent('You have arrived at East end.');

    await userEvent.click(screen.getByRole('button', { name: 'End navigation' }));
    expect(useAppStore.getState().navigationActive).toBe(false);
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Navigation' })).not.toBeInTheDocument();
  });

  it('a failed recalculation keeps the original route, clearly marked', async () => {
    const services = startNavigating();
    renderWithAtlas(<NavigationHud />, services);
    const before = useAppStore.getState().alternatives[0];
    at([75.7, 31.25], 0);
    // ~111 m north: beyond the snapping limit, so no route can start here.
    at([75.7, 31.251], 20);
    at([75.7, 31.251], 25);
    at([75.7, 31.251], 30);
    await userEvent.click(screen.getByRole('button', { name: 'Recalculate from here' }));
    expect(screen.getByText('Still on the original route')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Navigation' })).toHaveTextContent(/Couldn't recalculate/);
    expect(useAppStore.getState().alternatives[0]).toBe(before);
    expect(useAppStore.getState().navigationActive).toBe(true);
  });

  it('shows the background pause notice when the tab returns with a stale fix', () => {
    const services = startNavigating();
    renderWithAtlas(<NavigationHud />, services);
    at([75.7, 31.25], -120); // two minutes old
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(
      screen.getByText('Location updates paused while the app was in the background'),
    ).toBeInTheDocument();
    at([75.7, 31.25], 0);
    expect(
      screen.queryByText('Location updates paused while the app was in the background'),
    ).not.toBeInTheDocument();
  });

  it('explains a denied permission in the HUD', () => {
    const services = startNavigating();
    renderWithAtlas(<NavigationHud />, services);
    act(() => geo.fail(1));
    expect(screen.getByText('Location problem')).toBeInTheDocument();
    expect(screen.getByText(/site settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End navigation' })).toBeInTheDocument();
  });

  it('walk tracking shows live numbers and a summary dialog when stopped', async () => {
    renderWithAtlas(<NavigationHud />);
    act(() => useAppStore.getState().startTracking());
    expect(screen.getByRole('region', { name: 'Walk tracking' })).toBeInTheDocument();
    at([75.7, 31.25], 0, 5);
    at([75.7005, 31.25], 15, 5);
    at([75.701, 31.25], 30, 5);
    expect(screen.getByText(/95 m ·/)).toBeInTheDocument();
    expect(screen.getByText('GPS ±5 m')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Stop tracking' }));
    const dialog = screen.getByRole('dialog', { name: 'Walk summary' });
    expect(dialog).toHaveTextContent('Distance travelled');
    expect(dialog).toHaveTextContent('95 m');
    expect(dialog).toHaveTextContent(/not fitness-grade/);
    expect(dialog).toHaveTextContent(/Nothing was saved/);
    expect(dialog).not.toHaveTextContent('Planned route');
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useAppStore.getState().trackingSummary).toBeNull();
  });

  it('walk tracking offers Retry after a location timeout, without ending the session', async () => {
    renderWithAtlas(<NavigationHud />);
    act(() => useAppStore.getState().startTracking());
    act(() => geo.fail(3));
    expect(screen.getByText('Location problem')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().trackingActive).toBe(true);
  });

  it('tracking started from the navigation card compares planned and actual distance', async () => {
    const services = startNavigating();
    renderWithAtlas(<NavigationHud />, services);
    await userEvent.click(screen.getByRole('button', { name: 'Track my walk' }));
    expect(screen.getByText(/Tracked < 10 m of 190 m planned/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop tracking' }));
    expect(screen.getByRole('dialog', { name: 'Walk summary' })).toHaveTextContent('Planned route');
  });
});
