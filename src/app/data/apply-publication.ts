/**
 * Base dataset + publication → what every view mode shows
 * (docs/BUILDING_STUDIO_DESIGN.md §11). Pure and deterministic:
 *
 *  1. mergePublication: overrides, owner/community locations, rule 4a
 *     (off-campus results go to `contextPlaces`, never to the campus);
 *  2. mergeStudioBuildings: published studio buildings — one feature, one
 *     place, one id — plus the render models both 3D modes draw.
 *
 * Drafts and archived records are never in a publication; nothing here could
 * show them. Without a publication the base data is returned unchanged.
 */
import { mergePublication, type MergeReport } from '../../community/index.ts';
import type { Publication } from '../../community/index.ts';
import {
  mergeStudioBuildings,
  type StudioMergeReport,
  type StudioRenderModel,
} from '../../building-studio/index.ts';
import type { CampusData } from '../../data/index.ts';
import type { BoundaryReviewFile, Place } from '../../data/index.ts';

/** Membership inputs the server used at publish (boundary-review.json); null = not available. */
export type BoundaryReviewInput = Pick<BoundaryReviewFile, 'sections' | 'decisions'>;

export interface AppliedPublication {
  data: CampusData;
  /** Off-campus places from the publication (rule 4a), for the opt-in "Nearby, outside campus" layer only. */
  contextPlaces: Place[];
  /** Sorted by publicId. */
  studioModels: StudioRenderModel[];
  /** Ids the directory and search leave out (directoryVisible: false). Still drawn and selectable. */
  hiddenFromDirectory: ReadonlySet<string>;
  /** Published studio buildings that were not merged because their membership could not be checked. */
  studioSkipped: number;
  report: { community: MergeReport; studio: StudioMergeReport | null } | null;
}

const NONE: ReadonlySet<string> = new Set();

export function applyPublication(
  base: CampusData,
  pub: Publication | null,
  review: BoundaryReviewInput | null = null,
): AppliedPublication {
  if (!pub)
    return {
      data: base,
      contextPlaces: [],
      studioModels: [],
      hiddenFromDirectory: NONE,
      studioSkipped: 0,
      report: null,
    };
  const community = mergePublication(base, pub);
  const buildings = pub.buildings ?? [];
  // Membership is re-checked with the same review sections and curated decisions the server used;
  // without them an 'uncertain' footprint could pass as 'inside', so the buildings wait instead.
  if (buildings.length === 0 || review === null)
    return {
      data: community.data,
      contextPlaces: community.contextPlaces,
      studioModels: [],
      hiddenFromDirectory: NONE,
      studioSkipped: buildings.length,
      report: { community: community.report, studio: null },
    };
  const studio = mergeStudioBuildings({
    data: community.data,
    buildings,
    hiddenTargets: new Set(community.report.removedBuildings),
    reviewSections: review.sections,
    curatedDecisions: review.decisions,
  });
  return {
    data: studio.data,
    contextPlaces: community.contextPlaces,
    studioModels: studio.studioModels,
    hiddenFromDirectory: new Set(studio.studioHiddenFromDirectory),
    studioSkipped: 0,
    report: { community: community.report, studio: studio.report },
  };
}
