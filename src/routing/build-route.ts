/**
 * Turns a found path into the public RouteOk: geometry with connector legs,
 * true distance/duration, steps and caveats.
 *
 * - coordinates = [from.location, snapped start, ...node coords, snapped end,
 *   to.location]. A snapped point is a node or a point inside an edge (the
 *   path's first and last pieces then cover only part of that edge). A
 *   connector leg shorter than MIN_CONNECTOR_DRAW_M is dropped.
 * - distanceM is the haversine polyline length of `coordinates`.
 * - durationS sums each edge's profile time plus connector legs at
 *   connectorSpeedMps (walking, or pushing a bicycle).
 */
import type { LngLat } from '../data/index.ts';
import { haversineM } from '../distance/index.ts';
import type { PathPiece } from './astar.ts';
import { CONNECTOR_CAVEAT_M, MIN_CONNECTOR_DRAW_M } from './constants.ts';
import { nodeCoord, type RoutingGraph } from './graph.ts';
import { connectorSpeedMps, type ProfileTables } from './profiles.ts';
import { buildSteps, genericNoun, isRoadHighway, type RouteLeg } from './steps.ts';
import type { RouteCaveat, RouteEndpoint, RouteOk, RoutePreference, RouteStepKind } from './types.ts';
import type { SnapHit } from './snap.ts';

export interface BuildRouteArgs {
  graph: RoutingGraph;
  tables: ProfileTables;
  preference: RoutePreference;
  from: RouteEndpoint;
  to: RouteEndpoint;
  fromSnap: SnapHit;
  toSnap: SnapHit;
  pieces: readonly PathPiece[];
}

export function polylineLength(coords: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1]!, coords[i]!);
  return total;
}

function edgeKind(args: BuildRouteArgs, arc: number): RouteStepKind {
  const edge = args.graph.edges[args.graph.arcEdge[arc]!]!;
  if (edge.steps === true) return 'steps';
  if (args.tables.profile === 'cycle' && args.tables.arcPush[arc]) return 'push-bike';
  return isRoadHighway(String(edge.highway)) ? 'road' : 'path';
}

export function buildRoute(args: BuildRouteArgs): RouteOk {
  const { graph, tables, from, to, pieces } = args;
  const profile = tables.profile;
  const arcs = pieces.map((p) => p.arc);
  const firstPoint = args.fromSnap.point;
  const lastPoint = args.toSnap.point;
  const startLeg = haversineM(from.location, firstPoint);
  const endLeg = haversineM(lastPoint, to.location);
  const connectorSpeed = connectorSpeedMps(profile);

  const coordinates: LngLat[] = [];
  const legs: RouteLeg[] = [];
  const connectorLeg = (connector: 'start' | 'end', lengthM: number, startIndex: number): RouteLeg => ({
    kind: 'connector',
    name: null,
    noun: 'a straight line',
    connector,
    lengthM,
    durationS: lengthM / connectorSpeed,
    startIndex,
  });

  const drawStart = startLeg >= MIN_CONNECTOR_DRAW_M;
  if (drawStart) {
    coordinates.push([from.location[0], from.location[1]]);
    legs.push(connectorLeg('start', startLeg, 0));
  }
  coordinates.push([firstPoint[0], firstPoint[1]]);
  for (const piece of pieces) {
    const a = piece.arc;
    const edge = graph.edges[graph.arcEdge[a]!]!;
    const startIndex = coordinates.length - 1;
    // A piece stopping short of its arc's target ends at the snapped destination point.
    const end: LngLat =
      piece.end === 1 ? nodeCoord(graph, graph.arcTarget[a]!) : [lastPoint[0], lastPoint[1]];
    const lengthM = haversineM(coordinates[startIndex]!, end);
    coordinates.push(end);
    legs.push({
      kind: edgeKind(args, a),
      name: typeof edge.name === 'string' && edge.name.trim() !== '' ? edge.name : null,
      noun: genericNoun(String(edge.highway), edge.steps === true),
      lengthM,
      durationS:
        piece.start === 0 && piece.end === 1
          ? tables.timeCost[a]!
          : tables.timeCost[a]! * (piece.end - piece.start),
      startIndex,
    });
  }
  const drawEnd = endLeg >= MIN_CONNECTOR_DRAW_M;
  if (drawEnd) {
    legs.push(connectorLeg('end', endLeg, coordinates.length - 1));
    coordinates.push([to.location[0], to.location[1]]);
  }

  const snap = { fromM: drawStart ? startLeg : 0, toM: drawEnd ? endLeg : 0 };
  let durationS = 0;
  for (const leg of legs) durationS += leg.durationS;

  return {
    ok: true,
    profile,
    preference: args.preference,
    coordinates,
    distanceM: polylineLength(coordinates),
    durationS,
    edgeIds: arcs.map((a) => graph.edges[graph.arcEdge[a]!]!.id),
    steps: buildSteps(legs, coordinates, { profile, destinationLabel: endpointLabel(to) }),
    caveats: buildCaveats(args, legs, snap),
    snap,
  };
}

function endpointLabel(ep: RouteEndpoint): string {
  return typeof ep.label === 'string' && ep.label.trim() !== '' ? ep.label.trim() : 'your destination';
}

const round = (m: number) => Math.max(1, Math.round(m));

function buildCaveats(
  args: BuildRouteArgs,
  legs: RouteLeg[],
  snap: { fromM: number; toM: number },
): RouteCaveat[] {
  const { graph, tables } = args;
  const arcs = args.pieces.map((p) => p.arc);
  const profile = tables.profile;
  const caveats: RouteCaveat[] = [];
  const edges = arcs.map((a) => graph.edges[graph.arcEdge[a]!]!);

  const startEstimate = snap.fromM > CONNECTOR_CAVEAT_M;
  const endEstimate = snap.toM > CONNECTOR_CAVEAT_M;
  if (profile === 'step-free') {
    const unverifiedEdge = edges.some((e) => e.wheelchair !== 'yes');
    if (unverifiedEdge || startEstimate || endEstimate || edges.length === 0) {
      caveats.push({
        code: 'accessibility-unverified',
        message:
          'Step-free access along this route is not verified. It avoids mapped steps and paths tagged as not ' +
          'wheelchair-accessible, but kerbs, slopes and surfaces are mostly unmapped here.',
      });
    }
  }
  if (edges.some((e) => e.steps === true)) {
    caveats.push({
      code: 'contains-steps',
      message:
        profile === 'cycle'
          ? 'This route uses steps; you will need to carry your bicycle there.'
          : 'This route uses steps.',
    });
  }
  if (profile === 'cycle') {
    const pushM = legs
      .filter((l) => l.kind === 'push-bike' || l.kind === 'steps')
      .reduce((s, l) => s + l.lengthM, 0);
    if (pushM > 0) {
      caveats.push({
        code: 'push-bike',
        message: `You will need to walk your bicycle for about ${round(pushM)} m where cycling is not allowed.`,
      });
    }
  }
  if (startEstimate) {
    caveats.push({
      code: 'start-connector',
      message: `First ${round(snap.fromM)} m is a straight-line estimate off the mapped paths.`,
    });
  }
  if (endEstimate) {
    caveats.push({
      code: 'end-connector',
      message: `Last ${round(snap.toM)} m is a straight-line estimate off the mapped paths.`,
    });
  }
  if (edges.some((e) => typeof e.name !== 'string' || e.name.trim() === '')) {
    caveats.push({
      code: 'unnamed-paths',
      message:
        'Some paths on this route have no name in the map data, so directions describe them generically.',
    });
  }
  return caveats;
}
