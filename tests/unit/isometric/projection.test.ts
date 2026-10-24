import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import {
  createIsoProjection,
  createLocalFrame,
  defaultRotation,
  EARTH_RADIUS_M,
  fromScreen,
  ISO_ROTATIONS,
  pxPerMetreForZoom,
  rotationThetaDeg,
  toScreen,
  zoomForPxPerMetre,
} from '../../../src/isometric/projection.ts';

const DEG = Math.PI / 180;
function haversine(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

describe('local frame (§6.3)', () => {
  const frame = createLocalFrame();

  it('is centred on APP_CONFIG.map.center and round-trips exactly', () => {
    expect(frame.toLocal(APP_CONFIG.map.center)).toEqual([0, 0]);
    const p: [number, number] = [75.7061335, 31.2549663];
    const [e, n] = frame.toLocal(p);
    const back = frame.toLngLat(e, n);
    expect(back[0]).toBeCloseTo(p[0], 12);
    expect(back[1]).toBeCloseTo(p[1], 12);
  });

  it('matches great-circle distances across the campus to well under 1 m', () => {
    const [w, s, e, n] = APP_CONFIG.map.maxBounds;
    for (const p of [
      [w, s],
      [e, n],
      [w, n],
      [e, s],
    ] as [number, number][]) {
      const [x, y] = frame.toLocal(p);
      const err = Math.abs(Math.hypot(x, y) - haversine(APP_CONFIG.map.center, p));
      expect(err).toBeLessThan(1); // ≤ 1 m over ~2.5 km; the campus is within ~1 km of the origin
    }
  });
});

describe('2:1 dimetric projection', () => {
  it('rotation r shows θ = 45° + 90°·r at the top of the screen', () => {
    expect(ISO_ROTATIONS.map(rotationThetaDeg)).toEqual([45, 135, 225, 315]);
    for (const r of ISO_ROTATIONS) {
      const proj = createIsoProjection(r);
      const t = rotationThetaDeg(r) * DEG;
      // A ground point in the compass direction θ is straight up the screen.
      const [x, y] = proj.project(Math.sin(t) * 100, Math.cos(t) * 100, 0);
      expect(x).toBeCloseTo(0, 9);
      expect(y).toBeLessThan(0);
    }
  });

  it('draws ground axes at a 2:1 slope and verticals straight up, scaled by cos α', () => {
    const proj = createIsoProjection(0);
    const [x, y] = proj.project(1, 0, 0); // east, at θ = 45°
    expect(Math.abs(x / y)).toBeCloseTo(2, 9);
    const [zx, zy] = proj.project(0, 0, 10);
    expect(zx).toBe(0);
    expect(zy).toBeCloseTo(-10 * Math.cos(30 * DEG), 9);
  });

  it('inverts exactly onto the ground plane', () => {
    for (const r of ISO_ROTATIONS) {
      const proj = createIsoProjection(r);
      for (const [e, n] of [
        [0, 0],
        [123.4, -56.7],
        [-800, 640],
      ]) {
        const [x, y] = proj.project(e!, n!, 0);
        const [e2, n2] = proj.groundAt(x, y);
        expect(e2).toBeCloseTo(e!, 9);
        expect(n2).toBeCloseTo(n!, 9);
        const [a, b] = proj.viewFrame(e!, n!);
        const [e3, n3] = proj.fromViewFrame(a, b);
        expect(e3).toBeCloseTo(e!, 9);
        expect(n3).toBeCloseTo(n!, 9);
      }
    }
  });

  it('depth increases away from the viewer along a screen ray', () => {
    const proj = createIsoProjection(1);
    const v = proj.towardViewer;
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    const p: [number, number, number] = [10, 20, 5];
    const q: [number, number, number] = [p[0] + v[0] * 7, p[1] + v[1] * 7, p[2] + v[2] * 7];
    // Same pixel …
    const [px, py] = proj.project(...p);
    const [qx, qy] = proj.project(...q);
    expect(qx).toBeCloseTo(px, 9);
    expect(qy).toBeCloseTo(py, 9);
    // … but q is nearer.
    expect(proj.depth(...q)).toBeLessThan(proj.depth(...p));
    // A roof faces the viewer; a wall facing the top of the screen does not.
    expect(v[2]).toBeGreaterThan(0);
  });

  it('screen transform round-trips', () => {
    const t = { k: 2.5, tx: 100, ty: -40 };
    const [sx, sy] = toScreen(t, [12, -7]);
    expect(fromScreen(t, sx, sy)).toEqual([12, -7]);
  });
});

describe('scale conversion with MapLibre zoom (§8.1 mode switches)', () => {
  it('round-trips and matches the Web-Mercator scale', () => {
    const lat = 31.2533;
    const k = pxPerMetreForZoom(15.4, lat);
    // 78271.517 m/px at z0 (512 px tiles) × cos(lat) / 2^15.4
    expect(1 / k).toBeCloseTo((78271.517 * Math.cos(lat * DEG)) / 2 ** 15.4, 3);
    expect(zoomForPxPerMetre(k, lat)).toBeCloseTo(15.4, 9);
  });
});

describe('default rotation (§6.3)', () => {
  it('picks the rotation whose extent matches the viewport aspect', () => {
    // A 1,000 × 600 m block whose long axis runs south-west → north-east.
    const u = [Math.SQRT1_2, Math.SQRT1_2];
    const v = [-Math.SQRT1_2, Math.SQRT1_2];
    const block = [
      [-500, -300],
      [500, -300],
      [500, 300],
      [-500, 300],
    ].map(([s, t]) => [s! * u[0]! + t! * v[0]!, s! * u[1]! + t! * v[1]!] as [number, number]);
    // Tall viewport: NE at the top (r = 0, extent 600 × 500). Very wide: the long axis across (r = 1, 1,000 × 300).
    // r and r + 2 have the same extent; the lower r wins, so the choice is deterministic.
    expect(defaultRotation(block, 390 / 844)).toBe(0);
    expect(defaultRotation(block, 3)).toBe(1);
    expect(defaultRotation([], 1)).toBe(0);
  });
});
