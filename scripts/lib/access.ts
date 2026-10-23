/**
 * Conservative walking/cycling access rules for OSM ways.
 *
 * Walking: allowed on footway/path/pedestrian/steps/living_street/residential/
 * service/unclassified/tertiary/secondary/track/corridor/crossing (+ their
 * _link roads), and on cycleway unless foot=no. Trunk, primary and motorway
 * carry fast traffic and usually lack sidewalks in this area, so they are
 * excluded unless explicitly tagged foot=yes|designated.
 *
 * Cycling: 'ride' on roads, cycleway, track and path; 'push' (dismount) on
 * footway/pedestrian/steps/corridor unless bicycle=yes|designated; trunk and
 * primary are treated like walking (ride only when bicycle=yes|designated).
 * 'no' when bicycle=no, or when the cyclist would have to dismount on a way
 * walking is not allowed on.
 *
 * access=private|no excludes a mode unless that mode is explicitly allowed.
 */
import type { GraphEdge, Wheelchair } from '../../src/data/schema.ts';
import type { Tags } from './osm-parse.ts';
import { wheelchairFromTag } from './place-fields.ts';

const WALK_HIGHWAYS = new Set([
  'footway',
  'path',
  'pedestrian',
  'steps',
  'living_street',
  'residential',
  'service',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'track',
  'corridor',
  'crossing',
  'road',
]);
const EXPLICIT_ONLY = new Set([
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'motorway',
  'motorway_link',
]);
const PUSH_HIGHWAYS = new Set(['footway', 'pedestrian', 'steps', 'corridor', 'crossing']);
const RIDE_HIGHWAYS = new Set([
  'cycleway',
  'track',
  'path',
  'living_street',
  'residential',
  'service',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'road',
]);
const YES = new Set(['yes', 'designated', 'permissive']);
const EXPLICIT_YES = new Set(['yes', 'designated']);
const NO = new Set(['no', 'private']);

export interface WayAccess {
  foot: boolean;
  bicycle: GraphEdge['bicycle'];
}

export function wayAccess(tags: Tags): WayAccess | null {
  const hw = tags.highway;
  if (!hw || (tags.area === 'yes' && hw !== 'pedestrian')) return null;
  if (!WALK_HIGHWAYS.has(hw) && !EXPLICIT_ONLY.has(hw) && hw !== 'cycleway') return null;
  const restricted = NO.has(tags.access ?? '');
  const footTag = tags.foot ?? '';
  const bikeTag = tags.bicycle ?? '';

  let foot: boolean;
  if (EXPLICIT_ONLY.has(hw)) foot = EXPLICIT_YES.has(footTag);
  else if (NO.has(footTag)) foot = false;
  else if (YES.has(footTag)) foot = true;
  else foot = !restricted;

  let bicycle: GraphEdge['bicycle'];
  if (NO.has(bikeTag)) bicycle = 'no';
  else if (EXPLICIT_ONLY.has(hw)) bicycle = EXPLICIT_YES.has(bikeTag) ? 'ride' : 'no';
  else if (YES.has(bikeTag)) bicycle = hw === 'steps' ? 'push' : 'ride';
  else if (restricted) bicycle = 'no';
  else if (bikeTag === 'dismount' || PUSH_HIGHWAYS.has(hw)) bicycle = 'push';
  else if (RIDE_HIGHWAYS.has(hw)) bicycle = 'ride';
  else bicycle = 'no';
  if (bicycle === 'push' && !foot) bicycle = 'no';

  if (!foot && bicycle === 'no') return null;
  return { foot, bicycle };
}

export interface Direction {
  /** Edges are emitted against the way's node order. */
  reverse: boolean;
  onewayBicycle: boolean;
  onewayFoot: boolean;
  /** oneway:foot and vehicle oneway point in opposite directions. */
  conflict: boolean;
}

const isYes = (v: string | undefined) => v === 'yes' || v === '1' || v === 'true';

export function wayDirection(tags: Tags): Direction {
  const vehicleOneway = tags.oneway ?? (tags.junction === 'roundabout' ? 'yes' : undefined);
  const bikeOverride = tags['oneway:bicycle'];
  let bikeDir: 0 | 1 | -1 = 0;
  if (bikeOverride === 'no') bikeDir = 0;
  else if (isYes(bikeOverride)) bikeDir = 1;
  else if (bikeOverride === '-1') bikeDir = -1;
  else if (isYes(vehicleOneway)) bikeDir = 1;
  else if (vehicleOneway === '-1') bikeDir = -1;
  const footDir: 0 | 1 = isYes(tags['oneway:foot']) ? 1 : 0;
  const conflict = bikeDir === -1 && footDir === 1;
  return {
    reverse: bikeDir === -1 && !conflict,
    onewayBicycle: bikeDir !== 0 && !conflict,
    onewayFoot: footDir === 1,
    conflict,
  };
}

export function edgeWheelchair(tags: Tags): Wheelchair {
  const tagged = wheelchairFromTag(tags.wheelchair);
  if (tagged !== 'unknown') return tagged;
  return tags.highway === 'steps' ? 'no' : 'unknown';
}

export function isIndoor(tags: Tags): boolean {
  return tags.highway === 'corridor' || (tags.indoor !== undefined && tags.indoor !== 'no');
}
