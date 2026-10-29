/**
 * Adapter from a published studio record (docs/BUILDING_STUDIO_DESIGN.md §11.2
 * `StudioRenderModel`) to what the overview draws. Kept out of IsoStage's
 * import graph: the caller that already holds publication data (and therefore
 * the studio schema) builds these, so the overview chunk stays small.
 *
 *  - A supported model → `generateStudioMesh` (the SAME faces as Realistic 3D, S1).
 *  - Unsupported / failed → `fallbackPrismMesh`: published footprint × body
 *    height, flagged `fallback` (S2: never dropped).
 *  - Labels are the S3 public wording (VERIFICATION_LABELS, APPEARANCE_LABEL).
 */
import { studioPublicLabel } from '../building-studio/index.ts';
import { fallbackPrismMesh, generateStudioMesh } from '../building-studio/index.ts';
import {
  APPEARANCE_LABEL,
  modelSupport,
  type AccuracyClass,
  type VERIFICATION_LABELS,
  type ModelEnvelope,
  type StudioFootprint,
} from '../building-studio/index.ts';
import type { LngLat } from '../data/index.ts';
import type { IsoStudioModel } from './scene.ts';

/** The fields of a StudioRenderModel the overview needs (structural, so either side may add fields). */
export interface StudioRenderModelLike {
  publicId: string;
  footprint: StudioFootprint;
  model: ModelEnvelope;
  /** false → draw the fallback prism (e.g. an owner position correction the merge ignored). */
  modelAvailable?: boolean;
  verification: { status: keyof typeof VERIFICATION_LABELS };
  accuracyClass?: AccuracyClass;
}

export function isoStudioModel(
  m: StudioRenderModelLike,
  opts: { baseFootprint?: LngLat[][] } = {},
): IsoStudioModel {
  const support = modelSupport(m.model);
  const labels = {
    verificationLabel: studioPublicLabel(m),
    appearanceLabel: APPEARANCE_LABEL,
  };
  if (support.ok && m.modelAvailable !== false) {
    const res = generateStudioMesh(
      support.config,
      opts.baseFootprint ? { baseFootprint: opts.baseFootprint } : {},
    );
    if (res.ok)
      return {
        id: m.publicId,
        mesh: res.mesh,
        colours: { wall: support.config.facade.wallColour, roof: support.config.roof.colour },
        ...labels,
      };
  }
  return {
    id: m.publicId,
    mesh: fallbackPrismMesh({ footprint: m.footprint, model: m.model }),
    ...labels,
    fallback: true,
  };
}
