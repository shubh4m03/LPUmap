/**
 * Published (or preview) studio records → layer instances. The mesh comes
 * from the shared procedural module; a record this build cannot generate
 * (unknown modelConfigVersion, generator or version, or a generator
 * failure) is never dropped: it is drawn as the S2 fallback prism of its
 * stored footprint × body height in a neutral colour, and reported so the
 * admin quality view can flag "model unavailable".
 *
 * Meshes are memoised by `recordId@version` (published versions are
 * immutable), so re-renders and repeated syncs do not regenerate them.
 */
import { fallbackPrismMesh, generateStudioMesh } from '../../mesh/generate.ts';
import type { StudioMesh } from '../../mesh/types.ts';
import { modelSupport, type ModelEnvelope, type StudioFootprint } from '../../schema.ts';
import { FALLBACK_APPEARANCE, type StudioAppearance } from './buffers.ts';
import type { StudioLayerInstance } from './layer.ts';

/** What the layer needs from a merged studio building (a subset of StudioRenderModel, docs §11.2). */
export interface StudioRenderSource {
  /** targetId ?? studio id. */
  publicId: string;
  recordId: string;
  /** Published version; a preview uses 0 and is never memoised. */
  version: number;
  footprint: StudioFootprint;
  model: ModelEnvelope;
  /**
   * false → the merge decided the model must not be drawn as authored (e.g. an
   * owner position correction it ignored): the fallback prism of `footprint`
   * is drawn instead, even when this build could generate the model.
   */
  modelAvailable?: boolean;
  preview?: boolean;
}

export interface StudioInstanceResult {
  instance: StudioLayerInstance;
  /** false → the fallback prism is drawn ("model unavailable"). */
  modelAvailable: boolean;
  reason: string | null;
}

const memo = new Map<
  string,
  { mesh: StudioMesh; appearance: StudioAppearance; ok: boolean; reason: string | null }
>();
const MEMO_LIMIT = 512;

function resolve(src: StudioRenderSource) {
  if (src.modelAvailable === false)
    return {
      mesh: fallbackPrismMesh(src),
      appearance: FALLBACK_APPEARANCE,
      ok: false,
      reason: 'The model is not drawn as authored; its footprint is drawn as a plain prism.',
    };
  const support = modelSupport(src.model);
  if (support.ok) {
    const result = generateStudioMesh(support.config, { baseFootprint: src.footprint.coordinates });
    if (result.ok)
      return {
        mesh: result.mesh,
        appearance: { wall: support.config.facade.wallColour, roof: support.config.roof.colour },
        ok: true,
        reason: null,
      };
    return {
      mesh: fallbackPrismMesh(src),
      appearance: FALLBACK_APPEARANCE,
      ok: false,
      reason: result.message,
    };
  }
  return {
    mesh: fallbackPrismMesh(src),
    appearance: FALLBACK_APPEARANCE,
    ok: false,
    reason: support.message,
  };
}

export function studioInstanceFor(src: StudioRenderSource): StudioInstanceResult {
  const key =
    src.version > 0 && !src.preview
      ? `${src.recordId}@${src.version}${src.modelAvailable === false ? ':fallback' : ''}`
      : null;
  let r = key ? memo.get(key) : undefined;
  if (!r) {
    r = resolve(src);
    if (key) {
      if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value!);
      memo.set(key, r);
    }
  }
  const instance: StudioLayerInstance = { id: src.publicId, mesh: r.mesh, appearance: r.appearance };
  if (src.preview) instance.preview = true;
  return { instance, modelAvailable: r.ok, reason: r.reason };
}

/** Clears the mesh memo (tests). */
export function clearStudioInstanceMemo(): void {
  memo.clear();
}
