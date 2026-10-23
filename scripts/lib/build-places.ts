/**
 * Places from OSM: every building footprint, POI nodes/ways/relations,
 * entrances, gates and the campus area itself. Unnamed features keep
 * `name: null` with a truthful displayName; nothing is invented.
 */
import { getCategory } from '../../src/config/categories.ts';
import type { LngLat, Place, PlaceKind } from '../../src/data/schema.ts';
import type { BuildingRecord } from './build-buildings.ts';
import type { CampusBoundary } from './build-boundary.ts';
import { classifyTags, isBuildingTagged } from './classify.ts';
import { inBBox, multiPolygonPointOnSurface, roundCoord } from './geometry.ts';
import type { MultiPolygon } from './geometry.ts';
import { relationGeometry, wayCoords, wayPolygon } from './osm-geometry.ts';
import { sortedValues } from './osm-parse.ts';
import type { OsmData, Tags } from './osm-parse.ts';
import { aliasesFromTags, commonPlaceFields, nameFromTags, osmProvenance } from './place-fields.ts';

export interface PlaceRecord {
  place: Place;
  /** OSM node id for point features (entrance attachment). */
  osmNodeId?: number;
  /** Footprint for buildings, area geometry for area features. */
  multiPolygon?: MultiPolygon;
  geometry: 'point' | 'area' | 'line';
}

export interface PlacesContext {
  boundary: CampusBoundary;
  /** Campus-inventory footprints (status inside or crossing): become `kind: 'building'` places. */
  buildings: readonly BuildingRecord[];
  /**
   * Footprints classified 'outside'. Owner decision 2: no off-campus building
   * is ever shipped, so a named or use-tagged one (a restaurant, a PG, a bank)
   * becomes a point-only context place without footprint; the rest are dropped
   * (and listed in the coverage report).
   */
  outsideBuildings?: readonly BuildingRecord[];
  maxBounds: readonly [number, number, number, number];
  retrievedAt: string;
}

const GATE_BARRIERS = new Set([
  'gate',
  'lift_gate',
  'entrance',
  'swing_gate',
  'sliding_gate',
  'kissing_gate',
]);
const AREA_CATEGORIES = new Set(['university', 'park', 'sports', 'parking']);
const AREA_KEYS = ['landuse', 'leisure', 'natural', 'place'];
const LANDMARK_KEYS = ['man_made', 'historic', 'memorial'];
const LANDMARK_TOURISM = new Set(['attraction', 'artwork', 'viewpoint']);
/** Named features with these keys and no category are infrastructure, not places. */
const NON_PLACE_KEYS = [
  'highway',
  'railway',
  'power',
  'boundary',
  'route',
  'waterway',
  'place',
  'traffic_sign',
];
const SUBCATEGORY_KEYS = [
  'amenity',
  'shop',
  'tourism',
  'leisure',
  'healthcare',
  'office',
  'craft',
  'man_made',
  'barrier',
  'entrance',
  'landuse',
  'emergency',
  'public_transport',
  'highway',
];

const isGateBarrier = (t: Tags) => GATE_BARRIERS.has(t.barrier ?? '') || t.man_made === 'ceremonial_gate';
const isEntrance = (t: Tags) => t.entrance !== undefined && t.entrance !== 'no';
const namedGate = (name: string | null) => name !== null && /\bgate\b/i.test(name);

function subcategory(tags: Tags): string | undefined {
  for (const k of SUBCATEGORY_KEYS) {
    const v = tags[k];
    if (v && v !== 'yes') return v;
  }
  return undefined;
}

function primaryTag(tags: Tags): string {
  for (const k of [...SUBCATEGORY_KEYS, ...AREA_KEYS]) if (tags[k]) return `${k}=${tags[k]}`;
  return 'an untyped feature';
}

function gateDescription(tags: Tags): string {
  const how =
    tags.man_made === 'ceremonial_gate'
      ? 'a ceremonial gate structure (man_made=ceremonial_gate), not as a barrier or entrance'
      : `a gate (barrier=${tags.barrier})`;
  const access = tags.access ? ` Access is tagged "${tags.access}".` : '';
  return `Mapped in OpenStreetMap as ${how}. Whether it is open, and to whom, is not recorded.${access}`;
}

function unnamedLabel(kind: PlaceKind, categoryId: string, tags: Tags): string {
  if (kind === 'entrance') return tags.entrance === 'main' ? 'Main entrance' : 'Entrance';
  if (kind === 'gate') return 'Unnamed gate';
  return `Unnamed ${kind === 'area' ? 'area' : 'place'} · ${getCategory(categoryId).label}`;
}

interface Candidate {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags: Tags;
  location: LngLat;
  geometry: PlaceRecord['geometry'];
  multiPolygon?: MultiPolygon;
}

/** Decides whether a tagged feature becomes a place, and as what. */
function describe(c: Candidate): { kind: PlaceKind; categoryId: string; description?: string } | null {
  const { tags } = c;
  const name = nameFromTags(tags);
  const category = classifyTags(tags);
  if (isGateBarrier(tags)) return { kind: 'gate', categoryId: 'gate', description: gateDescription(tags) };
  if (isEntrance(tags) && c.type === 'node') return { kind: 'entrance', categoryId: 'gate' };
  const areaLike =
    c.geometry === 'area' &&
    (AREA_KEYS.some((k) => tags[k]) || (category !== null && AREA_CATEGORIES.has(category)));
  if (namedGate(name)) {
    // Named like a gate but not mapped as one (e.g. a neighbourhood called "Law gate").
    return {
      kind: areaLike ? 'area' : 'landmark',
      categoryId: category ?? 'other',
      description:
        `“${name}” is mapped in OpenStreetMap as ${primaryTag(tags)}, not as a gate, barrier or entrance. ` +
        'It is a place name, not a campus entrance.',
    };
  }
  if (category === null) {
    if (!name || NON_PLACE_KEYS.some((k) => tags[k])) return null;
    const landmark = LANDMARK_KEYS.some((k) => tags[k]) || LANDMARK_TOURISM.has(tags.tourism ?? '');
    return { kind: areaLike ? 'area' : landmark ? 'landmark' : 'facility', categoryId: 'other' };
  }
  if (category === 'gate') return { kind: 'gate', categoryId: 'gate', description: gateDescription(tags) };
  if (areaLike) return { kind: 'area', categoryId: category };
  return { kind: category === 'university' ? 'landmark' : 'facility', categoryId: category };
}

function toRecord(c: Candidate, ctx: PlacesContext): PlaceRecord | null {
  const d = describe(c);
  if (!d) return null;
  const ref = `${c.type}/${c.id}`;
  const name = nameFromTags(c.tags);
  const sub = subcategory(c.tags);
  const onCampus = ctx.boundary.contains(c.location);
  const description =
    d.kind === 'gate' && !onCampus
      ? `${d.description ?? ''} It lies outside the campus boundary mapped in OpenStreetMap; nothing in the data links it to a campus entrance.`.trim()
      : d.description;
  const place: Place = {
    id: `osm:${ref}`,
    name,
    displayName: name ?? unnamedLabel(d.kind, d.categoryId, c.tags),
    aliases: aliasesFromTags(c.tags, name),
    categoryId: d.categoryId,
    ...(sub ? { subcategory: sub } : {}),
    kind: d.kind,
    location: c.location,
    campusZone: onCampus ? 'on-campus' : 'off-campus-nearby',
    ...(description ? { description } : {}),
    ...commonPlaceFields(c.tags),
    provenance: osmProvenance(ref, ctx.retrievedAt, c.tags),
  };
  return {
    place,
    geometry: c.geometry,
    ...(c.type === 'node' ? { osmNodeId: c.id } : {}),
    ...(c.multiPolygon ? { multiPolygon: c.multiPolygon } : {}),
  };
}

function buildingRecord(b: BuildingRecord, retrievedAt: string): PlaceRecord {
  const sub = subcategory(b.tags) ?? (b.tags.building !== 'yes' ? b.tags.building : undefined);
  const levels = b.height.levelsSuspicious ? null : b.height.levels;
  const place: Place = {
    id: b.id,
    name: b.name,
    displayName: b.displayName,
    aliases: aliasesFromTags(b.tags, b.name),
    categoryId: b.categoryId,
    ...(sub ? { subcategory: sub } : {}),
    kind: 'building',
    location: b.location,
    buildingId: b.id,
    campusZone: 'on-campus',
    ...(b.height.levelsSuspicious
      ? {
          description: `Levels tagged ${b.height.levels} in OpenStreetMap (suspicious: below 1 storey); drawn with the placeholder height.`,
        }
      : {}),
    ...commonPlaceFields(b.tags),
    ...(levels !== null && Number.isInteger(levels) ? { levels } : {}),
    heightM: b.height.heightM,
    heightSource: b.height.heightSource,
    provenance: osmProvenance(b.ref, retrievedAt, b.tags),
  };
  return { place, geometry: 'area', multiPolygon: b.multiPolygon };
}

function campusRecord(ctx: PlacesContext): PlaceRecord {
  const rel = ctx.boundary.relation;
  const location = roundCoord(multiPolygonPointOnSurface(ctx.boundary.multiPolygon)!);
  const name = nameFromTags(rel.tags);
  const place: Place = {
    id: `osm:relation/${rel.id}`,
    name,
    displayName: name ?? 'University campus',
    aliases: aliasesFromTags(rel.tags, name),
    categoryId: 'university',
    subcategory: 'university',
    kind: 'area',
    location,
    campusZone: 'on-campus',
    description: 'Campus extent as mapped in OpenStreetMap (multipolygon boundary relation).',
    ...commonPlaceFields(rel.tags),
    provenance: osmProvenance(`relation/${rel.id}`, ctx.retrievedAt, rel.tags),
  };
  return { place, geometry: 'area', multiPolygon: ctx.boundary.multiPolygon };
}

function lineMidpoint(coords: LngLat[]): LngLat | null {
  return coords[Math.floor((coords.length - 1) / 2)] ?? null;
}

export function collectPlaces(osm: OsmData, ctx: PlacesContext): PlaceRecord[] {
  const records: PlaceRecord[] = [campusRecord(ctx)];
  const push = (c: Candidate | null) => {
    if (!c || !inBBox(c.location, ctx.maxBounds)) return;
    const rec = toRecord(c, ctx);
    if (rec) records.push(rec);
  };
  for (const b of ctx.buildings) records.push(buildingRecord(b, ctx.retrievedAt));
  for (const b of ctx.outsideBuildings ?? []) {
    if (!inBBox(b.location, ctx.maxBounds)) continue;
    const rec = toRecord(
      { type: b.osmType, id: b.osmId, tags: b.tags, location: b.location, geometry: 'point' },
      ctx,
    );
    if (!rec || (rec.place.name === null && rec.place.categoryId === 'building')) continue;
    rec.place.campusZone = 'off-campus-nearby';
    rec.place.description = [
      rec.place.description,
      'Mapped in OpenStreetMap as a building outside the campus boundary; shown as a point only (off-campus buildings are not drawn).',
    ]
      .filter(Boolean)
      .join(' ');
    records.push(rec);
  }

  for (const node of sortedValues(osm.nodes)) {
    if (Object.keys(node.tags).length === 0) continue;
    push({
      type: 'node',
      id: node.id,
      tags: node.tags,
      location: roundCoord([node.lon, node.lat]),
      geometry: 'point',
    });
  }
  for (const way of sortedValues(osm.ways)) {
    if (isBuildingTagged(way.tags) || way.tags['building:part']) continue;
    const poly = wayPolygon(osm, way);
    if (poly) {
      const loc = multiPolygonPointOnSurface([poly]);
      if (loc)
        push({
          type: 'way',
          id: way.id,
          tags: way.tags,
          location: roundCoord(loc),
          geometry: 'area',
          multiPolygon: [poly],
        });
      continue;
    }
    if (NON_PLACE_KEYS.some((k) => way.tags[k]) && !isGateBarrier(way.tags)) continue;
    const coords = wayCoords(osm, way);
    const mid = coords ? lineMidpoint(coords) : null;
    if (mid) push({ type: 'way', id: way.id, tags: way.tags, location: mid, geometry: 'line' });
  }
  for (const rel of sortedValues(osm.relations)) {
    if (rel.id === ctx.boundary.relation.id || rel.tags.type !== 'multipolygon' || isBuildingTagged(rel.tags))
      continue;
    const geom = relationGeometry(osm, rel);
    const loc = multiPolygonPointOnSurface(geom.multiPolygon);
    if (!loc || geom.missingWays > 0 || geom.unclosedRings > 0) continue;
    push({
      type: 'relation',
      id: rel.id,
      tags: rel.tags,
      location: roundCoord(loc),
      geometry: 'area',
      multiPolygon: geom.multiPolygon,
    });
  }
  return records;
}
