/**
 * createRouter: validates requests, snaps endpoints, runs A* and assembles
 * results. Per-profile tables and snap indexes are built lazily and cached.
 *
 * Endpoints: a `place` with a usable access node (`nodeId`, the pipeline's or
 * an owner-set entrance) within range is routed to that node, as documented
 * data. Everything else — map points, GPS positions, places without a usable
 * node — snaps to the nearest point on an edge the profile may use, which can
 * lie inside the edge (snap.ts, G-28).
 *
 * Fallback: the nearest edge can belong to a piece of network the other end
 * cannot reach (a separate component, or a one-way edge leading away) while
 * the nearest usable node — the rule before G-28 — does connect. When the
 * snapped pair has no path, the router therefore retries, in this fixed
 * order, with the nearest node at the destination, then at the origin, then
 * at both, and reports `no-path` only if all of them fail. It never bridges
 * components.
 */
import type { GraphFile, LngLat } from '../data/index.ts';
import { APP_CONFIG } from '../config/index.ts';
import { haversineM, isValidLngLat } from '../distance/index.ts';
import { findAlternatives } from './alternatives.ts';
import { createWorkspace, findRoute, type PathPiece, type SearchEnd } from './astar.ts';
import { buildRoute } from './build-route.ts';
import { SAME_POINT_M } from './constants.ts';
import { buildGraph, nodeCoord } from './graph.ts';
import {
  buildProfileTables,
  costTable,
  heuristicScale,
  isRoutePreference,
  isRouteProfileId,
  type ProfileTables,
} from './profiles.ts';
import { buildSnapIndex, type SnapHit, type SnapIndex } from './snap.ts';
import type {
  RouteEndpoint,
  RouteFailure,
  RouteFailureReason,
  RoutePreference,
  RouteProfileId,
  RouteRequest,
  RouteResult,
  RouteSnap,
  Router,
} from './types.ts';

const R = APP_CONFIG.routing;

interface Prepared {
  from: RouteEndpoint;
  to: RouteEndpoint;
  profile: RouteProfileId;
  preference: RoutePreference;
  tables: ProfileTables;
  /** The snapped endpoint, then its node-only fallback when that differs. */
  fromSnaps: SnapHit[];
  toSnaps: SnapHit[];
}

const sameHit = (a: SnapHit, b: SnapHit) =>
  a.kind === 'node' ? b.kind === 'node' && a.nodeId === b.nodeId : b.kind === 'edge' && a.edge === b.edge;

const fail = (reason: RouteFailureReason, message: string): RouteFailure => ({ ok: false, reason, message });

function isEndpoint(v: unknown): v is RouteEndpoint {
  if (typeof v !== 'object' || v === null) return false;
  const ep = v as Partial<RouteEndpoint>;
  return (ep.kind === 'place' || ep.kind === 'point') && isValidLngLat(ep.location);
}

const MODE_WORDS: Record<RouteProfileId, string> = {
  walk: 'walking',
  cycle: 'cycling',
  'step-free': 'step-free travel',
};

function noPathMessage(profile: RouteProfileId): string {
  const base = `No connected ${MODE_WORDS[profile]} route links these points in the mapped path network`;
  if (profile === 'step-free') {
    return `${base}. The only mapped connections may use steps or paths marked not wheelchair-accessible, or the points are on separate, unconnected parts of the map.`;
  }
  if (profile === 'cycle') {
    return `${base}. Cycling may be prohibited or one-way on the connecting paths, or the points are on separate, unconnected parts of the map. Try walking instead.`;
  }
  return `${base}. The points are on separate, unconnected parts of the map.`;
}

export function createRouter(file: GraphFile): Router {
  const graph = buildGraph(file);
  const workspace = createWorkspace(graph.nodeCount);
  const tablesCache = new Map<RouteProfileId, ProfileTables>();
  const snapCache = new Map<RouteProfileId, SnapIndex>();

  const tablesFor = (profile: RouteProfileId) => {
    let t = tablesCache.get(profile);
    if (!t) {
      t = buildProfileTables(graph, profile);
      tablesCache.set(profile, t);
    }
    return t;
  };
  const snapIndexFor = (profile: RouteProfileId) => {
    let s = snapCache.get(profile);
    if (!s) {
      s = buildSnapIndex(graph, tablesFor(profile).edgeUsable, R.maxSnapDistanceM);
      snapCache.set(profile, s);
    }
    return s;
  };

  const snap = (p: LngLat, profile: RouteProfileId): SnapHit | null => {
    if (!isValidLngLat(p) || !isRouteProfileId(profile)) return null;
    return snapIndexFor(profile).nearest(p);
  };

  const resolve = (ep: RouteEndpoint, profile: RouteProfileId): SnapHit | null => {
    if (ep.kind === 'place') {
      const id = ep.nodeId;
      const usable = tablesFor(profile).nodeUsable;
      if (typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < graph.nodeCount && usable[id]) {
        const point = nodeCoord(graph, id);
        const d = haversineM(ep.location, point);
        if (d <= R.maxSnapDistanceM) return { kind: 'node', nodeId: id, point, distanceM: d };
      }
    }
    return snap(ep.location, profile);
  };

  /** The resolved endpoint plus, if different, the nearest usable node as a fallback. */
  const candidates = (ep: RouteEndpoint, hit: SnapHit, profile: RouteProfileId): SnapHit[] => {
    if (hit.kind === 'node') return [hit];
    const node = snapIndexFor(profile).nearestNode(ep.location);
    return node && !sameHit(node, hit) ? [hit, node] : [hit];
  };

  const searchEnd = (hit: SnapHit): SearchEnd =>
    hit.kind === 'node'
      ? { kind: 'node', node: hit.nodeId }
      : { kind: 'edge', edge: hit.edge, point: hit.point, fromM: hit.fromM, toM: hit.toM };

  const publicSnap = (hit: SnapHit | null): RouteSnap | null =>
    hit === null
      ? null
      : {
          location: [hit.point[0], hit.point[1]],
          distanceM: hit.distanceM,
          nodeId: hit.kind === 'node' ? hit.nodeId : null,
          edgeId: hit.kind === 'edge' ? graph.edges[hit.edge]!.id : null,
        };

  const prepare = (req: RouteRequest): Prepared | RouteFailure => {
    if (typeof req !== 'object' || req === null) return fail('invalid-input', 'No route request was given.');
    const { from, to, profile } = req;
    const preference = req.preference ?? 'shortest';
    if (!isRouteProfileId(profile)) return fail('invalid-input', 'Unknown travel mode.');
    if (!isRoutePreference(preference)) return fail('invalid-input', 'Unknown route preference.');
    if (!isEndpoint(from)) return fail('invalid-input', 'The starting point has no valid location.');
    if (!isEndpoint(to)) return fail('invalid-input', 'The destination has no valid location.');
    if (haversineM(from.location, to.location) < SAME_POINT_M) {
      return fail('same-point', 'Start and destination are the same place, so there is nothing to route.');
    }
    const fromSnap = resolve(from, profile);
    const mode = MODE_WORDS[profile];
    if (!fromSnap) {
      return fail(
        'origin-unsnappable',
        `The starting point is more than ${R.maxSnapDistanceM} m from any mapped path usable for ${mode}. Choose a start on or near the campus path network.`,
      );
    }
    const toSnap = resolve(to, profile);
    if (!toSnap) {
      return fail(
        'destination-unsnappable',
        `The destination is more than ${R.maxSnapDistanceM} m from any mapped path usable for ${mode}. Choose a destination on or near the campus path network.`,
      );
    }
    return {
      from,
      to,
      profile,
      preference,
      tables: tablesFor(profile),
      fromSnaps: candidates(from, fromSnap, profile),
      toSnaps: candidates(to, toSnap, profile),
    };
  };

  /** Snap pairs to try, best first: as snapped, then node fallbacks at the destination, origin, both. */
  const pairs = (p: Prepared): Array<[SnapHit, SnapHit]> => {
    const out: Array<[SnapHit, SnapHit]> = [];
    for (const f of p.fromSnaps) for (const t of p.toSnaps) out.push([f, t]);
    return out;
  };

  const build = (p: Prepared, fromSnap: SnapHit, toSnap: SnapHit, pieces: readonly PathPiece[]) =>
    buildRoute({
      graph,
      tables: p.tables,
      preference: p.preference,
      from: p.from,
      to: p.to,
      fromSnap,
      toSnap,
      pieces,
    });

  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    snap: (p, profile) => publicSnap(snap(p, profile)),
    route(req) {
      const p = prepare(req);
      if ('ok' in p) return p;
      for (const [f, t] of pairs(p)) {
        const found = findRoute(
          graph,
          costTable(p.tables, p.preference),
          searchEnd(f),
          searchEnd(t),
          heuristicScale(p.profile, p.preference),
          workspace,
        );
        if (found) return build(p, f, t, found.pieces);
      }
      return fail('no-path', noPathMessage(p.profile));
    },
    alternatives(req): RouteResult[] {
      const p = prepare(req);
      if ('ok' in p) return [p];
      for (const [f, t] of pairs(p)) {
        const paths = findAlternatives(graph, costTable(p.tables, p.preference), searchEnd(f), searchEnd(t), {
          maxAlternatives: R.maxAlternatives,
          minDifference: R.alternativeMinDifference,
          hScale: heuristicScale(p.profile, p.preference),
          workspace,
        });
        if (paths.length > 0) return paths.map((path) => build(p, f, t, path.pieces));
      }
      return [fail('no-path', noPathMessage(p.profile))];
    },
  };
}
