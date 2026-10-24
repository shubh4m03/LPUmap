/**
 * mergeStudioBuildings: overlays published studio buildings
 * (PublishedStudioBuilding[], publication v2) on campus data that has
 * ALREADY been through mergePublication (rules 1–7 and 4a). Pure,
 * deterministic (the output depends only on the SET of records) and
 * non-mutating: the base snapshot objects are never modified
 * (docs/BUILDING_STUDIO_DESIGN.md §11).
 *
 * One building = one record = one id everywhere:
 *  - New building (targetId null): exactly ONE BuildingsFile feature and ONE
 *    Place (kind 'building'), both with the `stu:` id, plus one render
 *    model. Membership is recomputed with the current boundary: 'outside'
 *    is dropped (never shipped, not even as context); 'uncertain' keeps the
 *    published owner confirmation when the record has one, otherwise it is
 *    held out (reported as `heldForReview`, like an uncertain base
 *    footprint). The place is routable only through its validated access
 *    node, measured to the footprint (never inferred). directoryVisible:false
 *    keeps it on the map but lists its id in `studioHiddenFromDirectory`.
 *  - Model of a base building (targetId set): the feature keeps the base id
 *    and the place keeps its (override) identity and location; only render
 *    height/base and — with an owner position correction that still lands
 *    on campus — the geometry change. Its building place carries the S3 label
 *    and heightSource 'studio-model' (no heightM: the drawn height is
 *    illustrative, never a measurement). A hidden target hides the model
 *    (`targetHidden`); a missing target is an `orphan`.
 *  - Ids that collide with base ids, repeat, or target a base building that
 *    already has a newer record are ignored (`shadowed`). Records failing the
 *    schema or with invalid footprints are dropped (`invalid`). Draft and
 *    archived records are never in a publication; nothing here re-reads them.
 *
 * Feature properties use `geometrySource: 'studio'` and
 * `renderHeightSource: 'studio-model'`, which src/data/schema.ts does not
 * list yet (required change C1). Until C1 lands the result is typed with
 * the widened `MergedBuildingProps`; base features are assignable to it.
 */
import { CATEGORIES } from '../config/categories.ts';
import { APP_CONFIG } from '../config/index.ts';
import { OWNER_SOURCE, type MergeIssue } from '../community/merge.ts';
import type { CampusData } from '../data/campus-data.ts';
import {
  placeKindSchema,
  relationTypeSchema,
  type BoundaryReviewSection,
  type BuildingProps,
  type BuildingsFile,
  type CuratedMembershipDecision,
  type GeometrySource,
  type HeightSource,
  type LngLat,
  type Manifest,
  type Place,
  type Relation,
} from '../data/schema.ts';
import {
  boundaryFromFeatureCollection,
  classifyFootprint,
  geometryProblems,
  type CampusBoundary,
  type MembershipResult,
} from '../geo/boundary.ts';
import { canonicalJson } from './canonical.ts';
import { createEnuFrame, lngLatToLocalPolygon } from './footprint.ts';
import { studioPublicLabel } from './labels.ts';
import { pointToPolygonM } from './planar.ts';
import {
  modelSupport,
  publishedStudioBuildingSchema,
  type AccuracyClass,
  type ModelEnvelope,
  type PublishedStudioBuilding,
  type StudioFootprint,
  type Verification,
} from './schema.ts';

export type StudioGeometrySource = GeometrySource | 'studio';
export type StudioHeightSource = HeightSource | 'studio-model';
export type MergedBuildingProps = Omit<BuildingProps, 'geometrySource' | 'renderHeightSource'> & {
  geometrySource: StudioGeometrySource;
  renderHeightSource: StudioHeightSource;
};
type BaseFeature = BuildingsFile['features'][number];
export type MergedBuildingFeature = Omit<BaseFeature, 'properties'> & { properties: MergedBuildingProps };
export interface MergedBuildingsFile {
  type: 'FeatureCollection';
  features: MergedBuildingFeature[];
}
export type StudioCampusData = Omit<CampusData, 'buildings'> & { buildings: MergedBuildingsFile };

/** What the 3D renderers draw for one published studio building (§11.2). */
export interface StudioRenderModel {
  /** targetId ?? id: the id of the feature, place, search doc, favourite and URL. */
  publicId: string;
  recordId: string;
  version: number;
  /** Authoritative public footprint (picking, 2D, fallback extrusion). */
  footprint: StudioFootprint;
  model: ModelEnvelope;
  /** false → draw footprint × body height (fallback prism); the admin quality view flags it. */
  modelAvailable: boolean;
  bodyBaseM: number;
  bodyTopM: number;
  verification: Verification;
  accuracyClass: AccuracyClass;
}

export interface StudioMergeReport {
  added: string[];
  modelled: string[];
  outside: string[];
  heldForReview: string[];
  orphan: string[];
  targetHidden: string[];
  shadowed: string[];
  unavailable: string[];
  correctionsIgnored: string[];
  invalid: MergeIssue[];
  invalidAccess: MergeIssue[];
}

export interface StudioMergeResult {
  data: StudioCampusData;
  /** Sorted by publicId. */
  studioModels: StudioRenderModel[];
  /** Ids the directory and search must exclude (directoryVisible: false); still drawn and selectable. */
  studioHiddenFromDirectory: string[];
  report: StudioMergeReport;
}

export interface StudioMergeInput {
  /** Campus data after mergePublication (overrides, locations, rule 4a). */
  data: CampusData;
  buildings: readonly PublishedStudioBuilding[];
  /** Base building ids hidden by a place override (MergeReport.removedBuildings). */
  hiddenTargets?: ReadonlySet<string>;
  reviewSections?: readonly BoundaryReviewSection[];
  curatedDecisions?: readonly CuratedMembershipDecision[];
  /** Defaults to the boundary built from data.boundary. */
  boundary?: CampusBoundary;
}

export const UNNAMED_STUDIO_BUILDING = 'Unnamed building (owner-placed model)';

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Total order among records sharing an id or target: newest version, then latest publishedAt, then content. */
function newestFirst(a: PublishedStudioBuilding, b: PublishedStudioBuilding): number {
  return (
    b.version - a.version ||
    byString(b.publishedAt, a.publishedAt) ||
    byString(canonicalJson(a), canonicalJson(b))
  );
}

const verificationStatusOf = (v: Verification) => (v.status === 'unverified' ? 'unverified' : 'verified');
const lastVerifiedOf = (v: Verification): string | null =>
  v.status === 'source-backed' ? v.citation.accessedOn : v.status === 'surveyed' ? v.surveyDate : null;

interface Membership {
  props: Pick<
    MergedBuildingProps,
    | 'campusStatus'
    | 'inCampusInventory'
    | 'insideFraction'
    | 'distanceToBoundaryM'
    | 'membershipMethod'
    | 'membershipReasonCode'
    | 'membershipReason'
    | 'membershipDecision'
    | 'membershipDecisionSource'
    | 'reviewSectionId'
    | 'pointAreaDisagreement'
    | 'areaM2'
  >;
  anchor: LngLat;
}

function membershipProps(m: MembershipResult, record: PublishedStudioBuilding | null): Membership | null {
  if (m.anchor === null || m.insideFraction === null) return null;
  const measured = {
    insideFraction: m.insideFraction,
    distanceToBoundaryM: m.distanceToBoundaryM,
    pointAreaDisagreement: m.pointAreaDisagreement,
    areaM2: m.areaM2,
  };
  if (m.status === 'inside' || m.status === 'crossing')
    return {
      anchor: m.anchor,
      props: {
        ...measured,
        campusStatus: m.status,
        inCampusInventory: true,
        membershipMethod: m.method,
        membershipReasonCode: m.reasonCode,
        membershipReason: m.reason,
        membershipDecision: m.decision,
        membershipDecisionSource: m.decisionSource,
        reviewSectionId: m.reviewSectionId,
      },
    };
  const pub = record?.membership;
  if (m.status === 'uncertain' && pub && pub.decision === 'curated' && pub.decisionSource !== null)
    return {
      anchor: m.anchor,
      props: {
        ...measured,
        campusStatus: pub.campusStatus,
        inCampusInventory: true,
        membershipMethod: 'curated-decision',
        membershipReasonCode: 'curated-decision',
        membershipReason: `Owner confirmation at publish (${pub.decisionSource}); measured ${round2(m.insideFraction * 100)} % inside. ${m.reason}`,
        membershipDecision: 'curated',
        membershipDecisionSource: pub.decisionSource,
        reviewSectionId: null,
      },
    };
  return null;
}

function recount(
  base: Manifest,
  places: readonly Place[],
  features: readonly MergedBuildingFeature[],
  relations: readonly Relation[],
): Manifest['counts'] {
  const c: Record<string, number> = { ...base.counts };
  const count = (pred: (p: Place) => boolean) => places.filter(pred).length;
  const inventory = features.filter((f) => f.properties.inCampusInventory);
  c.places = places.length;
  c.buildings = inventory.length;
  c['buildings:unnamed'] = inventory.filter((f) => f.properties.name === null).length;
  c.relations = relations.length;
  c['places:withoutLocation'] = count((p) => p.location === null);
  c['places:notConnected'] = count((p) => p.location !== null && p.graphNodeId === undefined);
  c['zone:on-campus'] = count((p) => p.campusZone === 'on-campus');
  c['zone:off-campus-nearby'] = count((p) => p.campusZone === 'off-campus-nearby');
  for (const cat of CATEGORIES) c[`category:${cat.id}`] = count((p) => p.categoryId === cat.id);
  for (const k of placeKindSchema.options) c[`kind:${k}`] = count((p) => p.kind === k);
  for (const h of ['osm-height', 'osm-levels-estimate', 'fallback', 'studio-model'])
    c[`heightSource:${h}`] = inventory.filter((f) => f.properties.renderHeightSource === h).length;
  for (const t of relationTypeSchema.options)
    c[`relation:${t}`] = relations.filter((r) => r.type === t).length;
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => byString(a, b)));
}

/** Access node check measured to the FOOTPRINT (0 inside it); same rule as locations (S7). */
function accessFor(
  b: PublishedStudioBuilding,
  nodes: readonly LngLat[],
  foot: ReadonlySet<number>,
  report: StudioMergeReport,
): { graphNodeId: number; connectorLengthM: number } | null {
  if (b.accessNodeId === null) return null;
  const node = nodes[b.accessNodeId];
  const fail = (reason: string, message: string) => {
    report.invalidAccess.push({ id: b.id, reason: `studio-${reason}`, message });
    return null;
  };
  if (!node) return fail('missing-node', `Path node ${b.accessNodeId} does not exist in the routing graph.`);
  if (!foot.has(b.accessNodeId))
    return fail('not-walkable', `Path node ${b.accessNodeId} is not on any walkable path.`);
  const anchor = b.footprint.coordinates[0]![0]!;
  const frame = createEnuFrame(anchor);
  const d = pointToPolygonM(frame.toLocal(node), lngLatToLocalPolygon(b.footprint.coordinates, frame));
  const maxM = APP_CONFIG.routing.maxPlaceConnectorM;
  if (!(d <= maxM))
    return fail(
      'too-far',
      `Path node ${b.accessNodeId} is ${Math.round(d)} m from the footprint; at most ${maxM} m.`,
    );
  return { graphNodeId: b.accessNodeId, connectorLengthM: round2(d) };
}

function renderModel(
  b: PublishedStudioBuilding,
  footprint: StudioFootprint,
  available: boolean,
): StudioRenderModel {
  return {
    publicId: b.targetId ?? b.id,
    recordId: b.id,
    version: b.version,
    footprint,
    model: b.model,
    modelAvailable: available,
    bodyBaseM: b.model.baseOffsetM,
    bodyTopM: b.model.baseOffsetM + b.model.heightM,
    verification: b.verification,
    accuracyClass: b.accuracyClass,
  };
}

export function mergeStudioBuildings(input: StudioMergeInput): StudioMergeResult {
  const { data } = input;
  const report: StudioMergeReport = {
    added: [],
    modelled: [],
    outside: [],
    heldForReview: [],
    orphan: [],
    targetHidden: [],
    shadowed: [],
    unavailable: [],
    correctionsIgnored: [],
    invalid: [],
    invalidAccess: [],
  };
  const boundary = input.boundary ?? boundaryFromFeatureCollection(data.boundary);
  const sections = input.reviewSections ?? [];
  const decisions = input.curatedDecisions ?? [];
  const hidden = input.hiddenTargets ?? new Set<string>();

  // 1. Schema and geometry checks (the server never publishes a failing record; the merge does not trust it).
  const valid: PublishedStudioBuilding[] = [];
  for (const raw of input.buildings) {
    const parsed = publishedStudioBuildingSchema.safeParse(raw);
    const id = typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : '(no id)';
    if (!parsed.success) {
      report.invalid.push({
        id,
        reason: 'schema',
        message: 'The record does not match the published studio building shape.',
      });
      continue;
    }
    const problems = geometryProblems(parsed.data.footprint);
    if (problems.length > 0) {
      report.invalid.push({ id, reason: 'geometry', message: `Invalid footprint: ${problems.join('; ')}.` });
      continue;
    }
    valid.push(parsed.data);
  }

  // 2. One record per id, then one per target (deterministic winners).
  const byId = new Map<string, PublishedStudioBuilding>();
  for (const b of [...valid].sort((x, y) => byString(x.id, y.id) || newestFirst(x, y))) {
    if (byId.has(b.id)) {
      if (report.shadowed.at(-1) !== b.id) report.shadowed.push(b.id);
      continue;
    }
    byId.set(b.id, b);
  }
  const byTarget = new Map<string, PublishedStudioBuilding>();
  for (const b of [...byId.values()]
    .filter((x) => x.targetId !== null)
    .sort((x, y) => byString(x.targetId!, y.targetId!) || newestFirst(x, y) || byString(x.id, y.id))) {
    if (byTarget.has(b.targetId!)) {
      report.shadowed.push(b.id);
      byId.delete(b.id);
      continue;
    }
    byTarget.set(b.targetId!, b);
  }

  const placeIds = new Set(data.places.map((p) => p.id));
  const features: MergedBuildingFeature[] = [...data.buildings.features];
  const featureIndex = new Map(features.map((f, i) => [f.properties.id, i]));
  const places: Place[] = [...data.places];
  const models: StudioRenderModel[] = [];
  const hiddenFromDirectory: string[] = [];
  const foot = new Set<number>();
  for (const e of data.graph.edges)
    if (e.foot) {
      foot.add(e.from);
      foot.add(e.to);
    }

  for (const b of [...byId.values()].sort((x, y) => byString(x.id, y.id))) {
    const available = modelSupport(b.model).ok;
    if (b.targetId === null) {
      if (placeIds.has(b.id) || featureIndex.has(b.id)) {
        report.shadowed.push(b.id);
        continue;
      }
      const m = classifyFootprint({ id: b.id, geometry: b.footprint }, boundary, sections, decisions);
      if (m.status === 'outside') {
        report.outside.push(b.id);
        continue;
      }
      const ms = membershipProps(m, b);
      if (!ms) {
        report.heldForReview.push(b.id);
        continue;
      }
      const identity = b.identity!;
      const verificationStatus = verificationStatusOf(b.verification);
      const lastVerifiedAt = lastVerifiedOf(b.verification);
      const surveyed = b.verification.status === 'surveyed';
      const displayName = identity.name ?? UNNAMED_STUDIO_BUILDING;
      features.push({
        type: 'Feature',
        id: b.id,
        geometry: { type: 'Polygon', coordinates: b.footprint.coordinates },
        properties: {
          id: b.id,
          name: identity.name,
          displayName,
          categoryId: identity.categoryId,
          geometrySource: 'studio',
          sourceId: 'owner',
          sourceRef: b.id,
          retrievedAt: b.publishedAt,
          verificationStatus,
          lastVerifiedAt,
          ...ms.props,
          areaM2: ms.props.areaM2 ?? b.footprintAreaM2,
          anchorLon: ms.anchor[0],
          anchorLat: ms.anchor[1],
          isBuildingPart: false,
          levels: null,
          levelsSource: null,
          minLevel: null,
          osmHeightM: null,
          osmMinHeightM: null,
          roofShape: null,
          roofMaterial: null,
          roofColour: null,
          roofLevels: null,
          buildingMaterial: null,
          buildingColour: null,
          fidelityLevel: surveyed ? 3 : 0,
          fidelityReason: surveyed
            ? `Model placed by the site owner from a site survey (${lastVerifiedAt}).`
            : 'Illustrative model placed by the site owner from a generic template; its height is not a measurement.',
          directoryKey: null,
          directoryCell: null,
          officialBlockLabel: null,
          officialBlockSourceId: null,
          renderHeightM: b.model.baseOffsetM + b.model.heightM,
          renderMinHeightM: b.model.baseOffsetM,
          renderHeightSource: 'studio-model',
        },
      });
      const access = accessFor(b, data.graph.nodes, foot, report);
      places.push({
        id: b.id,
        name: identity.name,
        displayName,
        aliases: [...identity.aliases],
        categoryId: identity.categoryId,
        ...(identity.subtype !== null ? { subcategory: identity.subtype } : {}),
        kind: 'building',
        location: ms.anchor,
        buildingId: b.id,
        campusZone: 'on-campus',
        ...(identity.description !== null ? { description: identity.description } : {}),
        wheelchair: 'unknown',
        ...(access ?? {}),
        provenance: {
          sourceId: 'owner',
          sourceRef: b.id,
          verificationStatus,
          ...(lastVerifiedAt !== null ? { lastVerifiedAt } : {}),
          notes: studioPublicLabel(b),
        },
      });
      if (!identity.directoryVisible) hiddenFromDirectory.push(b.id);
      models.push(renderModel(b, b.footprint, available));
      if (!available) report.unavailable.push(b.id);
      report.added.push(b.id);
      continue;
    }

    // Model of a base building.
    if (hidden.has(b.targetId)) {
      report.targetHidden.push(b.id);
      continue;
    }
    const idx = featureIndex.get(b.targetId);
    if (idx === undefined) {
      report.orphan.push(b.id);
      continue;
    }
    const baseFeature = features[idx]!;
    let next: MergedBuildingFeature = {
      ...baseFeature,
      properties: {
        ...baseFeature.properties,
        renderHeightM: b.model.baseOffsetM + b.model.heightM,
        renderMinHeightM: b.model.baseOffsetM,
        renderHeightSource: 'studio-model',
        fidelityLevel:
          b.verification.status === 'surveyed' && baseFeature.properties.verificationStatus === 'verified'
            ? 3
            : 0,
        fidelityReason: 'Height and shape drawn from a model placed by the site owner; not a measurement.',
      },
    };
    let footprint: StudioFootprint =
      baseFeature.geometry.type === 'Polygon'
        ? { type: 'Polygon', coordinates: baseFeature.geometry.coordinates as LngLat[][] }
        : b.footprint;
    let drawable = available;
    if (b.positionCorrected) {
      const m = classifyFootprint({ id: b.targetId, geometry: b.footprint }, boundary, sections, decisions);
      const ms = m.status === 'inside' || m.status === 'crossing' ? membershipProps(m, b) : null;
      if (ms) {
        next = {
          ...next,
          geometry: { type: 'Polygon', coordinates: b.footprint.coordinates },
          properties: { ...next.properties, ...ms.props, anchorLon: ms.anchor[0], anchorLat: ms.anchor[1] },
        };
        footprint = b.footprint;
      } else {
        // The model was fitted to the corrected footprint: draw the base footprint as a plain prism instead.
        report.correctionsIgnored.push(b.id);
        drawable = false;
      }
    }
    features[idx] = next;
    // The building's own place describes what is drawn: the owner model's illustrative height and its
    // S3 label (the base estimate never describes the drawn model; the model never passes as the real building).
    const label = studioPublicLabel(b);
    for (let i = 0; i < places.length; i++) {
      const p = places[i]!;
      if (p.kind !== 'building' || (p.buildingId ?? p.id) !== b.targetId) continue;
      const { heightM: _notDrawn, ...rest } = p;
      places[i] = {
        ...rest,
        heightSource: 'studio-model',
        provenance: {
          ...p.provenance,
          notes: p.provenance.notes ? `${p.provenance.notes} · ${label}` : label,
        },
      };
    }
    models.push(renderModel(b, footprint, drawable));
    if (!available) report.unavailable.push(b.id);
    report.modelled.push(b.id);
  }

  const sources =
    data.manifest.sources.some((s) => s.id === 'owner') || models.length === 0
      ? data.manifest.sources
      : [...data.manifest.sources, OWNER_SOURCE];
  const manifest: Manifest = {
    ...data.manifest,
    sources,
    counts: recount(data.manifest, places, features, data.relations),
  };
  return {
    data: { ...data, manifest, places, buildings: { type: 'FeatureCollection', features } },
    studioModels: models.sort((x, y) => byString(x.publicId, y.publicId)),
    studioHiddenFromDirectory: hiddenFromDirectory.sort(byString),
    report,
  };
}
