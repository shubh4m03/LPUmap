/**
 * Place → graph connectors: the nearest foot-accessible graph node within
 * maxPlaceConnectorM. Buildings measure from their footprint outline (a node
 * on or inside the footprint is 0 m away), everything else from its point.
 * Places beyond the limit stay unconnected — never routed via a guess.
 */
import type { GraphFile, LngLat } from '../../src/data/schema.ts';
import { createLocalProjection, haversineM } from '../../src/distance/geodesic.ts';
import type { PlaceRecord } from './build-places.ts';
import { distanceToMultiPolygonM, round } from './geometry.ts';

interface Grid {
  cellM: number;
  cells: Map<string, number[]>;
  toXY(p: LngLat): [number, number];
}

function buildGrid(nodes: readonly LngLat[], ids: readonly number[], cellM: number): Grid {
  const proj = createLocalProjection(nodes[ids[0] ?? 0] ?? [0, 0]);
  const cells = new Map<string, number[]>();
  for (const id of ids) {
    const [x, y] = proj.toXY(nodes[id]!);
    const key = `${Math.floor(x / cellM)}:${Math.floor(y / cellM)}`;
    const cell = cells.get(key);
    if (cell) cell.push(id);
    else cells.set(key, [id]);
  }
  return { cellM, cells, toXY: proj.toXY };
}

function candidatesInBox(grid: Grid, min: [number, number], max: [number, number]): number[] {
  const out: number[] = [];
  for (let cx = Math.floor(min[0] / grid.cellM); cx <= Math.floor(max[0] / grid.cellM); cx++) {
    for (let cy = Math.floor(min[1] / grid.cellM); cy <= Math.floor(max[1] / grid.cellM); cy++) {
      const cell = grid.cells.get(`${cx}:${cy}`);
      if (cell) out.push(...cell);
    }
  }
  return out;
}

/** Ids of nodes incident to at least one foot-accessible edge, ascending. */
export function footNodeIds(graph: GraphFile): number[] {
  const set = new Set<number>();
  for (const e of graph.edges) {
    if (!e.foot) continue;
    set.add(e.from);
    set.add(e.to);
  }
  return [...set].sort((a, b) => a - b);
}

/** Mutates places in-place; returns ids of located places left unconnected. */
export function attachConnectors(records: PlaceRecord[], graph: GraphFile, maxM: number): string[] {
  const ids = footNodeIds(graph);
  const unconnected: string[] = [];
  if (ids.length === 0) {
    for (const r of records) if (r.place.location) unconnected.push(r.place.id);
    return unconnected;
  }
  const grid = buildGrid(graph.nodes, ids, maxM);
  for (const rec of records) {
    const { place } = rec;
    if (!place.location) continue;
    const outline = place.kind === 'building' ? rec.multiPolygon : undefined;
    const pts = outline ? outline.flat(2) : [place.location];
    let min: [number, number] = [Infinity, Infinity];
    let max: [number, number] = [-Infinity, -Infinity];
    for (const p of pts) {
      const [x, y] = grid.toXY(p);
      min = [Math.min(min[0], x - maxM), Math.min(min[1], y - maxM)];
      max = [Math.max(max[0], x + maxM), Math.max(max[1], y + maxM)];
    }
    let best: { id: number; d: number } | null = null;
    for (const id of candidatesInBox(grid, min, max)) {
      const node = graph.nodes[id]!;
      const d = outline ? distanceToMultiPolygonM(node, outline) : haversineM(place.location, node);
      if (d <= maxM && (!best || d < best.d || (d === best.d && id < best.id))) best = { id, d };
    }
    if (best) {
      place.graphNodeId = best.id;
      place.connectorLengthM = round(best.d, 2);
    } else {
      unconnected.push(place.id);
    }
  }
  return unconnected;
}
