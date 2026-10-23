/** Tiny builder for synthetic in-memory OSM data used by the pipeline unit tests. */
import { emptyOsmData } from '../../../scripts/lib/osm-parse.ts';
import type { OsmData, OsmMember, Tags } from '../../../scripts/lib/osm-parse.ts';

export interface SyntheticOsm {
  nodes?: Record<number, [number, number] | [number, number, Tags]>;
  ways?: Array<[number, number[], Tags?]>;
  relations?: Array<[number, Array<[OsmMember['type'], number, string]>, Tags]>;
}

export function syntheticOsm(spec: SyntheticOsm): OsmData {
  const data = emptyOsmData();
  for (const [id, [lon, lat, tags]] of Object.entries(spec.nodes ?? {})) {
    data.nodes.set(Number(id), { type: 'node', id: Number(id), lon, lat, tags: tags ?? {} });
  }
  for (const [id, nodes, tags] of spec.ways ?? [])
    data.ways.set(id, { type: 'way', id, nodes, tags: tags ?? {} });
  for (const [id, members, tags] of spec.relations ?? []) {
    data.relations.set(id, {
      type: 'relation',
      id,
      members: members.map(([type, ref, role]) => ({ type, ref, role })),
      tags,
    });
  }
  return data;
}

/** A 0.001° square (≈ 95 m × 111 m) with its SW corner at (lon, lat), node ids start..start+3. */
export function squareNodes(start: number, lon: number, lat: number, size = 0.001): SyntheticOsm['nodes'] {
  return {
    [start]: [lon, lat],
    [start + 1]: [lon + size, lat],
    [start + 2]: [lon + size, lat + size],
    [start + 3]: [lon, lat + size],
  };
}

export const ring = (start: number) => [start, start + 1, start + 2, start + 3, start];
