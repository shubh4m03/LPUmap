/**
 * The isometric check of the Studio: what the overview would draw if the
 * open draft were published. It runs the SAME merge the public app uses
 * (mergeStudioBuildings: membership re-check, one feature per building) on a
 * preview record, so an off-campus draft is honestly reported as "not shown"
 * instead of being drawn. Pure.
 */
import type { CampusData } from '../../data/index.ts';
import type { BoundaryReviewSection, CuratedMembershipDecision } from '../../data/index.ts';
import { mergeStudioBuildings, type StudioCampusData, type StudioRenderModel } from '../index.ts';
import type { PublishedStudioBuilding, StudioDraft, StudioFootprint } from '../index.ts';
import { PREVIEW_RECORD_ID } from './preview.ts';

export interface IsoPreviewInput {
  data: CampusData;
  draft: StudioDraft;
  recordId: string | null;
  targetId: string | null;
  footprint: StudioFootprint;
  areaM2: number;
  reviewSections?: readonly BoundaryReviewSection[];
  curatedDecisions?: readonly CuratedMembershipDecision[];
}

export type IsoPreviewResult =
  | { ok: true; data: StudioCampusData; models: StudioRenderModel[]; publicId: string }
  | { ok: false; message: string };

const PREVIEW_TIME = '2000-01-01T00:00:00.000Z';

export function isoPreview(input: IsoPreviewInput): IsoPreviewResult {
  const id = input.recordId ?? PREVIEW_RECORD_ID;
  const publicId = input.targetId ?? id;
  const identity = input.draft.identity;
  const record: PublishedStudioBuilding = {
    id,
    targetId: input.targetId,
    version: 1,
    publishedAt: PREVIEW_TIME,
    identity:
      input.targetId || !identity
        ? null
        : {
            name: identity.name,
            aliases: identity.aliases,
            categoryId: identity.categoryId,
            subtype: identity.subtype,
            description: identity.description,
            directoryVisible: identity.directoryVisible,
          },
    // The preview never claims evidence: it is drawn as an unverified illustrative model.
    verification: { status: 'unverified' },
    accuracyClass: 'generic-prefab',
    templateRef: input.draft.templateRef,
    model: input.draft.model,
    footprint: input.footprint,
    footprintAreaM2: input.areaM2,
    membership: {
      campusStatus: 'inside',
      insideFraction: 1,
      distanceToBoundaryM: 0,
      reasonCode: 'interior',
      decision: 'auto',
      decisionSource: null,
    },
    accessNodeId: null,
    positionCorrected: input.draft.positionCorrection !== null,
  };
  // A published copy of this new building is already in the data: take it out, the preview replaces it.
  const data: CampusData = input.targetId
    ? input.data
    : {
        ...input.data,
        buildings: {
          ...input.data.buildings,
          features: input.data.buildings.features.filter((f) => f.properties.id !== id),
        },
        places: input.data.places.filter((p) => p.id !== id),
      };
  const merged = mergeStudioBuildings({
    data,
    buildings: [record],
    ...(input.reviewSections ? { reviewSections: input.reviewSections } : {}),
    ...(input.curatedDecisions ? { curatedDecisions: input.curatedDecisions } : {}),
  });
  const r = merged.report;
  if (r.outside.includes(id))
    return {
      ok: false,
      message:
        'This footprint is outside the campus: it would not be shown in any view (and it cannot be published).',
    };
  if (r.heldForReview.includes(id))
    return {
      ok: false,
      message:
        'Campus membership of this footprint is uncertain: it is shown only after you acknowledge the boundary warning and publish.',
    };
  if (r.targetHidden.includes(id))
    return {
      ok: false,
      message: 'The target building is hidden by a place override: it is shown in no view.',
    };
  if (r.orphan.includes(id))
    return { ok: false, message: 'The target building is not in the current base dataset.' };
  if (r.invalid.some((i) => i.id === id))
    return { ok: false, message: 'The preview could not be built from this draft.' };
  const models = merged.studioModels.filter((m) => m.recordId === id);
  return { ok: true, data: merged.data, models, publicId };
}
