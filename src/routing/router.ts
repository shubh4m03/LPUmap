/**
 * createRouter: validates requests, snaps endpoints, runs A* and assembles
 * results. Per-profile tables and snap indexes are built lazily and cached.
 */
import type { GraphFile, LngLat } from '../data/schema.ts';
import { APP_CONFIG } from '../config/index.ts';
import { haversineM, isValidLngLat } from '../distance/geodesic.ts';
import { findAlternatives } from './alternatives.ts';
import { createWorkspace, findPath } from './astar.ts';
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
  Router,
} from './types.ts';

const R = APP_CONFIG.routing;

interface Prepared {
  from: RouteEndpoint;
  to: RouteEndpoint;
  profile: RouteProfileId;
  preference: RoutePreference;
  tables: ProfileTables;
  fromSnap: SnapHit;
  toSnap: SnapHit;
}

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
      s = buildSnapIndex(graph, tablesFor(profile).nodeUsable, R.maxSnapDistanceM);
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
        const d = haversineM(ep.location, nodeCoord(graph, id));
        if (d <= R.maxSnapDistanceM) return { nodeId: id, distanceM: d };
      }
    }
    return snap(ep.location, profile);
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
    return { from, to, profile, preference, tables: tablesFor(profile), fromSnap, toSnap };
  };

  const build = (p: Prepared, arcs: readonly number[]) =>
    buildRoute({
      graph,
      tables: p.tables,
      preference: p.preference,
      from: p.from,
      to: p.to,
      fromSnap: p.fromSnap,
      toSnap: p.toSnap,
      arcs,
    });

  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    snap,
    route(req) {
      const p = prepare(req);
      if ('ok' in p) return p;
      const found = findPath(
        graph,
        costTable(p.tables, p.preference),
        p.fromSnap.nodeId,
        p.toSnap.nodeId,
        heuristicScale(p.profile, p.preference),
        workspace,
      );
      return found ? build(p, found.arcs) : fail('no-path', noPathMessage(p.profile));
    },
    alternatives(req): RouteResult[] {
      const p = prepare(req);
      if ('ok' in p) return [p];
      const paths = findAlternatives(
        graph,
        costTable(p.tables, p.preference),
        p.fromSnap.nodeId,
        p.toSnap.nodeId,
        {
          maxAlternatives: R.maxAlternatives,
          minDifference: R.alternativeMinDifference,
          hScale: heuristicScale(p.profile, p.preference),
          workspace,
        },
      );
      if (paths.length === 0) return [fail('no-path', noPathMessage(p.profile))];
      return paths.map((path) => build(p, path.arcs));
    },
  };
}
