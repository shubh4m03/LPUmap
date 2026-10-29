/**
 * Travel profiles: which edges each mode may use, in which direction, and
 * how many seconds per metre they take. All speeds come from
 * APP_CONFIG.routing; nothing here claims more than the data says.
 *
 * - walk: edges with foot=true; only `onewayFoot` restricts direction (vehicle
 *   oneway is ignored); steps cost an extra `stepsPenaltySecPerM`.
 * - cycle: bicycle 'ride' at cycleSpeedMps, 'push' at pushBikeSpeedMps, 'no'
 *   forbidden; `onewayBicycle` restricts direction; steps are only usable when
 *   bicycle ≠ 'no' and are always pushed.
 * - step-free: foot edges excluding steps and wheelchair='no', at walking speed.
 *   Edges with unknown/limited wheelchair access remain usable but the route
 *   carries an "accessibility unverified" caveat (see build-route.ts).
 */
import type { GraphEdge } from '../data/index.ts';
import { APP_CONFIG } from '../config/index.ts';
import type { RoutePreference, RouteProfileDef, RouteProfileId } from './types.ts';
import type { RoutingGraph } from './graph.ts';

const R = APP_CONFIG.routing;

export const ROUTE_PROFILES: Record<RouteProfileId, RouteProfileDef> = {
  walk: {
    id: 'walk',
    label: 'Walk',
    description: 'Footpaths, roads and steps where walking is allowed.',
    speedMps: R.walkSpeedMps,
  },
  cycle: {
    id: 'cycle',
    label: 'Cycle',
    description: 'Rides where cycling is allowed; walks the bicycle where the map says to push it.',
    speedMps: R.cycleSpeedMps,
  },
  'step-free': {
    id: 'step-free',
    label: 'Step-free',
    description:
      'Avoids mapped steps and paths tagged as not wheelchair-accessible. Accessibility of the rest is not verified.',
    speedMps: R.walkSpeedMps,
  },
};

export const PROFILE_IDS: readonly RouteProfileId[] = ['walk', 'cycle', 'step-free'];

export function isRouteProfileId(v: unknown): v is RouteProfileId {
  return typeof v === 'string' && (PROFILE_IDS as readonly string[]).includes(v);
}

export function isRoutePreference(v: unknown): v is RoutePreference {
  return v === 'shortest' || v === 'fastest';
}

export interface EdgeRule {
  forward: boolean;
  backward: boolean;
  secondsPerM: number;
  /** Cyclist must dismount and walk the bicycle on this edge. */
  push: boolean;
}

export function edgeRule(profile: RouteProfileId, e: GraphEdge): EdgeRule | null {
  const steps = e.steps === true;
  if (profile === 'cycle') {
    if (e.bicycle !== 'ride' && e.bicycle !== 'push') return null;
    const push = steps || e.bicycle === 'push';
    return {
      forward: true,
      backward: e.onewayBicycle !== true,
      secondsPerM: 1 / (push ? R.pushBikeSpeedMps : R.cycleSpeedMps),
      push,
    };
  }
  if (e.foot !== true) return null;
  if (profile === 'step-free' && (steps || e.wheelchair === 'no')) return null;
  return {
    forward: true,
    backward: e.onewayFoot !== true,
    secondsPerM: 1 / R.walkSpeedMps + (profile === 'walk' && steps ? R.stepsPenaltySecPerM : 0),
    push: false,
  };
}

/** Fastest speed any edge of the profile can be travelled at (bounds the A* heuristic). */
export function maxSpeedMps(profile: RouteProfileId): number {
  return profile === 'cycle' ? Math.max(R.cycleSpeedMps, R.pushBikeSpeedMps) : R.walkSpeedMps;
}

/** Speed for straight off-network connector legs: walking, or pushing a bicycle. */
export function connectorSpeedMps(profile: RouteProfileId): number {
  return profile === 'cycle' ? R.pushBikeSpeedMps : R.walkSpeedMps;
}

export interface ProfileTables {
  profile: RouteProfileId;
  /** Per-arc metres; Infinity when the arc is not usable by this profile. */
  lengthCost: Float64Array;
  /** Per-arc seconds; Infinity when the arc is not usable by this profile. */
  timeCost: Float64Array;
  /** 1 when the cyclist pushes on this arc. */
  arcPush: Uint8Array;
  /** 1 when the node touches at least one arc usable by this profile (either direction). */
  nodeUsable: Uint8Array;
  /** 1 when the edge (index into graph.edges) is usable in at least one direction. */
  edgeUsable: Uint8Array;
}

export function buildProfileTables(graph: RoutingGraph, profile: RouteProfileId): ProfileTables {
  const arcs = graph.arcTarget.length;
  const lengthCost = new Float64Array(arcs).fill(Infinity);
  const timeCost = new Float64Array(arcs).fill(Infinity);
  const arcPush = new Uint8Array(arcs);
  const nodeUsable = new Uint8Array(graph.nodeCount);
  const edgeUsable = new Uint8Array(graph.edgeCount);
  for (let i = 0; i < graph.edgeCount; i++) {
    const rule = edgeRule(profile, graph.edges[i]!);
    if (!rule) continue;
    const len = graph.edgeLengthM[i]!;
    const directions: Array<[number, boolean]> = [
      [graph.edgeArcs[2 * i]!, rule.forward],
      [graph.edgeArcs[2 * i + 1]!, rule.backward],
    ];
    for (const [a, allowed] of directions) {
      if (!allowed) continue;
      edgeUsable[i] = 1;
      lengthCost[a] = len;
      timeCost[a] = len * rule.secondsPerM;
      arcPush[a] = rule.push ? 1 : 0;
      nodeUsable[graph.arcSource[a]!] = 1;
      nodeUsable[graph.arcTarget[a]!] = 1;
    }
  }
  return { profile, lengthCost, timeCost, arcPush, nodeUsable, edgeUsable };
}

export function costTable(tables: ProfileTables, preference: RoutePreference): Float64Array {
  return preference === 'fastest' ? tables.timeCost : tables.lengthCost;
}

/** Lower bound of cost per straight-line metre, so h(n) = haversine × this never overestimates. */
export function heuristicScale(profile: RouteProfileId, preference: RoutePreference): number {
  return preference === 'fastest' ? 1 / maxSpeedMps(profile) : 1;
}
