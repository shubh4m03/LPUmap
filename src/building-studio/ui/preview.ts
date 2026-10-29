/**
 * What the Studio draws on the map for the model being placed or edited
 * (map-editing contract, src/map/editing/types.ts). Pure.
 *
 *  - the translucent footprint (role 'footprint', or 'footprint-invalid'
 *    while the latest validation of exactly this draft reports an error);
 *  - a snapping proposal's footprint (role 'snap'), only while it is shown;
 *  - an optional guide outline (role 'guide': an UNVERIFIED detected
 *    footprint, dashed, never treated as data);
 *  - outlines of buildings a warning is about (role 'warning').
 *
 * The 3D model itself is drawn by the studio custom layer from
 * `previewRenderSource` (preview: true, never memoised).
 */
import type { Feature, Geometry, Polygon } from 'geojson';
import type { LngLat } from '../../data/index.ts';
import type { EditPreviewCollection, EditPreviewFeature, EditPreviewRole } from '../../map/editing/index.ts';
import type { StudioRenderSource } from '../render/maplibre/index.ts';
import { deriveFootprint } from '../editor.ts';
import type { ModelConfigV1, StudioFootprint } from '../index.ts';

/** Placeholder record id of a model that is not on the server yet (valid `stu:` syntax, never stored). */
export const PREVIEW_RECORD_ID = 'stu:localpreviewlocalpreview';

export interface PreviewInput {
  model: ModelConfigV1;
  /** Mapped footprint of the target base building ('footprint-prism' models), or null. */
  baseFootprint: readonly (readonly LngLat[])[] | null;
  invalid: boolean;
  proposal?: ModelConfigV1 | null;
  guide?: { id: string; coordinates: readonly (readonly LngLat[])[] } | null;
  warnings?: readonly { id: string; coordinates: readonly (readonly LngLat[])[] }[];
}

export type PreviewFootprint =
  { ok: true; footprint: StudioFootprint; areaM2: number } | { ok: false; message: string };

/** The footprint the server would derive for this model (S5); never sent to the server. */
export function previewFootprint(
  model: ModelConfigV1,
  baseFootprint: readonly (readonly LngLat[])[] | null,
): PreviewFootprint {
  const r = deriveFootprint(model, baseFootprint ? { baseFootprint } : {});
  return r.ok ? { ok: true, footprint: r.footprint, areaM2: r.areaM2 } : { ok: false, message: r.message };
}

const polygon = (
  coordinates: readonly (readonly LngLat[])[],
  role: EditPreviewRole,
  id?: string,
): EditPreviewFeature => {
  const geometry: Polygon = {
    type: 'Polygon',
    coordinates: coordinates.map((r) => r.map((p) => [p[0], p[1]])),
  };
  const f: Feature<Geometry, { role: EditPreviewRole; id?: string }> = {
    type: 'Feature',
    geometry,
    properties: id ? { role, id } : { role },
  };
  return f;
};

export function previewCollection(input: PreviewInput): EditPreviewCollection {
  const features: EditPreviewFeature[] = [];
  if (input.guide) features.push(polygon(input.guide.coordinates, 'guide', input.guide.id));
  for (const w of input.warnings ?? []) features.push(polygon(w.coordinates, 'warning', w.id));
  if (input.proposal) {
    const p = previewFootprint(input.proposal, input.baseFootprint);
    if (p.ok) features.push(polygon(p.footprint.coordinates, 'snap', 'proposal'));
  }
  const fp = previewFootprint(input.model, input.baseFootprint);
  if (fp.ok)
    features.push(
      polygon(fp.footprint.coordinates, input.invalid ? 'footprint-invalid' : 'footprint', 'edited'),
    );
  else
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [...input.model.anchor] },
      properties: { role: 'point', id: 'edited' },
    });
  return { type: 'FeatureCollection', features };
}

/**
 * The model drawn by the studio layer as a preview. Null when no footprint
 * can be derived (the map then shows the anchor point only and the
 * inspector explains why).
 */
export function previewRenderSource(
  model: ModelConfigV1,
  opts: { publicId: string; recordId: string | null; baseFootprint: readonly (readonly LngLat[])[] | null },
): StudioRenderSource | null {
  const fp = previewFootprint(model, opts.baseFootprint);
  if (!fp.ok) return null;
  return {
    publicId: opts.publicId,
    recordId: opts.recordId ?? PREVIEW_RECORD_ID,
    version: 0,
    footprint: fp.footprint,
    model,
    preview: true,
  };
}
