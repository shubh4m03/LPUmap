import { describe, expect, it, vi } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { createIsoController, FOCUS_PX_PER_M } from '../../../src/isometric/iso-controller.ts';
import { createIsoProjection, pxPerMetreForZoom } from '../../../src/isometric/projection.ts';
import { buildGround } from '../../../src/isometric/scene.ts';
import { realData } from './helpers.ts';

const ground = buildGround(realData());
const make = (w = 1280, h = 800) => {
  const c = createIsoController({
    frame: ground.frame,
    campusPoints: ground.campusPoints,
    width: w,
    height: h,
  });
  c.setViewport(w, h, { refit: true });
  return c;
};
/** Screen position of a ground point under the controller's current transform. */
const screenOf = (c: ReturnType<typeof make>, lngLat: [number, number]) => {
  const t = c.getTransform();
  const [e, n] = ground.frame.toLocal(lngLat);
  const [x, y] = createIsoProjection(c.getView().rotation).project(e, n, 0);
  return [t.k * x + t.tx, t.k * y + t.ty] as const;
};

describe('IsoController', () => {
  it('opens fitted to the whole campus, inside the viewport, at the default rotation', () => {
    const c = make();
    expect(c.getView().rotation).toBe(c.defaultRotation());
    for (const p of ground.campusPoints) {
      const ll = ground.frame.toLngLat(p[0], p[1]);
      const [x, y] = screenOf(c, ll);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1280);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(800);
    }
  });

  it('a phone opens at roughly 0.3 px/m (§6.3), a desktop larger', () => {
    const phone = make(390, 844);
    expect(phone.getView().pxPerMetre).toBeGreaterThan(0.15);
    expect(phone.getView().pxPerMetre).toBeLessThan(0.5);
    expect(make().getView().pxPerMetre).toBeGreaterThan(phone.getView().pxPerMetre);
  });

  it('clamps the scale between slightly below "fit campus" and 8 px/m', () => {
    const c = make();
    c.setView({ pxPerMetre: 100 });
    expect(c.getView().pxPerMetre).toBe(APP_CONFIG.isometric.maxPxPerMetre);
    c.setView({ pxPerMetre: 0.0001 });
    expect(c.getView().pxPerMetre).toBeCloseTo(c.minPxPerMetre(), 9);
  });

  it('zoomAt keeps the ground point under the cursor fixed', () => {
    const c = make();
    const target: [number, number] = [75.7061335, 31.2549663];
    const [x, y] = screenOf(c, target);
    c.zoomAt(x, y, 2);
    const [x2, y2] = screenOf(c, target);
    expect(x2).toBeCloseTo(x, 6);
    expect(y2).toBeCloseTo(y, 6);
  });

  it('a committed gesture (CSS matrix over the bitmap) lands exactly where the bitmap showed it', () => {
    const c = make();
    c.setView({ pxPerMetre: 1 });
    const target: [number, number] = [75.7032, 31.255];
    const [x, y] = screenOf(c, target);
    const s = 1.5;
    const dx = 37;
    const dy = -21;
    c.applyScreenTransform(s, dx, dy);
    const [x2, y2] = screenOf(c, target);
    expect(x2).toBeCloseTo(s * x + dx, 6);
    expect(y2).toBeCloseTo(s * y + dy, 6);
  });

  it('panBy moves the content by the given pixels', () => {
    const c = make();
    c.setView({ pxPerMetre: 1 });
    const target: [number, number] = [75.7032, 31.255];
    const [x, y] = screenOf(c, target);
    c.panBy(50, -30);
    const [x2, y2] = screenOf(c, target);
    expect(x2).toBeCloseTo(x - 50, 6);
    expect(y2).toBeCloseTo(y + 30, 6);
  });

  it('rotates in 90° steps about the centre; resetNorth restores the default rotation', () => {
    const c = make();
    const r0 = c.getView().rotation;
    const centre = c.getView().center;
    c.rotateBy(1);
    expect(c.getView().rotation).toBe((r0 + 1) % 4);
    expect(c.getView().center).toEqual(centre);
    c.rotateBy(-2);
    expect(c.getView().rotation).toBe((r0 + 3) % 4);
    c.resetNorth();
    expect(c.getView().rotation).toBe(r0);
  });

  it('implements MapController: flyTo with a MapLibre zoom, focus scale, fit, reset; follow is a no-op', () => {
    const c = make();
    const changes = vi.fn();
    c.subscribe(changes);
    c.flyTo([75.705, 31.255], 17);
    expect(c.getView().pxPerMetre).toBeCloseTo(pxPerMetreForZoom(17, 31.255), 9);
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ animate: true }));
    c.resetView();
    c.flyTo([75.705, 31.255]);
    expect(c.getView().pxPerMetre).toBeCloseTo(FOCUS_PX_PER_M, 9);
    const before = c.getView();
    c.follow([75.7, 31.25]);
    expect(c.getView()).toBe(before);
    c.fitCoordinates([
      [75.7, 31.25],
      [75.704, 31.256],
    ]);
    for (const p of [
      [75.7, 31.25],
      [75.704, 31.256],
    ] as [number, number][]) {
      const [x, y] = screenOf(c, p);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1280);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(800);
    }
    c.zoomIn();
    const k = c.getView().pxPerMetre;
    c.zoomOut();
    expect(c.getView().pxPerMetre).toBeLessThan(k);
  });

  it('padding shifts the visual centre (fits avoid panels and sheets)', () => {
    const c = make();
    const centre = c.getView().center;
    const [x0] = screenOf(c, centre);
    c.setPadding({ top: 0, right: 0, bottom: 0, left: 400 });
    const [x1] = screenOf(c, centre);
    expect(x1 - x0).toBeCloseTo(200, 6);
  });

  it('keeps the centre inside APP_CONFIG.map.maxBounds', () => {
    const c = make();
    c.setView({ center: [0, 0] });
    const [w, s, e, n] = APP_CONFIG.map.maxBounds;
    const [lon, lat] = c.getView().center;
    expect(lon).toBeGreaterThanOrEqual(w);
    expect(lon).toBeLessThanOrEqual(e);
    expect(lat).toBeGreaterThanOrEqual(s);
    expect(lat).toBeLessThanOrEqual(n);
  });
});
