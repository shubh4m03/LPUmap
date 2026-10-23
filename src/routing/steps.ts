/**
 * Turn-by-turn steps from route legs. Consecutive legs of the same kind and
 * name merge into one step. Names come only from the data; unnamed ways are
 * described generically ("the path", "the road", "the footway").
 *
 * Network legs shorter than MIN_CONNECTOR_DRAW_M never form a step of their own.
 *
 * Turn direction uses the heading change at the step boundary (incoming
 * bearing of the last non-zero segment before it vs outgoing bearing of the
 * first non-zero segment after it); thresholds are TURN_THRESHOLDS_DEG.
 */
import type { LngLat } from '../data/schema.ts';
import { bearingDeg } from '../distance/geodesic.ts';
import { MIN_CONNECTOR_DRAW_M, TURN_THRESHOLDS_DEG } from './constants.ts';
import type { RouteProfileId, RouteStep, RouteStepKind } from './types.ts';

export interface RouteLeg {
  kind: RouteStepKind;
  /** Source name, or null when the data has none. */
  name: string | null;
  /** Generic description used when `name` is null, e.g. "the footway". */
  noun: string;
  /** 'start' / 'end' for connector legs. */
  connector?: 'start' | 'end';
  lengthM: number;
  durationS: number;
  /** Index into the route coordinates where the leg starts (it ends at startIndex + 1). */
  startIndex: number;
}

export type TurnDirection =
  'straight' | 'slight-left' | 'slight-right' | 'left' | 'right' | 'sharp-left' | 'sharp-right';

const ROAD_HIGHWAYS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'living_street',
  'road',
  'busway',
]);

export function isRoadHighway(highway: string): boolean {
  return ROAD_HIGHWAYS.has(highway.replace(/_link$/, ''));
}

export function genericNoun(highway: string, steps: boolean): string {
  if (steps || highway === 'steps') return 'the steps';
  if (isRoadHighway(highway)) return 'the road';
  if (highway === 'footway') return 'the footway';
  if (highway === 'cycleway') return 'the cycleway';
  if (highway === 'pedestrian') return 'the pedestrian way';
  return 'the path';
}

/** Signed heading change in (-180, 180]; positive = clockwise (right). */
export function headingChange(fromBearing: number, toBearing: number): number {
  const d = ((((toBearing - fromBearing) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

export function classifyTurn(delta: number): TurnDirection {
  const abs = Math.abs(delta);
  const side = delta < 0 ? 'left' : 'right';
  if (abs < TURN_THRESHOLDS_DEG.straight) return 'straight';
  if (abs < TURN_THRESHOLDS_DEG.slight) return `slight-${side}`;
  if (abs < TURN_THRESHOLDS_DEG.turn) return side;
  return `sharp-${side}`;
}

function turnAt(coords: LngLat[], index: number): TurnDirection {
  let before = -1;
  for (let i = index; i > 0; i--) {
    if (!samePoint(coords[i - 1]!, coords[i]!)) {
      before = i - 1;
      break;
    }
  }
  let after = -1;
  for (let i = index; i < coords.length - 1; i++) {
    if (!samePoint(coords[i]!, coords[i + 1]!)) {
      after = i + 1;
      break;
    }
  }
  if (before < 0 || after < 0) return 'straight';
  const incoming = bearingDeg(coords[before]!, coords[index]!);
  const outgoing = bearingDeg(coords[index]!, coords[after]!);
  return classifyTurn(headingChange(incoming, outgoing));
}

const samePoint = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];

export function formatStepDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(1, Math.round(m))} m`;
}

const TURN_WORDS: Record<Exclude<TurnDirection, 'straight'>, string> = {
  'slight-left': 'slightly left',
  'slight-right': 'slightly right',
  left: 'left',
  right: 'right',
  'sharp-left': 'sharp left',
  'sharp-right': 'sharp right',
};

interface InstructionContext {
  profile: RouteProfileId;
  destinationLabel: string;
  isFirst: boolean;
  turn: TurnDirection;
}

function instructionFor(
  step: Omit<RouteStep, 'instruction'>,
  leg: RouteLeg,
  ctx: InstructionContext,
): string {
  const d = formatStepDistance(step.distanceM);
  const ref = step.name ?? leg.noun;
  const cycling = ctx.profile === 'cycle';
  const turnWord = ctx.turn === 'straight' ? null : TURN_WORDS[ctx.turn];
  switch (step.kind) {
    case 'connector':
      if (leg.connector === 'end') {
        const how = cycling ? 'walk your bicycle' : 'walk';
        return `Leave the mapped path and ${how} ${d} in a straight line to ${ctx.destinationLabel}`;
      }
      return `${cycling ? 'Walk your bicycle' : 'Walk'} ${d} in a straight line to the nearest mapped path`;
    case 'steps': {
      const tail = cycling ? `, walking your bicycle (${d})` : ` (${d})`;
      if (ctx.isFirst || !turnWord) return `Take the steps${tail}`;
      return `Turn ${turnWord} and take the steps${tail}`;
    }
    case 'push-bike':
      if (ctx.isFirst || !turnWord) return `Walk your bicycle along ${ref} for ${d}`;
      return `Turn ${turnWord}, then walk your bicycle along ${ref} for ${d}`;
    default:
      if (ctx.isFirst) return `Head along ${ref} for ${d}`;
      if (!turnWord) return `Continue along ${ref} for ${d}`;
      return `Turn ${turnWord} onto ${ref} (${d})`;
  }
}

export function buildSteps(
  legs: RouteLeg[],
  coords: LngLat[],
  opts: { profile: RouteProfileId; destinationLabel: string },
): RouteStep[] {
  const groups: Array<{ first: RouteLeg; distanceM: number; durationS: number }> = [];
  // Near-zero network legs (e.g. an edge joining two nodes at one coordinate) are folded into
  // a neighbouring step instead of becoming a "1 m" instruction of their own.
  let carry: { distanceM: number; durationS: number } | null = null;
  legs.forEach((leg, i) => {
    const prev = groups[groups.length - 1];
    const negligible = leg.kind !== 'connector' && leg.lengthM < MIN_CONNECTOR_DRAW_M;
    const mergeable =
      prev && leg.kind !== 'connector' && prev.first.kind === leg.kind && prev.first.name === leg.name;
    if (mergeable || (negligible && prev)) {
      prev.distanceM += leg.lengthM;
      prev.durationS += leg.durationS;
    } else if (negligible && i < legs.length - 1) {
      carry = {
        distanceM: (carry?.distanceM ?? 0) + leg.lengthM,
        durationS: (carry?.durationS ?? 0) + leg.durationS,
      };
    } else {
      groups.push({
        first: leg,
        distanceM: leg.lengthM + (carry?.distanceM ?? 0),
        durationS: leg.durationS + (carry?.durationS ?? 0),
      });
      carry = null;
    }
  });
  return groups.map((group, i) => {
    const base = {
      kind: group.first.kind,
      name: group.first.name,
      distanceM: group.distanceM,
      durationS: group.durationS,
      startIndex: group.first.startIndex,
    };
    const ctx: InstructionContext = {
      profile: opts.profile,
      destinationLabel: opts.destinationLabel,
      isFirst: i === 0,
      turn: i === 0 ? 'straight' : turnAt(coords, base.startIndex),
    };
    return { ...base, instruction: instructionFor(base, group.first, ctx) };
  });
}
