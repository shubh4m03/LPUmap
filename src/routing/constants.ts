/**
 * Routing-internal thresholds that are properties of the algorithm rather than
 * tunable product settings (those live in APP_CONFIG.routing).
 */

/** Endpoints closer than this are treated as the same point (no route needed). */
export const SAME_POINT_M = 3;

/** A straight connector leg shorter than this is not drawn, and a network leg this short gets no step of its own. */
export const MIN_CONNECTOR_DRAW_M = 0.5;

/** Connector legs longer than this get a "straight-line estimate" caveat. */
export const CONNECTOR_CAVEAT_M = 15;

/**
 * Multiplier applied to the A* heuristic so float rounding can never make it
 * overestimate the true remaining cost (keeps it admissible and consistent).
 */
export const HEURISTIC_SAFETY = 0.999;

/** Cost multiplier applied to edges of an already-found route when searching for alternatives. */
export const ALTERNATIVE_EDGE_PENALTY = 1.5;

/** Relative tolerance under which two path costs count as equal for tie-breaking. */
export const COST_TIE_TOLERANCE = 1e-9;

/**
 * Turn classification by absolute heading change at a step boundary (degrees):
 * below `straight` → continue; below `slight` → slight turn; below `turn` →
 * normal turn; otherwise sharp turn.
 */
export const TURN_THRESHOLDS_DEG = { straight: 20, slight: 45, turn: 135 } as const;

/**
 * A snapped point this close to an edge end is treated as that node, so the
 * router never splits off a sliver of edge (matches MIN_CONNECTOR_DRAW_M).
 */
export const SNAP_NODE_MERGE_M = 0.5;
