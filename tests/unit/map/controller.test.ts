import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { createMapController, FIT_MAX_ZOOM, FOCUS_ZOOM } from '../../../src/map/index.ts';
import type { ControllerMap } from '../../../src/map/controller.ts';

function fakeMap(zoom = 15) {
  const m = {
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetNorth: vi.fn(),
    setPadding: vi.fn(),
    getPadding: vi.fn(() => ({ top: 1, right: 2, bottom: 3, left: 4 })),
    getCenter: vi.fn(() => ({ lng: 75.7, lat: 31.25 })),
    getZoom: vi.fn(() => zoom),
    getPitch: vi.fn(() => 10),
    getBearing: vi.fn(() => -5),
  };
  return m;
}

function setup(opts: { reducedMotion?: boolean; mode3d?: boolean; zoom?: number } = {}) {
  const map = fakeMap(opts.zoom);
  const ctrl = createMapController(map as unknown as ControllerMap, {
    reducedMotion: () => opts.reducedMotion ?? false,
    mode3d: () => opts.mode3d ?? false,
  });
  return { map, ctrl };
}

const P: LngLat = [75.701, 31.251];

describe('createMapController', () => {
  it('follow re-centres without changing zoom; jumps under reduced motion; ignores bad input', () => {
    const a = setup();
    a.ctrl.follow(P);
    expect(a.map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: P, essential: true }));
    expect(a.map.easeTo.mock.calls[0]?.[0]).not.toHaveProperty('zoom');
    const b = setup({ reducedMotion: true });
    b.ctrl.follow(P);
    expect(b.map.jumpTo).toHaveBeenCalledWith({ center: P });
    b.ctrl.follow([NaN, 31] as LngLat);
    expect(b.map.jumpTo).toHaveBeenCalledTimes(1);
  });

  it('flyTo animates normally and jumps when reduced motion is requested', () => {
    const a = setup();
    a.ctrl.flyTo(P, 18);
    expect(a.map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: P, zoom: 18 }));
    expect(a.map.jumpTo).not.toHaveBeenCalled();

    const b = setup({ reducedMotion: true });
    b.ctrl.flyTo(P, 18);
    expect(b.map.jumpTo).toHaveBeenCalledWith({ center: P, zoom: 18 });
    expect(b.map.flyTo).not.toHaveBeenCalled();
  });

  it('marks every animated move essential so a stale MapLibre reduce-motion flag cannot turn it into a jump', () => {
    // MapLibre's `reduceMotion` map option is a process-wide flag fixed at construction; non-essential
    // moves get duration 0 while it is set, even after the app's reducedMotion prop has turned off.
    const { map, ctrl } = setup({ reducedMotion: false });
    ctrl.flyTo(P, 18);
    ctrl.fitCoordinates([P, [75.71, 31.26]]);
    ctrl.resetView();
    ctrl.zoomIn();
    ctrl.zoomOut();
    ctrl.resetNorth();
    const calls = [map.flyTo, map.fitBounds, map.easeTo, map.zoomIn, map.zoomOut, map.resetNorth];
    for (const fn of calls) {
      expect(fn).toHaveBeenCalledTimes(1);
      const opts = fn.mock.calls[0]!.at(-1) as { essential?: boolean; animate?: boolean };
      expect(opts.essential).toBe(true);
      expect(opts.animate).not.toBe(false);
    }
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it('flyTo without a zoom focuses closer but never zooms out', () => {
    const a = setup({ zoom: 14 });
    a.ctrl.flyTo(P);
    expect(a.map.flyTo.mock.calls[0]?.[0]).toMatchObject({ zoom: FOCUS_ZOOM });
    const b = setup({ zoom: 19 });
    b.ctrl.flyTo(P);
    expect(b.map.flyTo.mock.calls[0]?.[0]).toMatchObject({ zoom: 19 });
  });

  it('ignores invalid coordinates', () => {
    const a = setup();
    a.ctrl.flyTo([NaN, 31] as LngLat);
    a.ctrl.fitCoordinates([]);
    expect(a.map.flyTo).not.toHaveBeenCalled();
    expect(a.map.fitBounds).not.toHaveBeenCalled();
  });

  it('fitCoordinates fits the bounding box with padding and maxZoom 18', () => {
    const { map, ctrl } = setup();
    ctrl.fitCoordinates([[75.702, 31.25], [75.7, 31.253], [75.705, 31.251], [500, 0] as LngLat], 64);
    expect(map.fitBounds).toHaveBeenCalledWith(
      [
        [75.7, 31.25],
        [75.705, 31.253],
      ],
      { padding: 64, maxZoom: FIT_MAX_ZOOM, animate: true, essential: true },
    );
    expect(FIT_MAX_ZOOM).toBe(18);
  });

  it('fitCoordinates with one point flies to it, and respects reduced motion', () => {
    const a = setup();
    a.ctrl.fitCoordinates([P]);
    expect(a.map.flyTo).toHaveBeenCalled();
    const b = setup({ reducedMotion: true });
    b.ctrl.fitCoordinates([P, [75.71, 31.26]]);
    expect(b.map.fitBounds.mock.calls[0]?.[1]).toMatchObject({ animate: false });
  });

  it('resetView restores the configured view with pitch/bearing for the current mode', () => {
    const flat = setup({ mode3d: false });
    flat.ctrl.resetView();
    expect(flat.map.easeTo).toHaveBeenCalledWith({
      center: APP_CONFIG.map.center,
      zoom: APP_CONFIG.map.zoom,
      pitch: 0,
      bearing: 0,
      essential: true,
    });
    const tilted = setup({ mode3d: true, reducedMotion: true });
    tilted.ctrl.resetView();
    expect(tilted.map.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ pitch: APP_CONFIG.map.pitch3d, bearing: APP_CONFIG.map.bearing3d }),
    );
  });

  it('zoom, north and padding delegate to the map', () => {
    const { map, ctrl } = setup({ reducedMotion: true });
    ctrl.zoomIn();
    ctrl.zoomOut();
    ctrl.resetNorth();
    ctrl.setPadding({ top: 10, right: 0, bottom: 300, left: 0 });
    expect(map.zoomIn).toHaveBeenCalledWith({ animate: false, essential: true });
    expect(map.zoomOut).toHaveBeenCalledWith({ animate: false, essential: true });
    expect(map.resetNorth).toHaveBeenCalledWith({ animate: false, essential: true });
    expect(map.setPadding).toHaveBeenCalledWith({ top: 10, right: 0, bottom: 300, left: 0 });
  });

  it('getCamera reports centre, zoom, pitch, bearing and padding', () => {
    const { ctrl } = setup({ zoom: 16 });
    expect(ctrl.getCamera()).toEqual({
      center: [75.7, 31.25],
      zoom: 16,
      pitch: 10,
      bearing: -5,
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
    });
  });
});
