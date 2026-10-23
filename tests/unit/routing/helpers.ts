import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { graphFileSchema, type GraphEdge, type GraphFile, type LngLat } from '../../../src/data/schema.ts';
import { createLocalProjection, haversineM } from '../../../src/distance/geodesic.ts';
import type { RouteEndpoint, RouteOk, RouteResult } from '../../../src/routing/index.ts';

export const projection = createLocalProjection(APP_CONFIG.map.center);

/** Coordinate `x` metres east and `y` metres north of the map centre. */
export const at = (x: number, y: number): LngLat => projection.toLngLat([x, y]);

export const pt = (x: number, y: number, label = 'Point'): RouteEndpoint => ({
  kind: 'point',
  label,
  location: at(x, y),
});

export function loadFixture(name: string): GraphFile {
  // Vitest runs from the repository root; import.meta.url is not a file URL under jsdom.
  const file = resolve(process.cwd(), 'tests/fixtures/graphs', name);
  return graphFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export type EdgeSpec = [from: number, to: number, overrides?: Partial<GraphEdge>];

/** Builds a GraphFile from metre coordinates; edges default to an unnamed two-way footway. */
export function makeGraph(xy: Array<[number, number]>, specs: EdgeSpec[]): GraphFile {
  const nodes = xy.map(([x, y]) => at(x, y));
  const edges = specs.map(([from, to, o], id): GraphEdge => ({
    id,
    from,
    to,
    lengthM: Math.max(0.01, haversineM(nodes[from] ?? [0, 0], nodes[to] ?? [0, 0])),
    highway: 'footway',
    foot: true,
    bicycle: 'push',
    steps: false,
    wheelchair: 'unknown',
    onewayBicycle: false,
    onewayFoot: false,
    indoor: false,
    surface: null,
    name: null,
    source: 'osm',
    osmWayId: null,
    ...o,
  }));
  return { schemaVersion: 1, nodes, edges };
}

/** cols × rows grid with `spacing` metres between neighbours; node id = row * cols + col. */
export function gridGraph(cols: number, rows: number, spacing: number): GraphFile {
  const xy: Array<[number, number]> = [];
  const specs: EdgeSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      xy.push([c * spacing, r * spacing]);
      const id = r * cols + c;
      if (c > 0) specs.push([id - 1, id]);
      if (r > 0) specs.push([id - cols, id]);
    }
  }
  return makeGraph(xy, specs);
}

/** Seeded PRNG (mulberry32) so property tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function polylineLength(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1]!, coords[i]!);
  return total;
}

export function expectOk(r: RouteResult | undefined): RouteOk {
  expect(r, JSON.stringify(r)).toBeDefined();
  if (!r || !r.ok) throw new Error(`expected a route, got ${JSON.stringify(r)}`);
  return r;
}

export function expectFailure(r: RouteResult | undefined, reason: string): void {
  expect(r?.ok).toBe(false);
  if (r && !r.ok) {
    expect(r.reason).toBe(reason);
    expect(r.message.length).toBeGreaterThan(10);
  }
}

export const caveatCodes = (r: RouteOk) => r.caveats.map((c) => c.code);
