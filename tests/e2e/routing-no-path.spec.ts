/**
 * G-24 — a start on a separate, unconnected part of the mapped path network:
 * the app explains that no route exists and draws nothing.
 *
 * The shipped dataset has only a handful of uniquely named, routable places
 * and they all share one network component, so the start is "My location"
 * (deterministic fake fixes, fixtures/fake-geolocation.ts) placed exactly on
 * a node of another component. Both are chosen at run time from the shipped
 * graph, and the app's own router (run here in Node) confirms the failure:
 * the router never bridges components, so it is real.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GraphFile, LngLat } from '../../src/data/schema.ts';
import { haversineM } from '../../src/distance/geodesic.ts';
import { createRouter } from '../../src/routing/index.ts';
import { endpointOf, ROUTE_PAIR } from './fixtures/data.ts';
import { fakeWatchCount, installFakeGeolocation, pushFix } from './fixtures/fake-geolocation.ts';
import { expect, test } from './fixtures/test.ts';

const GRAPH = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../public/data/graph.json', import.meta.url)), 'utf8'),
) as GraphFile;
const destination = ROUTE_PAIR.to;

/** Connected-component label of every node over walkable campus edges. */
function components(): Int32Array {
  const n = GRAPH.nodes.length;
  const label = new Int32Array(n).fill(-1);
  const adjacent: number[][] = Array.from({ length: n }, () => []);
  for (const e of GRAPH.edges) {
    if (!e.foot) continue;
    adjacent[e.from]!.push(e.to);
    adjacent[e.to]!.push(e.from);
  }
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || adjacent[s]!.length === 0) continue;
    const stack = [s];
    label[s] = next;
    while (stack.length > 0) {
      for (const v of adjacent[stack.pop()!]!) {
        if (label[v] === -1) {
          label[v] = next;
          stack.push(v);
        }
      }
    }
    next++;
  }
  return label;
}

/** The lowest-id walkable campus node outside the destination's component, with no other node within 1 m. */
function disconnectedStart(): { location: LngLat; message: string } {
  const label = components();
  const home = label[destination.graphNodeId]!;
  const campusNode = new Set<number>();
  for (const e of GRAPH.edges) {
    if (!e.foot || (e as { campus?: boolean }).campus === false) continue;
    campusNode.add(e.from);
    campusNode.add(e.to);
  }
  const router = createRouter(GRAPH);
  for (let id = 0; id < GRAPH.nodes.length; id++) {
    if (label[id] === -1 || label[id] === home || !campusNode.has(id)) continue;
    const location = GRAPH.nodes[id]!;
    if (GRAPH.nodes.some((q, j) => j !== id && haversineM(q, location) < 1)) continue;
    const r = router.route({
      from: { kind: 'point', label: 'My location', location },
      to: endpointOf(destination),
      profile: 'walk',
    });
    if (!r.ok && r.reason === 'no-path') return { location, message: r.message };
  }
  throw new Error('No walkable campus node lies outside the destination component; this spec needs one.');
}

test.describe('G-24 · no route from a separate part of the path network', () => {
  test('explains that the points are on unconnected parts of the map and draws no route', async ({
    atlas,
    page,
  }) => {
    const start = disconnectedStart();
    expect(start.message).toContain('separate, unconnected parts of the map');
    await installFakeGeolocation(page);
    await atlas.open({ place: destination.id });
    await atlas.placeArticle(destination.name).getByRole('button', { name: 'Directions to here' }).click();
    const directions = atlas.panel('Directions');
    await expect(directions.getByRole('region', { name: 'Destination' })).toContainText(
      destination.displayName,
    );

    await directions.getByRole('button', { name: 'My location' }).click();
    await expect.poll(() => fakeWatchCount(page)).toBe(1);
    await pushFix(page, Math.ceil((Date.now() + 10_000) / 1000) * 1000, start.location, 5);
    await expect(directions.getByRole('region', { name: 'Start' })).toContainText('My location');

    await expect(directions.getByRole('alert')).toContainText(start.message);
    await expect(directions.getByTestId('route-summary')).toHaveCount(0);
    await expect.poll(() => atlas.routeCoordinateCount()).toBe(0);
    // Nothing to navigate: no straight line is offered instead.
    await expect(directions.getByRole('button', { name: 'Start navigation' })).toHaveCount(0);
    // "My location" is one-shot: the watch is released once the start is filled.
    await expect.poll(() => fakeWatchCount(page)).toBe(0);
    await atlas.screenshot('no path');
  });
});
