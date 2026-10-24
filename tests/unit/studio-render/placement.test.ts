import { describe, expect, it } from 'vitest';
import { createEnuFrame } from '../../../src/building-studio/footprint.ts';
import {
  determinant4,
  frontFaceWinding,
  instanceMatrix,
  lightDirectionEnu,
  lngLatFromMercator,
  localToLngLat,
  mercatorFromLngLat,
  metreInMercatorUnits,
  modelMatrix,
  multiplyMat4,
  transformPoint,
} from '../../../src/building-studio/render/maplibre/placement.ts';
import { haversineM as haversineDistance } from '../../../src/distance/geodesic.ts';
import type { LngLat } from '../../../src/data/schema.ts';

const ORIGIN: LngLat = [75.7032, 31.2533]; // APP_CONFIG.map.center

// --- small column-major camera helpers (gl-matrix formulas) ---
function perspective(fovyRad: number, aspect: number, near: number, far: number): Float64Array {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
function lookAt(eye: number[], center: number[], up: number[]): Float64Array {
  const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return [v[0]! / l, v[1]! / l, v[2]! / l];
  };
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return Float64Array.from([
    x[0]!,
    y[0]!,
    z[0]!,
    0,
    x[1]!,
    y[1]!,
    z[1]!,
    0,
    x[2]!,
    y[2]!,
    z[2]!,
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}
const scaleMat = (sx: number, sy: number, sz: number) =>
  Float64Array.from([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);

/** GL's front-face rule for one triangle under matrix m and the winding the layer would set. */
function isFront(m: Float64Array, tri: Array<[number, number, number]>): boolean {
  const ndc = tri.map((p) => {
    const c = transformPoint(m, p);
    return [c[0]! / c[3]!, c[1]! / c[3]!];
  });
  const [a, b, c] = ndc as [number[], number[], number[]];
  const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  return frontFaceWinding(m) === 'ccw' ? area > 0 : area < 0;
}

describe('mercator conversion', () => {
  it('matches MapLibre MercatorCoordinate at known points and round-trips', () => {
    expect(mercatorFromLngLat([0, 0])).toEqual({ x: 0.5, y: 0.5, z: 0 });
    expect(mercatorFromLngLat([-180, 0]).x).toBe(0);
    const m = mercatorFromLngLat(ORIGIN, 10);
    const back = lngLatFromMercator(m);
    expect(back[0]).toBeCloseTo(ORIGIN[0], 10);
    expect(back[1]).toBeCloseTo(ORIGIN[1], 10);
    // One metre at the equator is 1 / circumference; at 60° N it is twice that.
    expect(metreInMercatorUnits(60) / metreInMercatorUnits(0)).toBeCloseTo(2, 10);
    expect(m.z).toBeCloseTo(10 * metreInMercatorUnits(ORIGIN[1]), 15);
  });
});

describe('model placement: a known anchor + offset lands at the expected lon/lat', () => {
  it.each([
    [100, 0],
    [0, 100],
    [-250, 120],
    [0, 300],
    [300, 0],
    [212, -212],
  ])('offset (%d m E, %d m N) agrees with the ENU footprint frame within 1 cm', (e, n) => {
    const got = localToLngLat(ORIGIN, [e, n]);
    const expected = createEnuFrame(ORIGIN).toLngLat([e, n]);
    expect(haversineDistance(got, expected)).toBeLessThan(0.01);
    // And it is the right distance from the origin (true metres, not pixels).
    expect(Math.abs(haversineDistance(ORIGIN, got) - Math.hypot(e, n))).toBeLessThan(0.01);
  });

  it('maps east to +x, north to −y (mercator grows south) and up to +z', () => {
    const m = modelMatrix(ORIGIN);
    const o = mercatorFromLngLat(ORIGIN);
    const s = metreInMercatorUnits(ORIGIN[1]);
    expect(transformPoint(m, [1, 0, 0])).toEqual([o.x + s, o.y, 0, 1]);
    expect(transformPoint(m, [0, 1, 0])).toEqual([o.x, o.y - s, 0, 1]);
    expect(transformPoint(m, [0, 0, 1])).toEqual([o.x, o.y, s, 1]);
    expect(determinant4(m)).toBeLessThan(0); // the y flip mirrors the frame
  });

  it('instanceMatrix = mainMatrix × model matrix, cast to float32', () => {
    const main = scaleMat(2, 3, 4);
    const got = instanceMatrix(main, ORIGIN);
    expect(got).toBeInstanceOf(Float32Array);
    expect(Array.from(got)).toEqual(Array.from(Float32Array.from(multiplyMat4(main, modelMatrix(ORIGIN)))));
  });

  it('keeps sub-pixel precision 300 m from the origin at zoom 19, where float32 mercator vertices would not', () => {
    const worldSize = 512 * 2 ** 19;
    const c = mercatorFromLngLat(ORIGIN);
    const eye = [c.x * worldSize, c.y * worldSize + 600, 800];
    const view = lookAt(eye, [c.x * worldSize, c.y * worldSize, 0], [0, -1, 0]);
    const main = multiplyMat4(
      multiplyMat4(perspective(0.6435, 1, 1, 1e5), view),
      scaleMat(worldSize, worldSize, worldSize),
    );
    const viewportPx = 1000;
    const toPx = (clip: number[]) => [
      ((clip[0]! / clip[3]!) * viewportPx) / 2,
      ((clip[1]! / clip[3]!) * viewportPx) / 2,
    ];
    const f32mul = (m: Float32Array, p: number[]) => {
      const f = Math.fround;
      const out = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++)
        out[r] = f(
          f(f(f(m[r]! * f(p[0]!)) + f(m[4 + r]! * f(p[1]!))) + f(m[8 + r]! * f(p[2]!))) + m[12 + r]!,
        );
      return out;
    };
    const local = [210, 212, 12];
    const exact = toPx(
      transformPoint(multiplyMat4(main, modelMatrix(ORIGIN)), local as [number, number, number]),
    );
    const ours = toPx(f32mul(instanceMatrix(main, ORIGIN), local));
    expect(Math.hypot(ours[0]! - exact[0]!, ours[1]! - exact[1]!)).toBeLessThan(0.05);
    // The naive alternative: mercator vertices in float32 with a float32 projection matrix.
    const w = transformPoint(modelMatrix(ORIGIN), local as [number, number, number]);
    const naive = toPx(f32mul(Float32Array.from(main), w));
    expect(Math.hypot(naive[0]! - exact[0]!, naive[1]! - exact[1]!)).toBeGreaterThan(1);
  });
});

describe('front-face winding from the live matrix', () => {
  // A 10 × 10 × 10 m box at the origin: faces counter-clockwise seen from outside (mesh contract).
  const roof: Array<[number, number, number]> = [
    [-5, -5, 10],
    [5, -5, 10],
    [5, 5, 10],
  ];
  const southWall: Array<[number, number, number]> = [
    [-5, -5, 0],
    [5, -5, 0],
    [5, -5, 10],
  ];
  const northWall: Array<[number, number, number]> = [
    [5, 5, 0],
    [-5, 5, 0],
    [-5, 5, 10],
  ];
  const camera = multiplyMat4(perspective(0.6435, 1.5, 1, 1e4), lookAt([0, -60, 80], [0, 0, 0], [0, 0, 1]));

  it('keeps faces towards the camera and culls faces away from it (standard GL camera)', () => {
    expect(determinant4(camera)).toBeLessThan(0); // a GL perspective flips z
    expect(frontFaceWinding(camera)).toBe('ccw');
    expect(isFront(camera, roof)).toBe(true);
    expect(isFront(camera, southWall)).toBe(true);
    expect(isFront(camera, northWall)).toBe(false);
  });

  it('still classifies them correctly through a mirrored (mercator-like, y-flipped) world', () => {
    // World y is flipped (as in mercator); the camera lives in that mirrored world.
    const mirror = scaleMat(1, -1, 1);
    const mirroredCamera = multiplyMat4(
      perspective(0.6435, 1.5, 1, 1e4),
      lookAt([0, 60, 80], [0, 0, 0], [0, 0, 1]),
    );
    const m = multiplyMat4(mirroredCamera, mirror);
    expect(determinant4(m)).toBeGreaterThan(0);
    expect(frontFaceWinding(m)).toBe('cw');
    expect(isFront(m, roof)).toBe(true);
    expect(isFront(m, southWall)).toBe(true);
    expect(isFront(m, northWall)).toBe(false);
  });
});

describe('lightDirectionEnu', () => {
  it('points towards the azimuth (MapLibre lights south and west faces at 210°) scaled by r', () => {
    const [x, y, z] = lightDirectionEnu([1.15, 210, 35]);
    const sinP = Math.sin((35 * Math.PI) / 180);
    expect(x).toBeCloseTo(1.15 * -0.5 * sinP, 10);
    expect(y).toBeCloseTo(1.15 * -Math.cos(Math.PI / 6) * sinP, 10);
    expect(z).toBeCloseTo(1.15 * Math.cos((35 * Math.PI) / 180), 10);
    const lit = (n: [number, number, number]) => n[0] * x + n[1] * y + n[2] * z;
    expect(lit([0, -1, 0])).toBeGreaterThan(0); // south
    expect(lit([-1, 0, 0])).toBeGreaterThan(0); // west
    expect(lit([0, 1, 0])).toBeLessThan(0); // north
    expect(lit([1, 0, 0])).toBeLessThan(0); // east
  });
});
