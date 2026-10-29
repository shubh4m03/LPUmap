/**
 * The Illustrated overview never draws a route or picks a point (it is not
 * geographically exact): while it is shown, a newly found route or "choose on
 * map" switches to the last map mode and says why (ILLUSTRATED_ROUTE_REASON /
 * ILLUSTRATED_PICK_REASON). The map-accurate variant keeps both.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as announcer from '../../../src/accessibility/announcer.ts';
import { useViewModeSync } from '../../../src/app/hooks/useViewMode.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import {
  ILLUSTRATED_PICK_REASON,
  ILLUSTRATED_ROUTE_REASON,
  illustratedHandoffReason,
} from '../../../src/app/view-mode.ts';
import { setIllustratedShown } from '../../../src/app/isometric-variant.ts';

const ok = { ok: true };

describe('illustratedHandoffReason (pure)', () => {
  const iso = { viewMode: 'isometric' as const, result: null, pickingOnMap: null };
  it('a new route found while the illustration is shown → the route reason', () => {
    expect(illustratedHandoffReason({ ...iso, result: ok }, { result: null, pickingOnMap: null }, true)).toBe(
      ILLUSTRATED_ROUTE_REASON,
    );
  });
  it('map picking started while the illustration is shown → the pick reason', () => {
    expect(
      illustratedHandoffReason(
        { ...iso, pickingOnMap: 'origin' },
        { result: null, pickingOnMap: null },
        true,
      ),
    ).toBe(ILLUSTRATED_PICK_REASON);
  });
  it('nothing for a failed route, an unchanged route, the map-accurate variant or a map mode', () => {
    const prev = { result: null, pickingOnMap: null };
    expect(illustratedHandoffReason({ ...iso, result: { ok: false } }, prev, true)).toBeNull();
    expect(
      illustratedHandoffReason({ ...iso, result: ok }, { result: ok, pickingOnMap: null }, true),
    ).toBeNull();
    expect(illustratedHandoffReason({ ...iso, result: ok }, prev, false)).toBeNull();
    expect(
      illustratedHandoffReason({ viewMode: 'standard2d', result: ok, pickingOnMap: null }, prev, true),
    ).toBeNull();
  });
});

function Harness() {
  useViewModeSync();
  return null;
}

describe('useViewModeSync hands the illustrated view over to the map', () => {
  const initial = useAppStore.getState();
  let spoken: string[];
  beforeEach(() => {
    spoken = [];
    vi.spyOn(announcer, 'announce').mockImplementation((m: string) => void spoken.push(m));
    useAppStore.setState(initial, true);
    useAppStore.getState().setViewMode('standard2d');
    useAppStore.getState().setViewMode('isometric');
  });
  afterEach(() => {
    cleanup();
    setIllustratedShown(false);
    vi.restoreAllMocks();
    useAppStore.setState(initial, true);
  });

  it('switches to the last map mode when a route is found while the illustration is shown', () => {
    setIllustratedShown(true);
    render(<Harness />);
    useAppStore.setState({ result: { ok: true } as never });
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    expect(spoken).toContain(ILLUSTRATED_ROUTE_REASON);
  });

  it('switches when "choose on map" starts while the illustration is shown', () => {
    setIllustratedShown(true);
    render(<Harness />);
    useAppStore.getState().setPickingOnMap('destination');
    expect(useAppStore.getState().viewMode).toBe('standard2d');
    expect(useAppStore.getState().pickingOnMap).toBe('destination');
    expect(spoken).toContain(ILLUSTRATED_PICK_REASON);
  });

  it('stays in the map-accurate isometric drawing, which draws routes itself', () => {
    setIllustratedShown(false);
    render(<Harness />);
    useAppStore.setState({ result: { ok: true } as never });
    expect(useAppStore.getState().viewMode).toBe('isometric');
  });
});
