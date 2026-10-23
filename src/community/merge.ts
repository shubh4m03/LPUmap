/**
 * mergePublication: overlays the owner-published layer (overrides + owner /
 * community locations) on the static base dataset. Pure, deterministic and
 * non-mutating — the base CampusData is never modified.
 *
 * Precedence (docs/COMMUNITY_MODULE_CONTRACTS.md, "Merge service"):
 *  1. hidden override → place removed, with its building footprint and every
 *     relation touching it (places inside a removed footprint lose buildingId);
 *  2. override fields replace base fields; provenance becomes 'owner';
 *     building footprint name/displayName/categoryId follow;
 *  3. override accessNodeId is used only after validation (exists, walkable,
 *     ≤ maxPlaceConnectorM) — otherwise the place is NOT routable and reported.
 *     A moved place keeps its base graph node only if that node still passes
 *     the same check;
 *  4. published locations are appended (kind 'facility', campusZone from the
 *     boundary), routable only with a validated accessNodeId, never auto-snapped;
 *  5. overrides of ids missing from the base → ignored, reported as orphans;
 *  6. published ids that collide with base ids (or repeat) → ignored, reported;
 *  7. manifest counts recomputed; datasetVersion stays the base version and the
 *     publication version is reported separately.
 */
import { CATEGORIES } from '../config/categories.ts';
import type { CampusData } from '../data/campus-data.ts';
import type {
  BuildingsFile,
  LngLat,
  Manifest,
  Place,
  Relation,
  SourceRecord,
} from '../data/schema.ts';
import { placeKindSchema, relationTypeSchema } from '../data/schema.ts';
import { isValidLngLat } from '../distance/geodesic.ts';
import type { Publication, PublishedLocation, PublishedOverride } from './schema.ts';
import { boundaryPolygons, campusZoneFor, checkAccessNode, footNodeSet, type PolygonRings } from './geo.ts';

export interface MergeIssue {
  id: string;
  reason: string;
  message: string;
}

export interface MergeReport {
  publicationVersion: number;
  hiddenPlaces: string[];
  overriddenPlaces: string[];
  orphanOverrides: string[];
  addedLocations: string[];
  /** Published locations ignored because their id collides with a base place or repeats. */
  shadowedLocations: string[];
  /** Places/locations whose access node failed validation (they are not routable). */
  invalidAccess: MergeIssue[];
  removedBuildings: string[];
  droppedRelations: number;
}

export interface MergeResult {
  data: CampusData;
  report: MergeReport;
}

export const OWNER_SOURCE: SourceRecord = {
  id: 'owner',
  name: 'Campus Atlas owner edits',
  notes: 'Locations and corrections published by the site owner. Overlaid on the base dataset; never written into it.',
};
export const COMMUNITY_SOURCE: SourceRecord = {
  id: 'community',
  name: 'Community suggestions (owner-approved)',
  notes: 'Submitted by visitors and published only after the site owner reviewed and approved them.',
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Ctx {
  nodes: readonly LngLat[];
  foot: ReadonlySet<number>;
  polygons: PolygonRings[];
  report: MergeReport;
}

function withRouting(place: Place, nodeId: number | null | undefined, ctx: Ctx, reasonPrefix: string): Place {
  const { graphNodeId: _g, connectorLengthM: _c, ...rest } = place;
  if (nodeId === null || nodeId === undefined) return rest;
  if (!place.location) {
    ctx.report.invalidAccess.push({
      id: place.id,
      reason: `${reasonPrefix}no-location`,
      message: 'An access node needs a map position.',
    });
    return rest;
  }
  const check = checkAccessNode(ctx.nodes, ctx.foot, nodeId, place.location);
  if (!check.ok) {
    ctx.report.invalidAccess.push({ id: place.id, reason: `${reasonPrefix}${check.reason}`, message: check.message });
    return rest;
  }
  return { ...rest, graphNodeId: check.nodeId, connectorLengthM: check.distanceM };
}

function applyOverride(p: Place, o: PublishedOverride, ctx: Ctx): Place {
  const f = o.fields;
  const next: Place = { ...p };
  if (f.name !== undefined) {
    next.name = f.name;
    next.displayName = f.name;
  }
  if (f.categoryId !== undefined) next.categoryId = f.categoryId;
  const moved = f.location !== undefined && isValidLngLat(f.location);
  if (moved) {
    next.location = [f.location![0], f.location![1]];
    next.campusZone = campusZoneFor(next.location, ctx.polygons);
  }
  if (f.description !== undefined) next.description = f.description;
  if (f.openingHours !== undefined) next.openingHours = f.openingHours;
  if (f.wheelchair !== undefined) next.wheelchair = f.wheelchair;
  if (f.website !== undefined) next.contact = { ...p.contact, website: f.website };
  const provenanceNotes = `Owner override of ${p.provenance.sourceId}${f.sourceUrl ? ` (source: ${f.sourceUrl})` : ''}`;
  const lastVerifiedAt = f.lastVerifiedAt ?? p.provenance.lastVerifiedAt;
  next.provenance = {
    sourceId: 'owner',
    sourceRef: p.provenance.sourceRef ?? p.id,
    verificationStatus: f.verificationStatus ?? p.provenance.verificationStatus,
    ...(lastVerifiedAt !== undefined ? { lastVerifiedAt } : {}),
    notes: provenanceNotes,
  };
  if (o.accessNodeId !== null) return withRouting(next, o.accessNodeId, ctx, 'override-');
  // A moved place keeps its pipeline-inferred node only if it still validates.
  if (moved && p.graphNodeId !== undefined) return withRouting(next, p.graphNodeId, ctx, 'moved-');
  return next;
}

function locationToPlace(l: PublishedLocation, ctx: Ctx): Place {
  const location: LngLat = [l.location[0], l.location[1]];
  const place: Place = {
    id: l.id,
    name: l.name,
    displayName: l.name,
    aliases: [],
    categoryId: l.categoryId,
    kind: 'facility',
    location,
    campusZone: campusZoneFor(location, ctx.polygons),
    ...(l.description !== undefined ? { description: l.description } : {}),
    ...(l.openingHours !== undefined ? { openingHours: l.openingHours } : {}),
    ...(l.website !== undefined ? { contact: { website: l.website } } : {}),
    wheelchair: l.wheelchair,
    provenance: {
      sourceId: l.origin,
      sourceRef: l.sourceUrl ?? l.id,
      verificationStatus: l.verificationStatus,
      ...(l.lastVerifiedAt !== undefined ? { lastVerifiedAt: l.lastVerifiedAt } : {}),
      notes:
        l.origin === 'owner'
          ? 'Added by the site owner.'
          : 'Suggested by a visitor; reviewed and approved by the site owner.',
    },
  };
  return withRouting(place, l.accessNodeId, ctx, 'location-');
}

function rebuildBuildings(
  base: BuildingsFile,
  hidden: ReadonlySet<string>,
  placesById: ReadonlyMap<string, Place>,
  overridden: ReadonlySet<string>,
  removed: string[],
): BuildingsFile {
  const features: BuildingsFile['features'] = [];
  for (const f of base.features) {
    const id = f.properties.id;
    if (hidden.has(id)) {
      removed.push(id);
      continue;
    }
    const p = overridden.has(id) ? placesById.get(id) : undefined;
    features.push(
      p ? { ...f, properties: { ...f.properties, name: p.name, displayName: p.displayName, categoryId: p.categoryId } } : f,
    );
  }
  return { ...base, features };
}

function recount(base: Manifest, places: Place[], buildings: BuildingsFile, relations: Relation[]) {
  const c: Record<string, number> = { ...base.counts };
  const count = (pred: (p: Place) => boolean) => places.filter(pred).length;
  c.places = places.length;
  c.buildings = buildings.features.length;
  c['buildings:unnamed'] = buildings.features.filter((f) => f.properties.name === null).length;
  c.relations = relations.length;
  c['places:withoutLocation'] = count((p) => p.location === null);
  c['places:notConnected'] = count((p) => p.location !== null && p.graphNodeId === undefined);
  c['zone:on-campus'] = count((p) => p.campusZone === 'on-campus');
  c['zone:off-campus-nearby'] = count((p) => p.campusZone === 'off-campus-nearby');
  for (const cat of CATEGORIES) c[`category:${cat.id}`] = count((p) => p.categoryId === cat.id);
  for (const k of placeKindSchema.options) c[`kind:${k}`] = count((p) => p.kind === k);
  for (const h of ['osm-height', 'osm-levels-estimate', 'fallback'])
    c[`heightSource:${h}`] = buildings.features.filter((f) => f.properties.heightSource === h).length;
  for (const t of relationTypeSchema.options) c[`relation:${t}`] = relations.filter((r) => r.type === t).length;
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => byString(a, b)));
}

export function mergePublication(base: CampusData, pub: Publication): MergeResult {
  const report: MergeReport = {
    publicationVersion: pub.publicationVersion,
    hiddenPlaces: [],
    overriddenPlaces: [],
    orphanOverrides: [],
    addedLocations: [],
    shadowedLocations: [],
    invalidAccess: [],
    removedBuildings: [],
    droppedRelations: 0,
  };
  const ctx: Ctx = {
    nodes: base.graph.nodes,
    foot: footNodeSet(base.graph),
    polygons: boundaryPolygons(base.boundary),
    report,
  };
  const baseIds = new Set(base.places.map((p) => p.id));

  const overrides = new Map<string, PublishedOverride>();
  for (const o of [...pub.overrides].sort((a, b) => byString(a.targetId, b.targetId))) {
    if (overrides.has(o.targetId)) continue;
    if (!baseIds.has(o.targetId)) report.orphanOverrides.push(o.targetId);
    else overrides.set(o.targetId, o);
  }
  const hidden = new Set([...overrides.values()].filter((o) => o.hidden).map((o) => o.targetId));

  const places: Place[] = [];
  const seen = new Set<string>();
  const overridden = new Set<string>();
  for (const p of base.places) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (hidden.has(p.id)) {
      report.hiddenPlaces.push(p.id);
      continue;
    }
    const o = overrides.get(p.id);
    if (o) {
      overridden.add(p.id);
      report.overriddenPlaces.push(p.id);
      places.push(applyOverride(p, o, ctx));
    } else places.push(p);
  }

  const placesById = new Map(places.map((p) => [p.id, p]));
  const buildings = rebuildBuildings(base.buildings, hidden, placesById, overridden, report.removedBuildings);
  const removedBuildings = new Set(report.removedBuildings);
  for (let i = 0; i < places.length; i++) {
    const p = places[i]!;
    if (p.buildingId !== undefined && removedBuildings.has(p.buildingId)) {
      const { buildingId: _b, ...rest } = p;
      places[i] = rest;
    }
  }

  const relations = base.relations.filter((r) => !hidden.has(r.from) && !hidden.has(r.to));
  report.droppedRelations = base.relations.length - relations.length;

  const origins = new Set<string>();
  for (const l of [...pub.locations].sort((a, b) => byString(a.id, b.id))) {
    if (seen.has(l.id) || !isValidLngLat(l.location)) {
      report.shadowedLocations.push(l.id);
      continue;
    }
    seen.add(l.id);
    places.push(locationToPlace(l, ctx));
    report.addedLocations.push(l.id);
    origins.add(l.origin);
  }

  const sourceIds = new Set(base.manifest.sources.map((s) => s.id));
  const extraSources: SourceRecord[] = [];
  const needOwner = origins.has('owner') || overridden.size > 0;
  if (needOwner && !sourceIds.has('owner')) extraSources.push({ ...OWNER_SOURCE, retrievedAt: pub.generatedAt });
  if (origins.has('community') && !sourceIds.has('community'))
    extraSources.push({ ...COMMUNITY_SOURCE, retrievedAt: pub.generatedAt });

  const manifest: Manifest = {
    ...base.manifest,
    sources: [...base.manifest.sources, ...extraSources],
    counts: recount(base.manifest, places, buildings, relations),
  };
  return { data: { ...base, manifest, places, buildings, relations }, report };
}
