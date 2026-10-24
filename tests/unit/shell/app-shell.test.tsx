import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRegion } from '../../../src/accessibility/index.ts';
import { App } from '../../../src/app/App.tsx';
// App loads the shell lazily. Importing it here as well makes the shell resolve to the
// same module instances as this file, so the vi.mock()ed modules below (supportsWebGL)
// are the ones the shell calls.
import '../../../src/components/layout/AppShell.tsx';
import { useAppStore } from '../../../src/app/store/index.ts';
import { supportsWebGL } from '../../../src/buildings3d/index.ts';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { loadCampusData } from '../../../src/data/index.ts';
import type * as DataModule from '../../../src/data/index.ts';
import type * as Buildings3d from '../../../src/buildings3d/index.ts';
import type * as ViewModeModule from '../../../src/app/view-mode.ts';
import type { MapViewProps } from '../../../src/map/index.ts';
import { resetAppStore } from '../app/render-helpers.tsx';
import { syntheticCampus } from '../app/synthetic-campus.ts';

const mapProps: { current: MapViewProps | null } = { current: null };
const controller = {
  flyTo: vi.fn(),
  follow: vi.fn(),
  fitCoordinates: vi.fn(),
  resetView: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  resetNorth: vi.fn(),
  setPadding: vi.fn(),
};

vi.mock('../../../src/map/index.ts', async () => {
  const { useEffect } = await import('react');
  const errors = await import('../../../src/map/errors.ts');
  return {
    MAP_MESSAGES: errors.MAP_MESSAGES,
    MapView(props: MapViewProps) {
      mapProps.current = props;
      useEffect(() => props.onReady?.(controller), []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="mock-map" data-selected={props.selectedPlaceId ?? ''} />;
    },
  };
});
vi.mock('../../../src/app/maplibre-worker.ts', () => ({}));
// The Canvas2D overview cannot draw in jsdom: a stub that shows what it was given.
vi.mock('../../../src/app/IsoStudioStage.tsx', async () => {
  const { useAppStore: store } = await import('../../../src/app/store/index.ts');
  return {
    IsoStudioStage() {
      const selected = store((s) => s.selectedPlaceId);
      return <div data-testid="mock-overview" data-selected={selected ?? ''} />;
    },
  };
});
const canvas = { supported: false };
vi.mock('../../../src/app/view-mode.ts', async (orig) => ({
  ...(await orig<typeof ViewModeModule>()),
  supportsCanvas2D: () => canvas.supported,
}));
vi.mock('../../../src/buildings3d/index.ts', async (orig) => ({
  ...(await orig<typeof Buildings3d>()),
  supportsWebGL: vi.fn(() => true),
}));
vi.mock('../../../src/data/index.ts', async (orig) => {
  const actual = await orig<typeof DataModule>();
  return { ...actual, loadCampusData: vi.fn() };
});

/** Counts history.go() calls whose popstate has not arrived yet. */
const traversals = { pending: 0 };
const realGo = window.history.go.bind(window.history);
vi.spyOn(window.history, 'go').mockImplementation((delta?: number) => {
  traversals.pending += 1;
  realGo(delta);
});
window.addEventListener('popstate', () => {
  if (traversals.pending > 0) traversals.pending -= 1;
});

function renderApp() {
  return render(
    <ToastProvider>
      <App />
      <LiveRegion />
    </ToastProvider>,
  );
}

describe('App shell', () => {
  beforeEach(() => {
    resetAppStore();
    vi.mocked(loadCampusData).mockResolvedValue(syntheticCampus());
    vi.mocked(supportsWebGL).mockReturnValue(true);
    canvas.supported = false;
    window.history.replaceState(null, '', '/');
    mapProps.current = null;
    Object.values(controller).forEach((f) => f.mockClear());
  });
  afterEach(async () => {
    // history.go() is asynchronous (as in browsers): wait until every rewind the app
    // started has landed, so its popstate never fires into the next test.
    await waitFor(() => expect(traversals.pending).toBe(0), { timeout: 3000 });
    cleanup();
  });

  it('renders the map, search trigger and controls once data has loaded', async () => {
    renderApp();
    expect(await screen.findByTestId('mock-map')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search places, categories/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Map controls' })).toBeInTheDocument();
    await waitFor(() => expect(controller.setPadding).toHaveBeenCalled());
  });

  it('opens the palette with Ctrl+K and "/" and closes it with Escape', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: 'Search the campus atlas' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.keyboard('/');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('map selection opens details; an empty-map click closes them', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => mapProps.current!.onSelectPlace('osm:node/1'));
    expect(
      await screen.findByRole('heading', { name: 'Synthetic Food Point', level: 3 }),
    ).toBeInTheDocument();
    expect(window.location.search).toContain('place=osm%3Anode%2F1');
    act(() => mapProps.current!.onSelectPlace(null));
    await waitFor(() => expect(useAppStore.getState().activePanel).toBe('none'));
    await waitFor(() => expect(window.location.search).not.toContain('place='));
  });

  it('while picking on the map, a click sets the route endpoint instead', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.getState().setPickingOnMap('origin'));
    act(() => mapProps.current!.onMapClick?.([75.7001, 31.25]));
    expect(useAppStore.getState().origin).toMatchObject({ kind: 'point', location: [75.7001, 31.25] });
    expect(useAppStore.getState().pickingOnMap).toBeNull();
  });

  it('a ?place deep link selects and focuses the place', async () => {
    window.history.replaceState(null, '', '/?place=osm:node/6');
    renderApp();
    await screen.findByTestId('mock-map');
    expect(useAppStore.getState().selectedPlaceId).toBe('osm:node/6');
    await waitFor(() => expect(controller.flyTo).toHaveBeenCalledWith([75.7001, 31.2501]));
  });

  it('an unknown deep link is dropped with a notice', async () => {
    window.history.replaceState(null, '', '/?place=osm:node/424242');
    renderApp();
    await screen.findByTestId('mock-map');
    expect(
      await screen.findByText('The linked place is not in the current campus dataset.'),
    ).toBeInTheDocument();
    expect(useAppStore.getState().selectedPlaceId).toBeNull();
  });

  it('falls back to list mode without WebGL, keeping search, categories and details', async () => {
    vi.mocked(supportsWebGL).mockReturnValue(false);
    renderApp();
    expect(await screen.findByText(/You are using the list view/)).toBeInTheDocument();
    expect(screen.queryByTestId('mock-map')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Food & drink/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Synthetic Food Point/ }));
    expect(
      await screen.findByRole('heading', { name: 'Synthetic Food Point', level: 3 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zoom to/ })).toBeNull();
  });

  it('a fatal map error switches to list mode', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    const { MAP_MESSAGES } = await import('../../../src/map/errors.ts');
    act(() => mapProps.current!.onError?.(MAP_MESSAGES.webglUnavailable));
    expect(await screen.findByText(/You are using the list view/)).toBeInTheDocument();
  });

  it('a non-fatal map error shows a dismissible banner', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => mapProps.current!.onError?.('Some campus map data could not be drawn.'));
    expect(await screen.findByText('Some campus map data could not be drawn.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Some campus map data could not be drawn.')).toBeNull();
  });

  it('browser back closes the topmost panel', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.getState().openPanel('layers'));
    act(() => useAppStore.getState().openPanel('about'));
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(useAppStore.getState().activePanel).toBe('layers');
  });

  it('activating a row that the details view replaces moves focus to the place heading, without a ring', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.getState().openCategory('food'));
    await userEvent.click(await screen.findByRole('button', { name: /Synthetic Food Point/ }));
    const heading = await screen.findByRole('heading', { name: 'Synthetic Food Point', level: 3 });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '-1');
    // Programmatic focus on a heading asks the browser not to draw the focus ring.
    const call = focusSpy.mock.calls.find((_, i) => focusSpy.mock.contexts[i] === heading);
    expect(call?.[0]).toMatchObject({ focusVisible: false });
    focusSpy.mockRestore();
    // The place name appears once as a heading; the panel header names the panel kind,
    // and the panel landmark's accessible name still says which place it is about.
    expect(screen.getAllByRole('heading', { name: 'Synthetic Food Point' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Place details', level: 2 })).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Synthetic Food Point, place details' }),
    ).toBeInTheDocument();
    // Closing the panel with its own button leaves focus on the search field, not <body>.
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Search places, categories/ })).toHaveFocus(),
    );
  });

  it('the view-mode switcher reflects and switches the mode (3D ↔ 2D keep the same map)', async () => {
    useAppStore.setState({ viewMode: 'standard2d', mode3d: false });
    renderApp();
    await screen.findByTestId('mock-map');
    const group = screen.getByRole('radiogroup', { name: 'View mode' });
    expect(within(group).getByRole('radio', { name: '2D map' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(group).getByRole('radio', { name: '3D map' }));
    expect(useAppStore.getState().mode3d).toBe(true);
    expect(mapProps.current!.mode3d).toBe(true);
    expect(within(group).getByRole('radio', { name: '3D map' })).toHaveAttribute('aria-checked', 'true');
    // Focus stays on the switcher and the change is announced.
    expect(within(group).getByRole('radio', { name: '3D map' })).toHaveFocus();
    expect(await screen.findByText('3D map shown')).toBeInTheDocument();
    expect(window.location.search).toContain('view=3d');
  });

  it('switching to the overview mounts it in place of the map, keeping the selection', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.getState().selectPlace('osm:node/1', { focus: false }));
    await userEvent.click(screen.getByRole('radio', { name: 'Isometric overview' }));
    expect(await screen.findByTestId('mock-overview')).toHaveAttribute('data-selected', 'osm:node/1');
    expect(screen.queryByTestId('mock-map')).toBeNull();
    expect(window.location.search).toContain('view=iso');
    await userEvent.click(screen.getByRole('radio', { name: '2D map' }));
    expect(await screen.findByTestId('mock-map')).toHaveAttribute('data-selected', 'osm:node/1');
  });

  it('live navigation disables the overview option with its reason, never hiding it', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.setState({ navigationActive: true }));
    const overview = screen.getByRole('radio', { name: 'Isometric overview' });
    expect(overview).toHaveAttribute('aria-disabled', 'true');
    expect(overview).toHaveAccessibleDescription('Not available during live navigation');
    await userEvent.click(overview);
    expect(useAppStore.getState().viewMode).not.toBe('isometric');
    act(() => useAppStore.setState({ navigationActive: false }));
  });

  it('starting navigation in the overview switches to the last map mode and says so', async () => {
    useAppStore.setState({ viewMode: 'isometric', lastMapMode: 'standard2d', mode3d: false });
    renderApp();
    await screen.findByTestId('mock-overview');
    act(() => useAppStore.setState({ navigationActive: true }));
    await waitFor(() => expect(useAppStore.getState().viewMode).toBe('standard2d'));
    expect(
      await screen.findByText('Live navigation uses the map view. Switched to 2D map.'),
    ).toBeInTheDocument();
    act(() => useAppStore.setState({ navigationActive: false }));
  });

  it('without WebGL but with Canvas2D, the overview replaces the map and the map modes say why', async () => {
    vi.mocked(supportsWebGL).mockReturnValue(false);
    canvas.supported = true;
    renderApp();
    expect(await screen.findByTestId('mock-overview')).toBeInTheDocument();
    expect(screen.queryByText(/You are using the list view/)).toBeNull();
    expect(useAppStore.getState().viewMode).toBe('isometric');
    const map3d = screen.getByRole('radio', { name: '3D map' });
    expect(map3d).toHaveAttribute('aria-disabled', 'true');
    expect(map3d).toHaveAccessibleDescription(/no WebGL/);
    await userEvent.click(map3d);
    expect(useAppStore.getState().viewMode).toBe('isometric');
    // A fallback is not written to the URL (a shared link must not force the overview elsewhere).
    expect(window.location.search).not.toContain('view=');
  });

  it('the locate control names its action and exposes its state without aria-pressed', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    const idle = screen.getByRole('button', { name: 'Show my location' });
    expect(idle).not.toHaveAttribute('aria-pressed');
    expect(idle).toHaveAttribute('data-state', 'off');
    act(() => useAppStore.setState({ geoStatus: 'active', locationActive: true }));
    expect(await screen.findByRole('button', { name: 'Stop showing my location' })).toHaveAttribute(
      'data-state',
      'on',
    );
    act(() => useAppStore.setState({ geoStatus: 'denied', locationActive: false }));
    expect(await screen.findByRole('button', { name: /Location blocked/ })).toHaveAttribute(
      'data-state',
      'problem',
    );
  });

  const sample = (lngLat: [number, number]) => ({
    lngLat,
    accuracyM: 8,
    timestamp: Date.now(),
    speedMps: null,
    headingDeg: null,
  });

  it('first location fix inside the campus bounds centres the map on it', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.setState({ geoStatus: 'requesting' }));
    act(() => useAppStore.setState({ geoStatus: 'active', lastSample: sample([75.7032, 31.2533]) }));
    expect(useAppStore.getState().focusRequest).toMatchObject({ kind: 'point', lngLat: [75.7032, 31.2533] });
    await waitFor(() => expect(controller.flyTo).toHaveBeenCalledWith([75.7032, 31.2533], undefined), {
      timeout: 3000,
    });
  });

  it('first location fix outside the campus bounds keeps the map on campus and says why', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.setState({ geoStatus: 'requesting' }));
    // About 6 km east of campus, outside APP_CONFIG.map.maxBounds.
    act(() => useAppStore.setState({ geoStatus: 'active', lastSample: sample([75.77, 31.2533]) }));
    expect(await screen.findByText('You appear to be outside the campus area')).toBeInTheDocument();
    expect(useAppStore.getState().focusRequest).toBeNull();
    expect(controller.flyTo).not.toHaveBeenCalled();
  });

  it('while navigating the camera follows accepted fixes until the user pans; Follow resumes it', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.setState({ navigationActive: true, followUser: true }));
    act(() => useAppStore.setState({ lastSample: sample([75.7001, 31.25]) }));
    await waitFor(() => expect(controller.follow).toHaveBeenCalledWith([75.7001, 31.25]));
    // The user drags the map: following stops and later fixes leave the camera alone.
    act(() => mapProps.current!.onUserPan?.());
    expect(useAppStore.getState().followUser).toBe(false);
    controller.follow.mockClear();
    act(() => useAppStore.setState({ lastSample: sample([75.7002, 31.25]) }));
    expect(controller.follow).not.toHaveBeenCalled();
    act(() => useAppStore.getState().setFollowUser(true));
    await waitFor(() => expect(controller.follow).toHaveBeenCalledWith([75.7002, 31.25]));
    act(() => useAppStore.setState({ navigationActive: false, followUser: false, lastSample: null }));
  });
});
