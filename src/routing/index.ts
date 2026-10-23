/** Public entry point of the routing module (see docs/MODULE_CONTRACTS.md). */
export { createRouter } from './router.ts';
export { ROUTE_PROFILES, isRouteProfileId } from './profiles.ts';
export type {
  RouteCaveat,
  RouteCaveatCode,
  RouteEndpoint,
  RouteFailure,
  RouteFailureReason,
  RouteOk,
  RoutePreference,
  RouteProfileDef,
  RouteProfileId,
  RouteRequest,
  RouteResult,
  RouteStep,
  RouteStepKind,
  Router,
} from './types.ts';
