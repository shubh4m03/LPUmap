/**
 * Integration glue: "Choose on map" for places that are not connected to the mapped
 * path network (red-team note), the mobile directory peek and the legend swatches.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRouteSolver } from '../../../src/app/hooks/useRouteSolver.ts';
import {
  nearbyPointPrompt,
  notConnectedPickMessage,
  outsideCampusPickMessage,
  PICKED_POINT_LABEL,
  pickPlaceOnMap,
  pickPointOnMap,
} from '../../../src/app/map-picking.ts';
import { buildServices } from '../../../src/app/data/services.ts';
import { OUTSIDE_CAMPUS_REASON, placeEndpoint } from '../../../src/app/place-actions.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { pickFallbackRoles } from '../../../src/components/directions/directions-model.ts';
import { DirectionsPanel } from '../../../src/components/directions/DirectionsPanel.tsx';
import { BuildingLegend } from '../../../src/components/layers/BuildingLegend.tsx';
import { MobileLayout } from '../../../src/components/layout/MobileLayout.tsx';
import { PlaceDetails } from '../../../src/components/place/PlaceDetails.tsx';
import { BottomSheet, type SheetSnap } from '../../../src/components/ui/index.ts';
import type { RouteResult } from '../../../src/routing/index.ts';
import { renderWithAtlas, resetAppStore } from './render-helpers.tsx';
import { BANK, NAMED, withOffCampusNamed } from './synthetic-campus.ts';

describe('choose on map: places not connected to the path network', () => {
  beforeEach(resetAppStore);
  afterEach(() => {
    cleanup();
    resetAppStore();
  });

  it('is an ordinary selection when not picking', () => {
    expect(pickPlaceOnMap(BANK)).toEqual({ kind: 'not-picking' });
    expect(pickPointOnMap([75.7, 31.25])).toEqual({ kind: 'not-picking' });
  });

  it('an unconnected place explains itself and keeps picking on; it never becomes an endpoint', () => {
    act(() => useAppStore.getState().setPickingOnMap('destination'));
    const out = pickPlaceOnMap(BANK);
    expect(out).toEqual({
      kind: 'not-connected',
      message: notConnectedPickMessage('Synthetic Bank', 'destination'),
    });
    expect(notConnectedPickMessage('Synthetic Bank', 'destination')).toBe(
      "“Synthetic Bank” is not connected to the mapped paths, so it can't be the destination. Choose a point on a nearby path instead.",
    );
    expect(useAppStore.getState()).toMatchObject({ pickingOnMap: 'destination', destination: null });
  });

  it('a connected place, then a ground point, set endpoints and end picking', () => {
    act(() => useAppStore.getState().setPickingOnMap('origin'));
    expect(pickPlaceOnMap(NAMED)).toMatchObject({ kind: 'set' });
    expect(useAppStore.getState()).toMatchObject({
      pickingOnMap: null,
      origin: { kind: 'place', placeId: NAMED.id, nodeId: 0 },
    });
    act(() => useAppStore.getState().setPickingOnMap('destination'));
    expect(pickPlaceOnMap(undefined)).toEqual({ kind: 'ignored' });
    expect(useAppStore.getState().pickingOnMap).toBe('destination');
    pickPointOnMap([75.7012, 31.2501]);
    expect(useAppStore.getState()).toMatchObject({
      pickingOnMap: null,
      destination: { kind: 'point', label: PICKED_POINT_LABEL, location: [75.7012, 31.2501] },
    });
  });

  it('the place panel offers a nearby point instead of disabled directions, with a toast', async () => {
    renderWithAtlas(<PlaceDetails placeId={BANK.id} />);
    expect(screen.getByRole('button', { name: 'Directions to here' })).toBeDisabled();
    expect(
      screen.getByText(/Directions unavailable: Not connected to the mapped path network/),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Choose a nearby point on the map' }));
    expect(useAppStore.getState()).toMatchObject({ activePanel: 'directions', pickingOnMap: 'destination' });
    expect(await screen.findByText(nearbyPointPrompt('Synthetic Bank'))).toBeInTheDocument();
  });

  it('an off-campus place is never an endpoint, even with a path node; picking stays on', () => {
    // Owner rule (map spec Phase 6): off-campus places are never routing destinations or origins.
    const outside = { ...NAMED, campusZone: 'off-campus-nearby' as const };
    expect(outside.graphNodeId).toBe(0);
    expect(placeEndpoint(outside)).toBeNull();
    for (const role of ['origin', 'destination'] as const) {
      act(() => useAppStore.getState().setPickingOnMap(role));
      expect(pickPlaceOnMap(outside)).toEqual({
        kind: 'outside-campus',
        message: outsideCampusPickMessage('Synthetic Food Point', role),
      });
      expect(useAppStore.getState()).toMatchObject({ pickingOnMap: role, origin: null, destination: null });
    }
    expect(outsideCampusPickMessage('Synthetic Food Point', 'destination')).toBe(
      "“Synthetic Food Point” is outside the campus, so it can't be the destination. Directions cover campus paths only.",
    );
    // An arbitrary map point can still be picked.
    pickPointOnMap([75.7012, 31.2501]);
    expect(useAppStore.getState()).toMatchObject({
      pickingOnMap: null,
      destination: { kind: 'point', label: PICKED_POINT_LABEL },
    });
  });

  it('the place panel of an off-campus place: directions disabled with the reason, no nearby point', () => {
    renderWithAtlas(<PlaceDetails placeId={NAMED.id} />, buildServices(withOffCampusNamed()));
    expect(screen.getByRole('button', { name: 'Directions to here' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'From here' })).toBeDisabled();
    expect(screen.getByText(`Directions unavailable: ${OUTSIDE_CAMPUS_REASON}`)).toBeVisible();
    expect(OUTSIDE_CAMPUS_REASON).toBe('Outside campus — directions cover campus paths only.');
    expect(screen.queryByRole('button', { name: 'Choose a nearby point on the map' })).toBeNull();
  });

  it('no nearby-point offer without a map (list mode) or for a connected place', () => {
    act(() => useAppStore.getState().enterListMode('No WebGL'));
    const { unmount } = renderWithAtlas(<PlaceDetails placeId={BANK.id} />);
    expect(screen.queryByRole('button', { name: 'Choose a nearby point on the map' })).toBeNull();
    unmount();
    resetAppStore();
    renderWithAtlas(<PlaceDetails placeId={NAMED.id} />);
    expect(screen.queryByRole('button', { name: 'Choose a nearby point on the map' })).toBeNull();
  });
});

describe('directions failure: choose on map fallback', () => {
  beforeEach(resetAppStore);
  afterEach(() => {
    cleanup();
    resetAppStore();
  });

  const fail = (reason: string) => ({ ok: false, reason, message: 'x' }) as unknown as RouteResult;

  it('offers only the endpoints a pick can fix', () => {
    expect(pickFallbackRoles(null)).toEqual([]);
    expect(pickFallbackRoles(fail('origin-unsnappable'))).toEqual(['origin']);
    expect(pickFallbackRoles(fail('destination-unsnappable'))).toEqual(['destination']);
    expect(pickFallbackRoles(fail('no-path'))).toEqual(['origin', 'destination']);
    expect(pickFallbackRoles(fail('same-point'))).toEqual([]);
    expect(pickFallbackRoles(fail('invalid-input'))).toEqual([]);
  });

  function Harness() {
    useRouteSolver();
    return <DirectionsPanel />;
  }

  it('a destination far from the paths gets a "Choose destination on map" action', async () => {
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West', location: [75.7, 31.25] });
      // ~1.1 km north of every synthetic path node.
      useAppStore.getState().setDestination({ kind: 'point', label: 'Far', location: [75.701, 31.26] });
    });
    const alert = screen.getByText('No route found').closest<HTMLElement>('[role="alert"]')!;
    expect(within(alert).getByText('No route found')).toBeInTheDocument();
    expect(within(alert).queryByRole('button', { name: 'Choose start on map' })).toBeNull();
    await userEvent.click(within(alert).getByRole('button', { name: 'Choose destination on map' }));
    expect(useAppStore.getState().pickingOnMap).toBe('destination');
  });

  it('no pick action in list mode (there is no map to pick on)', () => {
    act(() => useAppStore.getState().enterListMode('No WebGL'));
    renderWithAtlas(<Harness />);
    act(() => {
      useAppStore.getState().setOrigin({ kind: 'point', label: 'West', location: [75.7, 31.25] });
      useAppStore.getState().setDestination({ kind: 'point', label: 'Far', location: [75.701, 31.26] });
    });
    const alert = screen.getByText('No route found').closest<HTMLElement>('[role="alert"]')!;
    expect(within(alert).queryByRole('button')).toBeNull();
  });
});

describe('BottomSheet peek slot', () => {
  afterEach(cleanup);

  function Sheet() {
    const [snap, setSnap] = useState<SheetSnap>('peek');
    return (
      <BottomSheet
        open
        title="Building directory"
        onClose={() => {}}
        snap={snap}
        onSnapChange={setSnap}
        peek={
          <button type="button" onClick={() => setSnap('half')}>
            Browse
          </button>
        }
      >
        <p>Full list</p>
      </BottomSheet>
    );
  }

  it('is interactive at peek and goes away once the sheet is raised', async () => {
    render(<Sheet />);
    expect(screen.getByTestId('sheet-peek')).toBeInTheDocument();
    // The body is inert at peek; the peek slot is not.
    expect(screen.getByTestId('sheet-content')).toHaveAttribute('inert');
    expect(screen.getByTestId('sheet-peek').closest('[inert]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(screen.queryByTestId('sheet-peek')).toBeNull();
    expect(screen.getByTestId('sheet-content')).not.toHaveAttribute('inert');
  });
});

describe('BuildingLegend swatches', () => {
  afterEach(cleanup);

  it('the optional detected-footprint entry is a dashed outline with a faint fill; the others are solid', () => {
    const { container } = render(<BuildingLegend theme="light" studioModels detectedFootprints />);
    const swatches = [...container.querySelectorAll<HTMLElement>('[data-swatch]')];
    expect(swatches.map((s) => s.dataset.swatch)).toEqual(['solid', 'solid', 'solid', 'solid', 'dashed']);
    const dashed = swatches[4]!;
    expect(dashed.style.borderStyle).toBe('dashed');
    expect(dashed.className).not.toMatch(/border-border-strong/);
    expect(dashed.getAttribute('style')).toMatch(/color-mix/);
  });
});

describe('mobile directory peek', () => {
  beforeEach(resetAppStore);
  afterEach(() => {
    cleanup();
    resetAppStore();
  });

  it('the directory sheet at peek shows the building count and a Browse action that raises it', async () => {
    act(() => {
      useAppStore.getState().openPanel('directory');
      useAppStore.getState().setSheetSnap('peek');
    });
    renderWithAtlas(<MobileLayout map={<div />} />);
    const peek = screen.getByTestId('sheet-peek');
    expect(peek).toHaveTextContent(/campus building/);
    await userEvent.click(within(peek).getByRole('button', { name: 'Browse' }));
    expect(useAppStore.getState().sheetSnap).toBe('half');
    expect(screen.queryByTestId('sheet-peek')).toBeNull();
  });

  it('other panels keep the plain peek', () => {
    act(() => {
      useAppStore.getState().openPanel('layers');
      useAppStore.getState().setSheetSnap('peek');
    });
    renderWithAtlas(<MobileLayout map={<div />} />);
    expect(screen.queryByTestId('sheet-peek')).toBeNull();
  });
});
