import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRegion } from '../../../src/accessibility/index.ts';
import { App } from '../../../src/app/App.tsx';
import { useAppStore } from '../../../src/app/store/index.ts';
import { supportsWebGL } from '../../../src/buildings3d/index.ts';
import { ToastProvider } from '../../../src/components/ui/index.ts';
import { loadCampusData } from '../../../src/data/index.ts';
import type * as DataModule from '../../../src/data/index.ts';
import type * as Buildings3d from '../../../src/buildings3d/index.ts';
import type { MapViewProps } from '../../../src/map/index.ts';
import { resetAppStore } from '../app/render-helpers.tsx';
import { syntheticCampus } from '../app/synthetic-campus.ts';

const mapProps: { current: MapViewProps | null } = { current: null };
const controller = {
  flyTo: vi.fn(),
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

  it('activating a row that the details view replaces moves focus to the panel heading', async () => {
    renderApp();
    await screen.findByTestId('mock-map');
    act(() => useAppStore.getState().openCategory('food'));
    await userEvent.click(await screen.findByRole('button', { name: /Synthetic Food Point/ }));
    const heading = await screen.findByRole('heading', { name: 'Synthetic Food Point', level: 2 });
    await waitFor(() => expect(heading).toHaveFocus());
    // Closing the panel with its own button leaves focus on the search field, not <body>.
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Search places, categories/ })).toHaveFocus(),
    );
  });

  it('the 3D control reflects and toggles map-slice.mode3d', async () => {
    useAppStore.setState({ mode3d: false });
    renderApp();
    await screen.findByTestId('mock-map');
    // Stable name + aria-pressed (the name must not also flip with the state).
    const btn = screen.getByRole('button', { name: '3D buildings' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(btn);
    expect(useAppStore.getState().mode3d).toBe(true);
    expect(mapProps.current!.mode3d).toBe(true);
    expect(screen.getByRole('button', { name: '3D buildings' })).toHaveAttribute('aria-pressed', 'true');
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
});
