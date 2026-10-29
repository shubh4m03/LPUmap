/**
 * Template and generator compatibility (S2, docs/BUILDING_STUDIO_DESIGN.md
 * §3.3, §7 "Apply template", §12). Pure; never mutates its inputs.
 *
 *  - studioMeshFor: the mesh a renderer draws for a published record. A model
 *    this build cannot generate (unknown modelConfigVersion / generator /
 *    generator version, or a generator failure) is NEVER dropped: it renders
 *    as the stored footprint × body height (fallbackPrismMesh) and is flagged
 *    "model unavailable".
 *  - templateAvailability: what the library can say about an instance's
 *    template reference. An instance never needs its template to render.
 *  - applyTemplateVersion: the explicit "apply template vN" preview. It
 *    replaces only generator, shape, roof, facade and detail level from the
 *    chosen variant, keeps placement, dimensions, identity, verification,
 *    access and correction, and reports values outside the new template's
 *    guidance as 'outside-template-range' warnings — nothing is clamped.
 */
import type { LngLat } from '../data/index.ts';
import type { MeshCache } from './mesh/cache.ts';
import { fallbackPrismMesh, generateStudioMeshDetailed } from './mesh/generate.ts';
import type { StudioMesh } from './mesh/types.ts';
import {
  modelSupport,
  type ModelConfigV1,
  type ModelEnvelope,
  type StudioDraft,
  type StudioFootprint,
  type TemplateDefinition,
  type TemplateRef,
  type ValidationIssue,
} from './schema.ts';

export type ModelUnavailableReason =
  'unknown-model-config-version' | 'unknown-generator' | 'unknown-generator-version' | 'invalid-config';

export const MODEL_UNAVAILABLE_LABEL = 'Model unavailable — shown as a plain block';

export interface RenderableMesh {
  mesh: StudioMesh;
  /** false → the fallback prism is drawn and the admin quality view flags "model unavailable". */
  modelAvailable: boolean;
  unavailableReason: ModelUnavailableReason | null;
  message: string | null;
}

/**
 * The mesh to draw for a published record (S2). The base footprint of a
 * 'footprint-prism' model is the record's own published footprint.
 */
export function studioMeshFor(
  record: { footprint: StudioFootprint; model: ModelEnvelope },
  opts: { cache?: MeshCache } = {},
): RenderableMesh {
  const support = modelSupport(record.model);
  if (!support.ok)
    return {
      mesh: fallbackPrismMesh(record),
      modelAvailable: false,
      unavailableReason: support.reason,
      message: support.message,
    };
  const genOpts = { baseFootprint: record.footprint.coordinates as readonly (readonly LngLat[])[] };
  const r = opts.cache
    ? opts.cache.get(support.config, genOpts)
    : generateStudioMeshDetailed(support.config, genOpts);
  if (!r.ok)
    return {
      mesh: fallbackPrismMesh(record),
      modelAvailable: false,
      unavailableReason: 'invalid-config',
      message: r.message,
    };
  return { mesh: r.mesh, modelAvailable: true, unavailableReason: null, message: null };
}

export type TemplateAvailability =
  | { status: 'none'; label: null }
  | { status: 'available'; label: null; definition: TemplateDefinition }
  | { status: 'retired'; label: string; definition: TemplateDefinition }
  | { status: 'missing-template' | 'missing-version' | 'missing-variant'; label: string };

export const TEMPLATE_UNAVAILABLE_LABEL = 'Template no longer available';

/**
 * Looks up an instance's template reference among the library listings
 * (code + owner templates, each with all its versions). The instance keeps
 * rendering whatever the answer is.
 */
export function templateAvailability(
  ref: TemplateRef | null,
  listings: readonly { definitions: readonly TemplateDefinition[]; status: 'active' | 'retired' }[],
): TemplateAvailability {
  if (!ref) return { status: 'none', label: null };
  const listing = listings.find((l) => l.definitions.some((d) => d.id === ref.templateId));
  if (!listing) return { status: 'missing-template', label: TEMPLATE_UNAVAILABLE_LABEL };
  const definition = listing.definitions.find(
    (d) => d.id === ref.templateId && d.version === ref.templateVersion,
  );
  if (!definition)
    return {
      status: 'missing-version',
      label: `${TEMPLATE_UNAVAILABLE_LABEL} (version ${ref.templateVersion})`,
    };
  if (!definition.variants.some((v) => v.id === ref.variantId))
    return { status: 'missing-variant', label: `${TEMPLATE_UNAVAILABLE_LABEL} (variant ${ref.variantId})` };
  if (listing.status === 'retired')
    return { status: 'retired', label: 'Template retired: hidden from new placements', definition };
  return { status: 'available', label: null, definition };
}

const issue = (
  field: string,
  value: string | number | boolean,
  guidance: string,
  data: ValidationIssue['data'],
): ValidationIssue => ({
  code: 'outside-template-range',
  severity: 'warning',
  message: `${field} ${value} is outside the template's guidance ${guidance}.`,
  path: `model.${field}`,
  data: { field, ...data },
});

/** 'outside-template-range' warnings of a model against a template's constraints (guidance only). */
export function templateRangeIssues(model: ModelConfigV1, template: TemplateDefinition): ValidationIssue[] {
  const c = template.constraints;
  const out: ValidationIssue[] = [];
  for (const k of ['widthM', 'lengthM', 'heightM', 'floors'] as const) {
    const v = model[k];
    if (v < c[k].min || v > c[k].max)
      out.push(issue(k, v, `${c[k].min}–${c[k].max}`, { value: v, min: c[k].min, max: c[k].max }));
  }
  if (!c.roofShapes.includes(model.roof.shape))
    out.push(
      issue('roof.shape', model.roof.shape, `(${c.roofShapes.join(', ')})`, {
        value: model.roof.shape,
        allowed: [...c.roofShapes],
      }),
    );
  if (!c.windowPatterns.includes(model.facade.windowPattern))
    out.push(
      issue('facade.windowPattern', model.facade.windowPattern, `(${c.windowPatterns.join(', ')})`, {
        value: model.facade.windowPattern,
        allowed: [...c.windowPatterns],
      }),
    );
  if (model.facade.balconies && !c.balconiesAllowed)
    out.push(issue('facade.balconies', true, '(no balconies)', { value: true }));
  return out;
}

/** Dot paths of every leaf that differs between two JSON values (prefix included). */
export function changedPaths(before: unknown, after: unknown, prefix: string): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => changedPaths(before[k], after[k], `${prefix}.${k}`));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix];
}

export type ApplyTemplateResult =
  | {
      ok: true;
      /** The previewed draft (a new object; the input is unchanged). */
      draft: StudioDraft;
      /** Dot paths the template changed, for the before/after preview. */
      changedFields: string[];
      /** Values outside the new template's guidance (warnings, never clamped). */
      rangeIssues: ValidationIssue[];
    }
  | { ok: false; reason: 'variant-not-found' | 'unsupported-model'; message: string };

/** "Apply template vN" preview (see the module comment). Explicit only; never applied silently. */
export function applyTemplateVersion(
  draft: StudioDraft,
  template: TemplateDefinition,
  variantId: string,
): ApplyTemplateResult {
  const variant = template.variants.find((v) => v.id === variantId);
  if (!variant)
    return {
      ok: false,
      reason: 'variant-not-found',
      message: `Template ${template.id} v${template.version} has no variant '${variantId}'.`,
    };
  const before = structuredClone(draft);
  const d = structuredClone(variant.defaults);
  const model: ModelConfigV1 = {
    ...before.model,
    generatorId: d.generatorId,
    generatorVersion: d.generatorVersion,
    shape: d.shape,
    roof: d.roof,
    facade: d.facade,
    detailLevel: d.detailLevel,
  };
  const support = modelSupport(model);
  if (!support.ok) return { ok: false, reason: 'unsupported-model', message: support.message };
  const next: StudioDraft = {
    ...before,
    model,
    templateRef: { templateId: template.id, templateVersion: template.version, variantId },
  };
  return {
    ok: true,
    draft: next,
    changedFields: [
      ...changedPaths(draft.model, next.model, 'model'),
      ...changedPaths(draft.templateRef, next.templateRef, 'templateRef'),
    ],
    rangeIssues: templateRangeIssues(model, template),
  };
}
