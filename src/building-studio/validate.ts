/**
 * Building Studio validator (S6; docs/BUILDING_STUDIO_DESIGN.md §6). Pure,
 * deterministic and I/O-free; shared by the admin client and the server,
 * whose result is authoritative.
 *
 * Severities are fixed per code (VALIDATION_CODES):
 *  - error: publishing is blocked (a draft may still be SAVED with errors so
 *    no work is lost). Errors can never be acknowledged.
 *  - warning: publishing needs an explicit acknowledgement with a reason per
 *    code (`publishable`), recorded in the audit.
 *  - info: listed for review only. Nearby paths and entrances are NEVER a
 *    connection (S7): routing only ever uses an owner-chosen, server-checked
 *    access node.
 *
 * Geometry is never changed here: nothing is clipped, moved or resized.
 * Membership uses classifyFootprint (src/geo/boundary.ts); overlap and IoU
 * use its exact polygon clipper (createBoundary(other).intersectionAreaM2),
 * so concave, rotated, holed, touching and contained footprints are measured
 * exactly. Distances to paths, entrances and the access node are measured to
 * the FOOTPRINT polygon (0 inside it) in the local metre frame at the anchor.
 * Issues are ordered by code (VALIDATION_CODE_LIST order: errors, warnings,
 * info), then path; ties keep their (deterministic) discovery order.
 */
import { APP_CONFIG } from '../config/index.ts';
import type {
  BoundaryReviewSection,
  BuildingsFile,
  CuratedMembershipDecision,
  GraphFile,
  LngLat,
  Place,
} from '../data/schema.ts';
import {
  classifyFootprint,
  createBoundary,
  geometryProblems,
  type CampusBoundary,
  type MembershipResult,
  type PolygonalGeometry,
} from '../geo/boundary.ts';
import { createEnuFrame, deriveFootprint, lngLatToLocalPolygon, type FootprintResult } from './footprint.ts';
import type { LocalPolygon, Vec2 } from './mesh/types.ts';
import { pointToPolygonM, segmentToPolygonM } from './planar.ts';
import {
  missingAcknowledgements,
  modelSupport,
  STUDIO_CATEGORY_IDS,
  STUDIO_LIMITS,
  STUDIO_VALIDATION,
  VALIDATION_CODE_LIST,
  VALIDATION_CODES,
  verificationSchema,
  type Acknowledgement,
  type PublishedStudioBuilding,
  type StudioDraft,
  type StudioMembership,
  type TemplateDefinition,
  type ValidationCode,
  type ValidationIssue,
  type ValidationResult,
  type WarningCode,
} from './schema.ts';
import { templateRangeIssues } from './template-compat.ts';

export { pointToPolygonM } from './planar.ts';
import { containsProhibitedSourceUrl, PROHIBITED_SOURCE_MESSAGE } from './text.ts';

export interface StudioValidationContext {
  base: {
    /** Inventory + uncertain footprints (public/data buildings.geojson). */
    buildings: Pick<BuildingsFile, 'features'>;
    places: readonly Place[];
    graph: Pick<GraphFile, 'nodes' | 'edges'>;
    boundary: CampusBoundary;
    reviewSections: readonly BoundaryReviewSection[];
    curatedDecisions: readonly CuratedMembershipDecision[];
  };
  /** Published, non-archived studio buildings (for overlap/duplicate checks). */
  published: readonly PublishedStudioBuilding[];
  /** Template version the draft references, when resolvable (for 'outside-template-range'). */
  template: TemplateDefinition | null;
  /** The record being edited (excluded from its own checks), or null. */
  recordId: string | null;
  /** Base building a model belongs to, or null for a new building. */
  targetId: string | null;
  /** YYYY-MM-DD (server clock); evidence dates after it are rejected. */
  today: string;
}

/** Most nearby paths / entrances listed (nearest first). */
export const MAX_NEARBY_LISTED = 10;

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const pct = (f: number) => `${round(f * 100, 1)}`;
const clip = (s: string) => (s.length <= 500 ? s : `${s.slice(0, 499)}…`);

// ---------------------------------------------------------------------------
// Bounding boxes (lon/lat)
// ---------------------------------------------------------------------------

type BBox = [number, number, number, number];

function bboxOf(coords: readonly (readonly LngLat[])[]): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of coords)
    for (const [x, y] of ring) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  return [w, s, e, n];
}

const bboxesTouch = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// ---------------------------------------------------------------------------
// Footprint resolution (shared with the server)
// ---------------------------------------------------------------------------

/** The base feature a record targets, or null. */
export function baseFeatureOf(buildings: Pick<BuildingsFile, 'features'>, targetId: string | null) {
  if (targetId === null) return null;
  return buildings.features.find((f) => f.properties.id === targetId) ?? null;
}

/** Polygon coordinates of a base feature (MultiPolygon features are not modelled), or null. */
export function polygonCoordsOf(geometry: { type: string; coordinates: unknown }): LngLat[][] | null {
  return geometry.type === 'Polygon' ? (geometry.coordinates as LngLat[][]) : null;
}

/**
 * The footprint the server stores for a draft (S5): derived from the model;
 * for a 'footprint-prism' model the base building's footprint unchanged.
 */
export function studioFootprintFor(
  draft: Pick<StudioDraft, 'model'>,
  targetId: string | null,
  buildings: Pick<BuildingsFile, 'features'>,
): FootprintResult {
  const feature = baseFeatureOf(buildings, targetId);
  const baseFootprint = feature ? polygonCoordsOf(feature.geometry) : null;
  return deriveFootprint(draft.model, baseFootprint ? { baseFootprint } : {});
}

/**
 * Membership stored at publish (§6.4) from the classification of the
 * published footprint; null when it cannot publish ('outside' or invalid).
 * 'uncertain' publishes only through an acknowledged 'boundary-uncertain'
 * warning and is stored as an owner confirmation.
 */
export function membershipForPublish(
  m: MembershipResult,
  record: { id: string; version: number },
): StudioMembership | null {
  if (m.insideFraction === null || m.distanceToBoundaryM === null) return null;
  const measured = { insideFraction: m.insideFraction, distanceToBoundaryM: m.distanceToBoundaryM };
  if (m.status === 'inside' || m.status === 'crossing')
    return {
      campusStatus: m.status,
      ...measured,
      reasonCode: m.reasonCode,
      decision: m.decision,
      decisionSource: m.decision === 'curated' ? (m.decisionSource ?? 'curated decision') : null,
    };
  if (m.status === 'uncertain' && m.reasonCode !== 'invalid-geometry')
    return {
      campusStatus: 'crossing',
      ...measured,
      reasonCode: 'curated-decision',
      decision: 'curated',
      decisionSource: `owner-confirmation: studio ${record.id} v${record.version}`,
    };
  return null;
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const CODE_ORDER = new Map(VALIDATION_CODE_LIST.map((c, i) => [c, i]));

/** Sorts issues (code, then path) and computes counts and required acknowledgements. */
export function validationResult(issues: readonly ValidationIssue[]): ValidationResult {
  const sorted = issues
    .map((issue, i) => ({ issue, i }))
    .sort(
      (a, b) =>
        CODE_ORDER.get(a.issue.code)! - CODE_ORDER.get(b.issue.code)! ||
        byString(a.issue.path ?? '', b.issue.path ?? '') ||
        a.i - b.i,
    )
    .map((x) => x.issue);
  const errorCount = sorted.filter((i) => i.severity === 'error').length;
  const warningCodes = [
    ...new Set(sorted.filter((i) => i.severity === 'warning').map((i) => i.code as WarningCode)),
  ];
  return {
    issues: sorted,
    errorCount,
    warningCount: sorted.filter((i) => i.severity === 'warning').length,
    publishable: errorCount === 0,
    requiredAcknowledgements: warningCodes,
  };
}

export interface PublishCheck {
  /** No errors and every warning code acknowledged. */
  ok: boolean;
  errorCount: number;
  missingAcknowledgements: WarningCode[];
  /** Acknowledgements for codes that are present (the others are ignored and never recorded). */
  relevantAcknowledgements: Acknowledgement[];
}

/** Whether a validation result may publish with these acknowledgements (§6.3). */
export function publishable(
  result: ValidationResult,
  acknowledgements: readonly Acknowledgement[],
): PublishCheck {
  const missing = missingAcknowledgements(result.requiredAcknowledgements, acknowledgements);
  const required = new Set(result.requiredAcknowledgements);
  return {
    ok: result.errorCount === 0 && missing.length === 0,
    errorCount: result.errorCount,
    missingAcknowledgements: missing,
    relevantAcknowledgements: acknowledgements.filter((a) => required.has(a.code)),
  };
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

/** Validates a draft against the current base data and published studio buildings. Never throws. */
export function validateStudioDraft(draft: StudioDraft, ctx: StudioValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (
    code: ValidationCode,
    message: string,
    path: string | null,
    data: ValidationIssue['data'] = {},
  ) => issues.push({ code, severity: VALIDATION_CODES[code], message: clip(message), path, data });
  const isNew = ctx.targetId === null;
  const model = draft.model;

  // --- record kind and identity
  if (isNew) {
    if (draft.identity === null)
      add('identity-required', 'A new building needs a category (the name may stay empty).', 'identity');
    if (draft.positionCorrection !== null)
      add('not-applicable', 'positionCorrection does not apply to a new building.', 'positionCorrection', {
        field: 'positionCorrection',
      });
    if (model.generatorId === 'footprint-prism')
      add(
        'not-applicable',
        "The 'footprint-prism' generator does not apply to a new building (it extrudes an existing footprint).",
        'model.generatorId',
        { field: 'model.generatorId' },
      );
  } else {
    if (draft.identity !== null)
      add(
        'not-applicable',
        'identity does not apply to a model of an existing building: its name, category and description stay in the place override.',
        'identity',
        { field: 'identity' },
      );
    if (draft.accessNodeId !== null)
      add(
        'not-applicable',
        'accessNodeId does not apply to a model of an existing building: its access stays in the place override.',
        'accessNodeId',
        { field: 'accessNodeId' },
      );
    if (draft.positionCorrection !== null && model.generatorId === 'footprint-prism')
      add(
        'not-applicable',
        "A corrected position needs a generated footprint; 'footprint-prism' keeps the mapped one.",
        'model.generatorId',
        { field: 'model.generatorId' },
      );
  }
  if (draft.identity && !STUDIO_CATEGORY_IDS.includes(draft.identity.categoryId))
    add(
      'unknown-category',
      `Category ${draft.identity.categoryId} is not in the registry.`,
      'identity.categoryId',
      {
        id: draft.identity.categoryId,
      },
    );

  // --- verification evidence (S3)
  const v = draft.verification;
  if (v.status !== 'unverified') {
    if (!verificationSchema.safeParse(v).success)
      add(
        'verification-evidence',
        v.status === 'source-backed'
          ? 'Source-backed needs a citation URL, title, access date and a note.'
          : 'Surveyed needs a survey date and a note.',
        'verification',
        { status: v.status },
      );
    const date = v.status === 'source-backed' ? v.citation.accessedOn : v.surveyDate;
    if (date !== '' && date > ctx.today)
      add('verification-evidence', `${date} is in the future.`, 'verification', { date, today: ctx.today });
    const texts = v.status === 'source-backed' ? [v.citation.url, v.citation.title, v.note] : [v.note];
    if (texts.some((t) => containsProhibitedSourceUrl(t)))
      add('verification-evidence', PROHIBITED_SOURCE_MESSAGE, 'verification', { status: v.status });
  }

  // --- model support (S2): never reinterpret an unknown model
  const support = modelSupport(model);
  if (!support.ok) {
    add(
      'unsupported-model',
      `This model needs generator ${String((model as { generatorId?: unknown }).generatorId)} v${String((model as { generatorVersion?: unknown }).generatorVersion)}, which this version of the app does not have.`,
      'model',
      { reason: support.reason },
    );
    return validationResult(issues);
  }

  // --- dimensions (publish ranges)
  const dims = STUDIO_LIMITS.dims;
  for (const field of ['widthM', 'lengthM', 'heightM', 'floors', 'floorHeightM', 'baseOffsetM'] as const) {
    if (model.generatorId === 'footprint-prism' && (field === 'widthM' || field === 'lengthM')) continue; // informational
    const value = model[field];
    const { min, max } = dims[field];
    if (value < min || value > max)
      add('dimension-out-of-range', `${field} is ${value}; allowed ${min}–${max}.`, `model.${field}`, {
        field,
        value,
        min,
        max,
      });
  }
  if (
    model.roof.pitchDeg !== undefined &&
    (model.roof.pitchDeg < dims.pitchDeg.min || model.roof.pitchDeg > dims.pitchDeg.max)
  )
    add(
      'dimension-out-of-range',
      `roof.pitchDeg is ${model.roof.pitchDeg}; allowed ${dims.pitchDeg.min}–${dims.pitchDeg.max}.`,
      'model.roof.pitchDeg',
      { field: 'roof.pitchDeg', value: model.roof.pitchDeg, min: dims.pitchDeg.min, max: dims.pitchDeg.max },
    );
  const h = STUDIO_VALIDATION.heightTolerance;
  const fromFloors = model.floors * model.floorHeightM;
  if (Math.abs(fromFloors - model.heightM) > Math.max(h.absM, h.floorFraction * model.floorHeightM))
    add(
      'height-floors-conflict',
      `${model.floors} floors × ${model.floorHeightM} m = ${round(fromFloors)} m, but the body height is ${model.heightM} m.`,
      'model.heightM',
      {
        floors: model.floors,
        floorHeightM: model.floorHeightM,
        fromFloorsM: round(fromFloors),
        heightM: model.heightM,
      },
    );
  if (
    ctx.template &&
    draft.templateRef?.templateId === ctx.template.id &&
    draft.templateRef.templateVersion === ctx.template.version
  )
    issues.push(...templateRangeIssues(model, ctx.template));
  if (model.geometryGuide)
    add(
      'geometry-guide',
      `Placed using unverified detected footprint ${model.geometryGuide.detectionId}; the building stays unverified until confirmed.`,
      'model.geometryGuide',
      { detectionId: model.geometryGuide.detectionId },
    );

  // --- base target
  const target = baseFeatureOf(ctx.base.buildings, ctx.targetId);
  const targetCoords = target ? polygonCoordsOf(target.geometry) : null;
  if (!isNew && !target)
    add('base-target-missing', `${ctx.targetId} is not in the current base dataset.`, 'targetId', {
      targetId: ctx.targetId,
    });
  if (target && !targetCoords)
    add(
      'geometry-invalid',
      `The derived footprint is not a valid polygon: ${ctx.targetId} has a multi-part footprint.`,
      'targetId',
    );
  if (!isNew && draft.positionCorrection)
    add(
      'base-footprint-replaced',
      `Correct position: the published footprint replaces ${ctx.targetId}'s mapped footprint (reason: ${draft.positionCorrection.reason}).`,
      'positionCorrection',
      { targetId: ctx.targetId, reason: draft.positionCorrection.reason },
    );

  // --- footprint
  if (model.generatorId === 'footprint-prism' && !targetCoords) return validationResult(issues);
  const fp = deriveFootprint(model, targetCoords ? { baseFootprint: targetCoords } : {});
  if (!fp.ok) {
    add('geometry-invalid', `The derived footprint is not a valid polygon: ${fp.message}`, 'model', {
      reason: fp.reason,
    });
    return validationResult(issues);
  }
  const geom: PolygonalGeometry = fp.footprint;
  const vertices = fp.footprint.coordinates.reduce((n, r) => n + r.length, 0);
  const problems = geometryProblems(geom);
  if (
    vertices > STUDIO_LIMITS.maxFootprintVertices ||
    fp.footprint.coordinates.length > STUDIO_LIMITS.maxFootprintRings
  )
    problems.push(
      `${vertices} vertices in ${fp.footprint.coordinates.length} rings (at most ${STUDIO_LIMITS.maxFootprintVertices} in ${STUDIO_LIMITS.maxFootprintRings})`,
    );
  if (problems.length > 0) {
    add(
      'geometry-invalid',
      `The derived footprint is not a valid polygon: ${problems.join('; ')}.`,
      'model',
      {
        problems: problems.slice(0, 10),
      },
    );
    return validationResult(issues);
  }

  const [w, s, e, n] = APP_CONFIG.map.maxBounds;
  if (fp.footprint.coordinates.some((ring) => ring.some(([x, y]) => x < w || x > e || y < s || y > n)))
    add('outside-max-bounds', 'Part of the building lies outside the map area.', 'model.anchor');

  // --- campus membership
  const publicId = ctx.targetId ?? ctx.recordId ?? 'stu:draft';
  const m = classifyFootprint(
    { id: publicId, geometry: geom },
    ctx.base.boundary,
    ctx.base.reviewSections,
    ctx.base.curatedDecisions,
  );
  const f = m.insideFraction ?? 0;
  if (m.status === 'outside')
    add(
      'outside-campus',
      `The footprint is outside the campus boundary (${pct(f)} % inside). Off-campus buildings are not shown (owner decision 2).`,
      'model.anchor',
      { insideFraction: f },
    );
  else if (m.status === 'crossing')
    add(
      'boundary-crossing',
      `The footprint crosses the campus boundary (${pct(f)} % inside).`,
      'model.anchor',
      {
        insideFraction: f,
      },
    );
  else if (m.status === 'uncertain')
    add('boundary-uncertain', `Campus membership is uncertain: ${m.reason}`, 'model.anchor', {
      membershipReason: m.reasonCode,
      reviewSectionId: m.reviewSectionId,
      insideFraction: f,
    });

  // --- fit to the base footprint
  const mineArea = fp.areaM2;
  if (target && targetCoords && model.generatorId !== 'footprint-prism' && !draft.positionCorrection) {
    const iou = iouWith(targetCoords, geom);
    if (iou === null || iou < STUDIO_VALIDATION.baseFitMinIoU)
      add(
        'base-fit-mismatch',
        `The model covers the existing footprint with IoU ${iou === null ? 'unknown' : round(iou)} (needs ≥ ${STUDIO_VALIDATION.baseFitMinIoU}).`,
        'model',
        { iou: iou === null ? null : round(iou, 4), min: STUDIO_VALIDATION.baseFitMinIoU },
      );
  }

  // --- overlaps and duplicates
  const mineBox = bboxOf(fp.footprint.coordinates);
  const correctedTargets = new Set(
    ctx.published.filter((b) => b.targetId !== null && b.positionCorrected).map((b) => b.targetId!),
  );
  interface Candidate {
    kind: 'base' | 'studio';
    id: string;
    label: string;
    coords: LngLat[][];
  }
  const candidates: Candidate[] = [];
  for (const feat of ctx.base.buildings.features) {
    const id = feat.properties.id;
    if (id === ctx.targetId || correctedTargets.has(id)) continue;
    const coords = polygonCoordsOf(feat.geometry);
    if (!coords) continue;
    const p = feat.properties;
    candidates.push({ kind: 'base', id, label: p.name ?? p.directoryKey ?? p.displayName, coords });
  }
  for (const b of [...ctx.published].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (b.id === ctx.recordId || (ctx.targetId !== null && b.targetId === ctx.targetId)) continue;
    if (b.targetId !== null && !b.positionCorrected) continue; // drawn on its base footprint, checked above
    candidates.push({
      kind: 'studio',
      id: b.targetId ?? b.id,
      label: b.identity?.name ?? b.targetId ?? b.id,
      coords: b.footprint.coordinates,
    });
  }
  for (const c of candidates) {
    if (!bboxesTouch(mineBox, bboxOf(c.coords))) continue;
    const o = overlapWith(c.coords, geom);
    if (!o || o.intersection <= 0) continue;
    const iou = o.intersection / (mineArea + o.otherArea - o.intersection);
    const smaller = Math.min(mineArea, o.otherArea);
    if (iou >= STUDIO_VALIDATION.duplicateIoU)
      add(
        'possible-duplicate',
        `May be the same structure as ${c.id} (${c.label}) (IoU ${round(iou)}).`,
        'model',
        {
          id: c.id,
          kind: c.kind,
          iou: round(iou, 4),
          overlapM2: round(o.intersection),
        },
      );
    else if (
      o.intersection >= STUDIO_VALIDATION.overlapMinM2 &&
      o.intersection >= STUDIO_VALIDATION.overlapMinFraction * smaller
    )
      add(
        c.kind === 'base' ? 'overlap-base-building' : 'overlap-studio-building',
        `Overlaps ${c.id} (${c.label}) by ${round(o.intersection, 1)} m² (${pct(o.intersection / smaller)} % of the smaller footprint).`,
        'model',
        { id: c.id, overlapM2: round(o.intersection), fraction: round(o.intersection / smaller, 4) },
      );
  }

  // --- access (S7) and nearby features (info, never a connection)
  const frame = createEnuFrame(model.anchor);
  const local = lngLatToLocalPolygon(fp.footprint.coordinates, frame);
  const nodes = ctx.base.graph.nodes;
  if (isNew) {
    if (draft.accessNodeId === null)
      add('not-routable', 'No access point: directions will not be offered.', 'accessNodeId');
    else checkAccess(draft.accessNodeId, nodes, ctx.base.graph.edges, local, frame, add);
  }
  const near = STUDIO_VALIDATION.nearbyM;
  const [lx0, ly0, lx1, ly1] = localBox(local);
  const projected = new Map<number, Vec2>();
  const nodeXY = (i: number): Vec2 | null => {
    if (!projected.has(i)) {
      const p = nodes[i];
      if (!p) return null;
      projected.set(i, frame.toLocal(p));
    }
    return projected.get(i)!;
  };
  const paths: { id: number; d: number; highway: string; name: string | null }[] = [];
  for (const edge of ctx.base.graph.edges) {
    if (!edge.foot) continue;
    const a = nodeXY(edge.from);
    const b = nodeXY(edge.to);
    if (!a || !b) continue;
    if (Math.max(a[0], b[0]) < lx0 - near || Math.min(a[0], b[0]) > lx1 + near) continue;
    if (Math.max(a[1], b[1]) < ly0 - near || Math.min(a[1], b[1]) > ly1 + near) continue;
    const d = segmentToPolygonM(a, b, local);
    if (d <= near) paths.push({ id: edge.id, d, highway: edge.highway, name: edge.name });
  }
  for (const p of paths.sort((x, y) => x.d - y.d || x.id - y.id).slice(0, MAX_NEARBY_LISTED))
    add(
      'nearby-path',
      `Path segment ${p.id} is ${round(p.d, 1)} m away — for review, not a connection.`,
      null,
      {
        edgeId: p.id,
        distanceM: round(p.d),
        highway: p.highway,
        name: p.name,
      },
    );
  const entrances: { id: string; d: number }[] = [];
  for (const place of ctx.base.places) {
    if (place.kind !== 'entrance' || !place.location) continue;
    const d = pointToPolygonM(frame.toLocal(place.location), local);
    if (d <= near) entrances.push({ id: place.id, d });
  }
  for (const en of entrances.sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : 1)).slice(0, MAX_NEARBY_LISTED))
    add(
      'nearby-entrance',
      `Entrance ${en.id} is ${round(en.d, 1)} m away — for review, not a connection.`,
      null,
      {
        id: en.id,
        distanceM: round(en.d),
      },
    );

  return validationResult(issues);
}

function localBox(poly: LocalPolygon): [number, number, number, number] {
  const xs = poly.flatMap((r) => r.map((p) => p[0]));
  const ys = poly.flatMap((r) => r.map((p) => p[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Exact intersection with another footprint (src/geo clipper), or null when the other geometry is invalid. */
function overlapWith(
  other: LngLat[][],
  mine: PolygonalGeometry,
): { intersection: number; otherArea: number } | null {
  try {
    const b = createBoundary({ type: 'Polygon', coordinates: other });
    return { intersection: b.intersectionAreaM2(mine), otherArea: b.areaM2 };
  } catch {
    return null;
  }
}

/** Intersection over union of two footprints, or null when either is invalid. */
export function iouWith(other: LngLat[][], mine: PolygonalGeometry): number | null {
  try {
    const b = createBoundary({ type: 'Polygon', coordinates: other });
    const i = b.intersectionAreaM2(mine);
    const a = b.areaOf(mine);
    return i / (a + b.areaM2 - i);
  } catch {
    return null;
  }
}

function checkAccess(
  nodeId: number,
  nodes: readonly LngLat[],
  edges: GraphFile['edges'],
  local: LocalPolygon,
  frame: ReturnType<typeof createEnuFrame>,
  add: (code: ValidationCode, message: string, path: string | null, data?: ValidationIssue['data']) => void,
): void {
  const node = Number.isInteger(nodeId) && nodeId >= 0 ? nodes[nodeId] : undefined;
  const maxM = APP_CONFIG.routing.maxPlaceConnectorM;
  if (!node) {
    add('access-node-invalid', `Path node ${nodeId} does not exist in the routing graph.`, 'accessNodeId', {
      nodeId,
      reason: 'missing-node',
    });
    return;
  }
  if (!edges.some((e) => e.foot && (e.from === nodeId || e.to === nodeId))) {
    add(
      'access-node-invalid',
      `Path node ${nodeId} is not on any walkable path, so it cannot be an access point.`,
      'accessNodeId',
      { nodeId, reason: 'not-walkable' },
    );
    return;
  }
  const d = pointToPolygonM(frame.toLocal(node), local);
  if (!(d <= maxM))
    add(
      'access-node-invalid',
      `Path node ${nodeId} is ${Math.round(d)} m from the footprint; an access point must be within ${maxM} m.`,
      'accessNodeId',
      { nodeId, reason: 'too-far', distanceM: round(d), maxM },
    );
}
