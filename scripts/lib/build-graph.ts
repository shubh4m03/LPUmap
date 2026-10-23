/**
 * Walking/cycling graph: one edge per consecutive OSM node pair of every
 * routable way. Ways connect only where they share an OSM node; the builder
 * never adds connections between components. Nodes are renumbered densely in
 * ascending OSM node-id order so output is deterministic.
 */
import type { GraphEdge, GraphFile, LngLat } from '../../src/data/schema.ts';
import { DATA_SCHEMA_VERSION } from '../../src/data/schema.ts';
import { haversineM } from '../../src/distance/geodesic.ts';
import { edgeWheelchair, isIndoor, wayAccess, wayDirection } from './access.ts';
import { inBBox, round, samePoint } from './geometry.ts';
import { nodeCoord } from './osm-geometry.ts';
import { sortedValues } from './osm-parse.ts';
import type { OsmData } from './osm-parse.ts';
import { nameFromTags } from './place-fields.ts';

export interface GraphStats {
  routableWays: number;
  duplicateEdgesDropped: number;
  zeroLengthSegmentsMerged: number;
  segmentsOutsideBounds: number;
  segmentsWithMissingNodes: number;
  directionConflicts: number;
}

export interface GraphBuildResult {
  graph: GraphFile;
  /** Graph node index → OSM node id. */
  osmNodeIds: number[];
  /** Component sizes (node counts), largest first. */
  componentSizes: number[];
  /** Graph node index → component index (0 = largest). */
  componentOf: number[];
  stats: GraphStats;
}

class UnionFind {
  parent = new Map<number, number>();
  find(x: number): number {
    let root = x;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Smaller id becomes the representative: deterministic.
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

interface RawSegment {
  a: number;
  b: number;
  wayId: number;
  attrs: Omit<GraphEdge, 'id' | 'from' | 'to' | 'lengthM'>;
}

export function buildGraph(
  osm: OsmData,
  maxBounds: readonly [number, number, number, number],
): GraphBuildResult {
  const stats: GraphStats = {
    routableWays: 0,
    duplicateEdgesDropped: 0,
    zeroLengthSegmentsMerged: 0,
    segmentsOutsideBounds: 0,
    segmentsWithMissingNodes: 0,
    directionConflicts: 0,
  };
  const coords = new Map<number, LngLat>();
  const merge = new UnionFind();
  const segments: RawSegment[] = [];

  for (const way of sortedValues(osm.ways)) {
    const access = wayAccess(way.tags);
    if (!access) continue;
    const dir = wayDirection(way.tags);
    let bicycle = access.bicycle;
    if (dir.conflict) {
      stats.directionConflicts++;
      bicycle = 'no'; // contradictory oneway tagging: do not offer cycling
    }
    if (!access.foot && bicycle === 'no') continue;
    stats.routableWays++;
    const attrs: RawSegment['attrs'] = {
      highway: way.tags.highway!,
      foot: access.foot,
      bicycle,
      steps: way.tags.highway === 'steps',
      wheelchair: edgeWheelchair(way.tags),
      onewayBicycle: dir.onewayBicycle,
      onewayFoot: dir.onewayFoot,
      indoor: isIndoor(way.tags),
      surface: way.tags.surface?.trim() || null,
      name: nameFromTags(way.tags),
      source: 'osm',
      osmWayId: way.id,
    };
    const ids = dir.reverse ? [...way.nodes].reverse() : way.nodes;
    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i]!;
      const b = ids[i + 1]!;
      if (a === b) continue;
      const ca = nodeCoord(osm, a);
      const cb = nodeCoord(osm, b);
      if (!ca || !cb) {
        stats.segmentsWithMissingNodes++;
        continue;
      }
      if (!inBBox(ca, maxBounds) || !inBBox(cb, maxBounds)) {
        stats.segmentsOutsideBounds++;
        continue;
      }
      coords.set(a, ca);
      coords.set(b, cb);
      if (samePoint(ca, cb)) {
        // Two OSM nodes at the same (rounded) position joined by a way: one graph node.
        merge.union(a, b);
        stats.zeroLengthSegmentsMerged++;
        continue;
      }
      segments.push({ a, b, wayId: way.id, attrs });
    }
  }

  const seen = new Set<string>();
  const kept: Array<{ a: number; b: number; attrs: RawSegment['attrs'] }> = [];
  for (const s of segments) {
    const a = merge.find(s.a);
    const b = merge.find(s.b);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) {
      stats.duplicateEdgesDropped++;
      continue;
    }
    seen.add(key);
    kept.push({ a, b, attrs: s.attrs });
  }

  const osmNodeIds = [...new Set(kept.flatMap((e) => [e.a, e.b]))].sort((x, y) => x - y);
  const index = new Map(osmNodeIds.map((id, i) => [id, i]));
  const nodes: LngLat[] = osmNodeIds.map((id) => coords.get(id)!);
  const edges: GraphEdge[] = kept.map((e, id) => {
    const from = index.get(e.a)!;
    const to = index.get(e.b)!;
    return { id, from, to, lengthM: round(haversineM(nodes[from]!, nodes[to]!), 3), ...e.attrs };
  });

  const { componentSizes, componentOf } = connectedComponents(nodes.length, edges);
  return {
    graph: { schemaVersion: DATA_SCHEMA_VERSION, nodes, edges },
    osmNodeIds,
    componentSizes,
    componentOf,
    stats,
  };
}

/** Undirected connected components; index 0 is the largest (ties: lowest node index). */
export function connectedComponents(
  nodeCount: number,
  edges: ReadonlyArray<Pick<GraphEdge, 'from' | 'to'>>,
): { componentSizes: number[]; componentOf: number[] } {
  const uf = new UnionFind();
  for (const e of edges) uf.union(e.from, e.to);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < nodeCount; i++) {
    const r = uf.find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const ordered = [...groups.values()].sort((p, q) => q.length - p.length || p[0]! - q[0]!);
  const componentOf = new Array<number>(nodeCount).fill(0);
  ordered.forEach((members, ci) => members.forEach((n) => (componentOf[n] = ci)));
  return { componentSizes: ordered.map((g) => g.length), componentOf };
}
