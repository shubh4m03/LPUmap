/**
 * Field-level helpers of the Studio inspector. Pure; every function returns
 * a new value and never mutates its input.
 *
 * Honesty: appearance presets are generic colour/material combinations
 * ("appearance only", APPEARANCE_LABEL); none describes a real LPU building.
 */
import { CATEGORIES } from '../../config/categories.ts';
import type { GraphFile, LngLat } from '../../data/schema.ts';
import { createEnuFrame, lngLatToLocalPolygon } from '../footprint.ts';
import { pointToPolygonM } from '../planar.ts';
import { containsProhibitedSourceUrl, isProhibitedSourceUrl, PROHIBITED_SOURCE_MESSAGE } from '../text.ts';
import {
  GENERATORS,
  PITCHED_ROOFS,
  STUDIO_CATEGORY_IDS,
  STUDIO_LIMITS,
  STUDIO_VALIDATION,
  studioDraftSchema,
  type Facade,
  type ModelConfigV1,
  type Roof,
  type RoofShape,
  type StudioDraft,
  type StudioIdentity,
  type VerificationDraft,
  type WindowPattern,
} from '../schema.ts';
import type { PlacementPreview } from '../editor-state.ts';

export interface FieldIssue {
  /** Dot path in the draft (e.g. 'identity.name'), '' for the whole draft. */
  path: string;
  message: string;
}

/**
 * Problems the server would answer with 400 (nothing stored): the strict
 * draft schema, including the prohibited-source rule. Empty = sendable.
 */
export function draftSchemaIssues(draft: StudioDraft): FieldIssue[] {
  const r = studioDraftSchema.safeParse(draft);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

/** Issues for one field path (and its children). */
export const issuesAt = (issues: readonly FieldIssue[], path: string): FieldIssue[] =>
  issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));

/** Registry label of a category; 'building' is the honest "Use not recorded". */
export function categoryLabel(id: string): string {
  if (id === 'building') return 'Use not recorded';
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** Categories a studio building may take (the registry minus 'other'), sorted by label. */
export const STUDIO_CATEGORY_OPTIONS: readonly { id: string; label: string }[] = STUDIO_CATEGORY_IDS.map(
  (id) => ({ id, label: categoryLabel(id) }),
).sort((a, b) => a.label.localeCompare(b.label, 'en'));

/** A new building's identity: no name (never invented), the template's suggested category. */
export function defaultIdentity(categoryId: string): StudioIdentity {
  return {
    name: null,
    aliases: [],
    categoryId: STUDIO_CATEGORY_IDS.includes(categoryId) ? categoryId : 'building',
    subtype: null,
    description: null,
    notes: null,
    directoryVisible: true,
  };
}

/** The draft a placement would create (for validating the preview before it is confirmed). */
export function placementDraft(p: PlacementPreview, categoryId: string): StudioDraft {
  return {
    identity: p.targetId ? null : defaultIdentity(categoryId),
    model: p.model,
    verification: { status: 'unverified' },
    accessNodeId: null,
    templateRef: p.templateRef,
    positionCorrection: null,
  };
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export interface HeightConflict {
  expectedM: number;
  heightM: number;
  message: string;
}

/** The validator's 'height-floors-conflict' rule, shown next to the fields while typing. */
export function heightFloorsConflict(
  m: Pick<ModelConfigV1, 'floors' | 'floorHeightM' | 'heightM'>,
): HeightConflict | null {
  const expected = Math.round(m.floors * m.floorHeightM * 100) / 100;
  const tol = Math.max(
    STUDIO_VALIDATION.heightTolerance.absM,
    STUDIO_VALIDATION.heightTolerance.floorFraction * m.floorHeightM,
  );
  if (Math.abs(expected - m.heightM) <= tol) return null;
  return {
    expectedM: expected,
    heightM: m.heightM,
    message: `${m.floors} floors × ${m.floorHeightM} m = ${expected} m, but the body height is ${m.heightM} m.`,
  };
}

export const DIMENSION_LABELS = {
  widthM: 'Width',
  lengthM: 'Length',
  heightM: 'Body height',
  floors: 'Floors',
  floorHeightM: 'Floor height',
  baseOffsetM: 'Base above ground',
} as const;

/** Publish range of a dimension, e.g. "2–300 m". */
export function publishRangeText(field: keyof typeof DIMENSION_LABELS): string {
  const r = STUDIO_LIMITS.dims[field];
  return field === 'floors' ? `${r.min}–${r.max}` : `${r.min}–${r.max} m`;
}

export function outsidePublishRange(field: keyof typeof DIMENSION_LABELS, value: number): boolean {
  const r = STUDIO_LIMITS.dims[field];
  return value < r.min || value > r.max;
}

// ---------------------------------------------------------------------------
// Roof and façade (only what the generator can build, S14)
// ---------------------------------------------------------------------------

export const DEFAULT_PITCH_DEG = 25;

export const roofOptions = (model: Pick<ModelConfigV1, 'generatorId'>): readonly RoofShape[] =>
  GENERATORS[model.generatorId].roofs;

/** Changes the roof shape, adding a default pitch for pitched roofs and removing it otherwise. */
export function withRoofShape(roof: Roof, shape: RoofShape): Roof {
  const { pitchDeg, ...rest } = roof;
  if (!PITCHED_ROOFS.includes(shape)) return { ...rest, shape };
  return { ...rest, shape, pitchDeg: pitchDeg ?? DEFAULT_PITCH_DEG };
}

export const DEFAULT_WINDOW_DENSITY = 0.4;

/** Changes the window pattern keeping the schema rule density = 0 ⇔ pattern 'none'. */
export function withWindowPattern(facade: Facade, pattern: WindowPattern): Facade {
  if (pattern === 'none') return { ...facade, windowPattern: 'none', windowDensity: 0 };
  return {
    ...facade,
    windowPattern: pattern,
    windowDensity: facade.windowDensity > 0 ? facade.windowDensity : DEFAULT_WINDOW_DENSITY,
  };
}

export interface AppearancePreset {
  id: string;
  label: string;
  facade: Pick<Facade, 'material' | 'wallColour'>;
  roof: Pick<Roof, 'material' | 'colour'>;
}

/** Generic appearance presets (appearance only; not a claim about any real building). */
export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  {
    id: 'light-plaster',
    label: 'Light plaster',
    facade: { material: 'plaster', wallColour: '#e8dcc8' },
    roof: { material: 'concrete', colour: '#b0a99f' },
  },
  {
    id: 'red-brick',
    label: 'Red brick',
    facade: { material: 'brick', wallColour: '#a5523a' },
    roof: { material: 'concrete', colour: '#8f8a84' },
  },
  {
    id: 'grey-concrete',
    label: 'Grey concrete',
    facade: { material: 'concrete', wallColour: '#a9a9a4' },
    roof: { material: 'membrane', colour: '#6f7378' },
  },
  {
    id: 'sandstone',
    label: 'Sandstone',
    facade: { material: 'stone', wallColour: '#d2b48c' },
    roof: { material: 'gravel', colour: '#9c958a' },
  },
  {
    id: 'glass-metal',
    label: 'Glass and metal',
    facade: { material: 'glass', wallColour: '#8fa9b8' },
    roof: { material: 'metal', colour: '#7d858c' },
  },
  {
    id: 'white-metal',
    label: 'White walls, metal roof',
    facade: { material: 'plaster', wallColour: '#f2f0ea' },
    roof: { material: 'metal', colour: '#5f7f8f' },
  },
];

export function applyPreset(model: ModelConfigV1, preset: AppearancePreset): ModelConfigV1 {
  return {
    ...model,
    facade: { ...model.facade, ...preset.facade },
    roof: { ...model.roof, ...preset.roof },
  };
}

/** Lower-case #rrggbb from a colour input, or null. */
export function normalizeColour(v: string): string | null {
  const s = v.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Verification (Google Maps / Earth / Street View are never a source, S6)
// ---------------------------------------------------------------------------

export function withVerificationStatus(
  v: VerificationDraft,
  status: VerificationDraft['status'],
): VerificationDraft {
  if (v.status === status) return v;
  const note = v.status === 'unverified' ? '' : v.note;
  if (status === 'unverified') return { status };
  if (status === 'source-backed') return { status, citation: { url: '', title: '', accessedOn: '' }, note };
  return { status, surveyDate: '', note };
}

/** The prohibited-source message for a URL or free text, or null. */
export function prohibitedSourceProblem(value: string, kind: 'url' | 'text'): string | null {
  if (!value.trim()) return null;
  const bad = kind === 'url' ? isProhibitedSourceUrl(value) : containsProhibitedSourceUrl(value);
  return bad ? PROHIBITED_SOURCE_MESSAGE : null;
}

/** Splits the aliases field ("one, two") into the stored list. */
export const parseAliases = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------
// Access point (S7: the owner chooses; a suggestion is only applied on request)
// ---------------------------------------------------------------------------

export interface AccessSuggestion {
  nodeId: number;
  /** Distance from the footprint (0 inside it), metres. */
  distanceM: number;
}

/** A walkable path node within the access-point limit of a footprint (a candidate, never a choice). */
export interface FootprintAccessCandidate extends AccessSuggestion {
  position: LngLat;
}

/**
 * Every walkable path node within `maxM` of a footprint — exactly the nodes
 * the server accepts as an access point (walkable, distance to the footprint,
 * 0 inside it) — nearest first, ties by node id. Candidates the owner may
 * choose from; nothing here chooses.
 */
export function walkableNodesNearFootprint(
  graph: Pick<GraphFile, 'nodes' | 'edges'>,
  footprint: readonly (readonly LngLat[])[],
  maxM: number,
  limit = Number.POSITIVE_INFINITY,
): FootprintAccessCandidate[] {
  const anchor = footprint[0]?.[0];
  if (!anchor) return [];
  const frame = createEnuFrame(anchor);
  const poly = lngLatToLocalPolygon(footprint, frame);
  const foot = new Set<number>();
  for (const e of graph.edges)
    if (e.foot) {
      foot.add(e.from);
      foot.add(e.to);
    }
  const out: (FootprintAccessCandidate & { exactM: number })[] = [];
  for (const id of foot) {
    const node = graph.nodes[id];
    if (!node) continue;
    const local = frame.toLocal(node);
    // Cheap reject before the exact distance.
    if (Math.hypot(local[0], local[1]) > maxM + 500) continue;
    const d = pointToPolygonM(local, poly);
    if (d <= maxM)
      out.push({ nodeId: id, distanceM: Math.round(d * 10) / 10, position: [node[0], node[1]], exactM: d });
  }
  out.sort((a, b) => (Math.abs(a.exactM - b.exactM) <= 1e-9 ? a.nodeId - b.nodeId : a.exactM - b.exactM));
  return out.slice(0, limit).map(({ exactM: _e, ...c }) => c);
}

/**
 * The walkable path node nearest to a footprint, as a SUGGESTION the owner
 * may accept (the server validates it; nothing is connected automatically).
 * Null when no walkable node is within `maxM`.
 */
export function nearestWalkableNode(
  graph: Pick<GraphFile, 'nodes' | 'edges'>,
  footprint: readonly (readonly LngLat[])[],
  maxM: number,
): AccessSuggestion | null {
  const best = walkableNodesNearFootprint(graph, footprint, maxM, 1)[0];
  return best ? { nodeId: best.nodeId, distanceM: best.distanceM } : null;
}
