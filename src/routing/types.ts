/**
 * Public routing types (see docs/MODULE_CONTRACTS.md). Pure — no DOM, React
 * or MapLibre — so the router runs in tests, workers and scripts alike.
 */
import type { LngLat } from '../data/schema.ts';

export type RouteProfileId = 'walk' | 'cycle' | 'step-free';
export type RoutePreference = 'shortest' | 'fastest';

export type RouteEndpoint =
  | { kind: 'place'; placeId: string; label: string; location: LngLat; nodeId?: number }
  | { kind: 'point'; label: string; location: LngLat };

export interface RouteRequest {
  from: RouteEndpoint;
  to: RouteEndpoint;
  profile: RouteProfileId;
  preference?: RoutePreference;
}

export type RouteStepKind = 'path' | 'road' | 'steps' | 'connector' | 'push-bike';

export interface RouteStep {
  kind: RouteStepKind;
  name: string | null;
  distanceM: number;
  durationS: number;
  instruction: string;
  /** Index into RouteOk.coordinates where this step begins. */
  startIndex: number;
}

export type RouteCaveatCode =
  | 'accessibility-unverified'
  | 'contains-steps'
  | 'push-bike'
  | 'start-connector'
  | 'end-connector'
  | 'unnamed-paths';

export interface RouteCaveat {
  code: RouteCaveatCode;
  message: string;
}

export interface RouteOk {
  ok: true;
  profile: RouteProfileId;
  preference: RoutePreference;
  /** Full drawn geometry, including straight off-network connector legs. */
  coordinates: LngLat[];
  distanceM: number;
  durationS: number;
  edgeIds: number[];
  steps: RouteStep[];
  caveats: RouteCaveat[];
  /** Straight connector lengths from the endpoints onto the network. */
  snap: { fromM: number; toM: number };
}

export type RouteFailureReason =
  'invalid-input' | 'same-point' | 'origin-unsnappable' | 'destination-unsnappable' | 'no-path';

export interface RouteFailure {
  ok: false;
  reason: RouteFailureReason;
  message: string;
}

export type RouteResult = RouteOk | RouteFailure;

export interface Router {
  route(req: RouteRequest): RouteResult;
  /** Best route first; extra entries only if they differ meaningfully. */
  alternatives(req: RouteRequest): RouteResult[];
  snap(p: LngLat, profile: RouteProfileId): { nodeId: number; distanceM: number } | null;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

export interface RouteProfileDef {
  id: RouteProfileId;
  label: string;
  description: string;
  /** Nominal speed used for the A* heuristic and duration estimates. */
  speedMps: number;
}
