/**
 * Regenerates the synthetic-*.json routing fixtures in this folder.
 * Run: node tests/fixtures/graphs/generate-synthetic.ts
 *
 * Geometry is invented (metre offsets around the configured map centre) and
 * names are deliberately fake ("Synthetic Avenue"); see README.md.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_SCHEMA_VERSION,
  type GraphEdge,
  type GraphFile,
  type LngLat,
} from '../../../src/data/schema.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { createLocalProjection, haversineM } from '../../../src/distance/geodesic.ts';

const projection = createLocalProjection(APP_CONFIG.map.center);
// Full precision on purpose: rounding would break the exact symmetry the diamond tie test relies on.
const at = (x: number, y: number): LngLat => projection.toLngLat([x, y]);

type EdgeSpec = [from: number, to: number, overrides?: Partial<GraphEdge>];

function graph(xy: Array<[number, number]>, specs: EdgeSpec[]): GraphFile {
  const nodes = xy.map(([x, y]) => at(x, y));
  const edges = specs.map(([from, to, o], id): GraphEdge => {
    const lengthM = Math.max(0.01, Math.round(haversineM(nodes[from]!, nodes[to]!) * 100) / 100);
    return {
      id,
      from,
      to,
      lengthM,
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
    };
  });
  return { schemaVersion: DATA_SCHEMA_VERSION, nodes, edges };
}

const road = { highway: 'residential', bicycle: 'ride' } as const;

const fixtures: Record<string, GraphFile> = {
  // Two mirror-image paths of equal length from node 0 to node 3.
  'synthetic-diamond.json': graph(
    [
      [0, 0],
      [-40, 50],
      [40, 50],
      [0, 100],
    ],
    [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ],
  ),
  // Two components 300 m apart; nodes 1 and 4 share a coordinate but no edge joins them.
  'synthetic-disconnected.json': graph(
    [
      [0, 0],
      [100, 0],
      [0, 300],
      [100, 300],
      [100, 0],
      [200, 0],
    ],
    [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
  ),
  'synthetic-campus.json': graph(
    [
      [0, 0], // 0
      [100, 0], // 1
      [200, 0], // 2
      [300, 0], // 3
      [0, 80], // 4
      [300, 80], // 5
      [150, -60], // 6
      [150, -120], // 7
      [150, -260], // 8
      [250, -260], // 9
    ],
    [
      // Synthetic Avenue: vehicle/bicycle one-way eastbound; walking both ways.
      [0, 1, { ...road, name: 'Synthetic Avenue', onewayBicycle: true }],
      [1, 2, { ...road, name: 'Synthetic Avenue', onewayBicycle: true }],
      [2, 3, { ...road, name: 'Synthetic Avenue', onewayBicycle: true }],
      // Unnamed northern footway loop where bicycles must be pushed.
      [0, 4],
      [4, 5],
      [5, 3],
      // Steps shortcut south (no bicycles), then a footway to node 7.
      [1, 6, { highway: 'steps', steps: true, bicycle: 'no' }],
      [6, 7, { name: 'Test Walk', wheelchair: 'yes' }],
      // Step-free ramp from node 2.
      [2, 7, { highway: 'footway', name: 'Test Ramp', wheelchair: 'yes' }],
      // Long steps down to an otherwise isolated southern footway.
      [7, 8, { highway: 'steps', steps: true, bicycle: 'push' }],
      [8, 9, { name: 'South Test Path' }],
      // Cycle-only link (walking prohibited).
      [0, 7, { highway: 'cycleway', foot: false, bicycle: 'ride', name: 'Test Cycleway' }],
    ],
  ),
};

const dir = dirname(fileURLToPath(import.meta.url));
for (const [name, data] of Object.entries(fixtures)) {
  writeFileSync(join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
}
