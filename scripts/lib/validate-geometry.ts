/** Geometry and graph invariants used by the dataset validator. */
import { APP_CONFIG } from '../../src/config/index.ts';
import type { GraphFile, LngLat } from '../../src/data/schema.ts';
import { haversineM, isValidLngLat } from '../../src/distance/geodesic.ts';
import { inBBox, ringProblems } from './geometry.ts';
import type { MultiPolygon, Polygon } from './geometry.ts';

export interface IssueSink {
  error(code: string, message: string): void;
  warn(code: string, message: string): void;
}

/** Tolerance between stored edge length and recomputed haversine length. */
export const LENGTH_TOLERANCE = 0.01;
/**
 * lengthM is stored to 1 mm, so centimetre-scale edges (7-dp coordinates are ≈ 1 cm apart) can
 * legitimately differ by more than 1 %; never flag a difference within that rounding.
 */
export const LENGTH_ROUNDING_M = 0.0005;

function asPolygon(raw: unknown): Polygon | null {
  if (!Array.isArray(raw)) return null;
  const rings: LngLat[][] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring) || !ring.every((p) => isValidLngLat(p))) return null;
    rings.push(ring as LngLat[]);
  }
  return rings.length > 0 ? rings : null;
}

export function toMultiPolygon(geometry: { type: string; coordinates: unknown }): MultiPolygon | null {
  if (geometry.type === 'Polygon') {
    const poly = asPolygon(geometry.coordinates);
    return poly ? [poly] : null;
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    const polys = geometry.coordinates.map(asPolygon);
    return polys.length > 0 && polys.every((p) => p !== null) ? (polys as MultiPolygon) : null;
  }
  return null;
}

export function checkMultiPolygon(id: string, mp: MultiPolygon, sink: IssueSink): void {
  mp.forEach((poly, pi) =>
    poly.forEach((ring, ri) => {
      const problems = ringProblems(ring);
      if (problems.length > 0) sink.error('ring', `${id} polygon ${pi} ring ${ri}: ${problems.join(', ')}`);
    }),
  );
}

export function checkGraph(graph: GraphFile, sink: IssueSink): void {
  const n = graph.nodes.length;
  graph.nodes.forEach((p, i) => {
    if (!inBBox(p, APP_CONFIG.map.maxBounds))
      sink.error('graph-bounds', `graph node ${i} lies outside maxBounds`);
  });
  const degree = new Array<number>(n).fill(0);
  const pairs = new Set<string>();
  graph.edges.forEach((e, i) => {
    if (e.id !== i) sink.error('graph-edge-id', `edge at index ${i} has id ${e.id} (ids must be dense)`);
    const a = graph.nodes[e.from];
    const b = graph.nodes[e.to];
    if (!a || !b) {
      sink.error('graph-endpoint', `edge ${e.id} references a missing node (${e.from} → ${e.to})`);
      return;
    }
    if (e.from === e.to) sink.error('graph-loop', `edge ${e.id} is a self-loop`);
    degree[e.from]!++;
    degree[e.to]!++;
    const key = e.from < e.to ? `${e.from}:${e.to}` : `${e.to}:${e.from}`;
    if (pairs.has(key)) sink.error('graph-duplicate', `edge ${e.id} duplicates another edge between ${key}`);
    pairs.add(key);
    const actual = haversineM(a, b);
    if (!(e.lengthM > 0) || !(actual > 0))
      sink.error('graph-length', `edge ${e.id} has zero or negative length`);
    else if (Math.abs(e.lengthM - actual) > Math.max(LENGTH_TOLERANCE * actual, LENGTH_ROUNDING_M)) {
      sink.error(
        'graph-length',
        `edge ${e.id} lengthM ${e.lengthM} differs from haversine ${actual.toFixed(3)} by > 1%`,
      );
    }
    if (e.bicycle === 'push' && !e.foot)
      sink.error('graph-access', `edge ${e.id} requires pushing a bike where walking is not allowed`);
    if (!e.foot && e.bicycle === 'no') sink.error('graph-access', `edge ${e.id} is usable by no profile`);
  });
  const isolated = degree.filter((d) => d === 0).length;
  if (isolated > 0) sink.error('graph-isolated', `${isolated} graph nodes have no edges`);
}
