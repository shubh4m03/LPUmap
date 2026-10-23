# Module: routing

**Path:** `src/routing/` (pure TypeScript; no React, DOM or MapLibre)

## Purpose

This module computes walking, cycling and step-free routes over the dataset's graph
(`public/data/graph.json`). It returns a polyline, distance, duration, steps and honest caveats, or a
typed failure explaining why no route exists. It never invents a connection.

## Public interface (`src/routing/index.ts`)

```ts
createRouter(graph: GraphFile): Router
interface Router {
  route(req: RouteRequest): RouteResult;              // RouteOk | RouteFailure
  alternatives(req: RouteRequest): RouteResult[];     // best first; failure → [failure]
  snap(p: LngLat, profile: RouteProfileId): { nodeId: number; distanceM: number } | null;
  readonly nodeCount: number;
  readonly edgeCount: number;                         // accepted edges only
}
ROUTE_PROFILES: Record<'walk' | 'cycle' | 'step-free', { id; label; description; speedMps }>
isRouteProfileId(v): v is RouteProfileId
// types: RouteRequest { from, to, profile, preference?: 'shortest' | 'fastest' },
//        RouteEndpoint ({ kind: 'place', placeId, label, location, nodeId? } | { kind: 'point', label, location }),
//        RouteOk { coordinates, distanceM, durationS, edgeIds, steps, caveats, snap: { fromM, toM }, … },
//        RouteFailure { reason, message }, RouteStep, RouteCaveat, …
```

- **Failure reasons:** `invalid-input`, `same-point` (endpoints under 3 m apart),
  `origin-unsnappable` or `destination-unsnappable` (no usable node within `maxSnapDistanceM` = 80 m),
  and `no-path`, with a message specific to the profile.
- **Caveat codes:** `accessibility-unverified`, `contains-steps`, `push-bike`, `start-connector` and
  `end-connector` (a connector leg over 15 m), and `unnamed-paths`.
- **Step kinds:** `path`, `road`, `steps`, `connector`, `push-bike`. Each step has an instruction
  with a turn word (thresholds 20°, 45° and 135°) and the way name, or a generic noun when the way is
  unnamed.

## Algorithm

- **A\*** with a binary-heap priority queue.
- **Edge cost:**
  - Shortest: the haversine length between the edge's node coordinates.
  - Fastest: that length divided by the profile's speed (`APP_CONFIG.routing`: walk 1.3 m/s, cycle
    4.2 m/s, pushing a bike 1.1 m/s), plus a step penalty of 0.8 s/m when walking.
- **Heuristic:**
  - Shortest: haversine to the goal × 0.999.
  - Fastest: the same, divided by the profile's fastest possible speed.

  Both are admissible (they never over-estimate), so A* returns optimal routes. The 0.999 factor
  absorbs floating-point error.

- **Tie-breaking:** by f, then g, then node id. Equal-cost predecessors go to the lower node id, then
  the lower edge id. Identical inputs always give identical routes.
- **Profiles:**
  - `walk` uses foot-accessible edges and respects `onewayFoot`.
  - `cycle` rides where `bicycle: ride` and pushes where `bicycle: push` (shown as a `push-bike` step
    and caveat), and respects vehicle oneways.
  - `step-free` excludes `steps` and `wheelchair: 'no'` edges. It adds `accessibility-unverified`
    whenever a used edge is `unknown` or `limited`, a connector is over 15 m, or the route has no
    network edges.
- **Snapping:** a `place` endpoint uses its `nodeId` if the profile can use that node and it is
  within range. Otherwise the router snaps to the nearest node incident to a usable edge (ties go to
  the lower id). The straight connector legs are part of `coordinates`; legs under 0.5 m are dropped,
  and `snap.fromM` and `snap.toM` are then 0.
- **Alternatives:** up to `maxAlternatives` (2) more routes, found by a cumulative ×1.5 penalty on
  used edges. A candidate is accepted only if its length-weighted overlap with every accepted route is
  below `1 − alternativeMinDifference` (0.7). Reported distances and durations are the true,
  unpenalised values.

## Invariants

- `distanceM === polylineLengthM(coordinates)`: the drawn line and the number agree.
- No edge exists that is not in the graph. Malformed edges (bad ids, self-loops, invalid
  coordinates) are dropped defensively. Nodes at the same coordinate are never merged.
- Disconnected components produce `no-path`, never a straight line.
- Durations come only from the documented `APP_CONFIG.routing` speeds. Connectors are costed at
  walking speed, or pushing speed for the cycle profile.

## Tests

`tests/unit/routing/*` (6 files, 94 tests) on synthetic graphs (`tests/fixtures/graphs/synthetic-*`):

- A* against Dijkstra for optimality, plus heuristic admissibility
- deterministic ties
- each profile's access rules
- step and caveat generation
- alternatives (distinctness, true costs)
- failure reasons
- malformed-graph robustness
- a timing budget: the best of 5 warm runs must be under 150 ms

Measured on the real graph: route p95 is about 0.2 ms; see [PERFORMANCE.md](../PERFORMANCE.md).

## Known limitations

- **Snapping is node-based.** A point beside the middle of a long edge snaps to the nearer end node
  (or is unsnappable beyond 80 m), not to the nearest point on the edge. Projecting onto edges would
  be an improvement.
- **Edge length** is the straight line between the edge's two nodes, so the router depends on the
  pipeline emitting one edge per consecutive OSM node pair, which it does. `GraphEdge.lengthM` is not
  used for cost.
- Consecutive unnamed legs of the same kind are merged and described with the first leg's noun ("the
  footway"), even when the next leg is a "path". The wording can be slightly imprecise; nothing is
  invented.
- Alternative overlap is length-weighted. `APP_CONFIG` describes it as a "share of edges", and the
  length-weighted reading was chosen as the closest faithful one.
- The algorithm constants (3 m same-point, 0.5 m minimum connector, 15 m connector caveat, 0.999
  safety factor, ×1.5 penalty, turn angles) live in `src/routing/constants.ts`, not in `APP_CONFIG`.
- Real-world quality depends on OSM. 9 components, 34 unconnected places, no wheelchair tags and no
  mapped steps on campus limit what any router can do.
