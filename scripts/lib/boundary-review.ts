/**
 * Boundary review: the curated, human-editable input
 * (data/curated/boundary-review.json) and the generated summary
 * (public/data/boundary-review.json).
 *
 * The curated file holds uncertain boundary SECTIONS (geometry + reason +
 * evidence) and per-footprint DECISIONS (who decided, when, on what source).
 * The pipeline only reads it. Owner decision 3: footprints in an open section
 * are 'uncertain' (rule R3), excluded from the campus inventory and listed for
 * review until a dated decision or an OSM boundary fix resolves them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  boundaryReviewSectionSchema,
  curatedMembershipDecisionSchema,
  DATA_SCHEMA_VERSION,
} from '../../src/data/schema.ts';
import type {
  BoundaryReviewFile,
  BoundaryReviewItem,
  BoundaryReviewSection,
  CuratedMembershipDecision,
  LngLat,
} from '../../src/data/schema.ts';
import { createLocalProjection } from '../../src/distance/geodesic.ts';
import type { MembershipThresholds } from '../../src/geo/boundary.ts';
import { pointInRing } from './geometry.ts';

export const BOUNDARY_REVIEW_FILE = 'boundary-review.json';

/**
 * Curated decision as written by a human: the frozen contract shape plus
 * `decidedBy` (who made the decision). The pipeline passes the contract shape
 * on; `decidedBy` is kept in the curated file and echoed in the reports.
 */
export const curatedDecisionInputSchema = curatedMembershipDecisionSchema.extend({
  decidedBy: z.string().trim().min(1),
});

export const curatedBoundaryReviewInputSchema = z.strictObject({
  $comment: z.string().optional(),
  sections: z.array(boundaryReviewSectionSchema.strict()),
  decisions: z.array(curatedDecisionInputSchema.strict()),
});
export type CuratedBoundaryReviewInput = z.infer<typeof curatedBoundaryReviewInputSchema>;

export interface LoadedBoundaryReview {
  sections: BoundaryReviewSection[];
  decisions: CuratedMembershipDecision[];
  decidedBy: Map<string, string>;
  present: boolean;
}

/** Reads data/curated/boundary-review.json (missing file = no sections, no decisions). */
export function loadBoundaryReview(curatedDir: string): LoadedBoundaryReview {
  const path = join(curatedDir, BOUNDARY_REVIEW_FILE);
  if (!existsSync(path)) return { sections: [], decisions: [], decidedBy: new Map(), present: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${BOUNDARY_REVIEW_FILE}: not valid JSON (${(e as Error).message})`, { cause: e });
  }
  const parsed = curatedBoundaryReviewInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`${BOUNDARY_REVIEW_FILE} is invalid:\n${z.prettifyError(parsed.error)}`);
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const s of parsed.data.sections) {
    if (ids.has(s.id)) problems.push(`duplicate section id ${s.id}`);
    ids.add(s.id);
    if (s.status === 'resolved' && !s.resolution)
      problems.push(`section ${s.id} is resolved but has no resolution`);
  }
  const featureIds = new Set<string>();
  for (const d of parsed.data.decisions) {
    if (featureIds.has(d.featureId)) problems.push(`more than one decision for ${d.featureId}`);
    featureIds.add(d.featureId);
  }
  if (problems.length > 0) throw new Error(`${BOUNDARY_REVIEW_FILE}: ${problems.join('; ')}`);
  return {
    sections: parsed.data.sections,
    decisions: parsed.data.decisions.map(({ decidedBy: _by, ...d }) => d),
    decidedBy: new Map(parsed.data.decisions.map((d) => [d.featureId, d.decidedBy])),
    present: true,
  };
}

/** Distance in metres from a point to a review section's geometry (0 inside a polygon section). */
export function pointDistanceToSectionM(p: LngLat, section: BoundaryReviewSection): number {
  const proj = createLocalProjection(p);
  const g = section.geometry;
  const lines: LngLat[][] = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  if (g.type === 'Polygon') {
    const [outer, ...holes] = g.coordinates;
    if (outer && pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) return 0;
  }
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = proj.toXY(line[i]!);
      const [bx, by] = proj.toXY(line[i + 1]!);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

/** The first OPEN section whose buffer reaches the point, or null. */
export function openSectionForPoint(
  p: LngLat,
  sections: readonly BoundaryReviewSection[],
): { section: BoundaryReviewSection; distanceM: number } | null {
  for (const s of sections) {
    if (s.status !== 'open') continue;
    const d = pointDistanceToSectionM(p, s);
    if (d <= s.bufferM) return { section: s, distanceM: d };
  }
  return null;
}

export interface ReviewFileInput {
  boundarySourceRef: string;
  thresholds: MembershipThresholds;
  sections: readonly BoundaryReviewSection[];
  decisions: readonly CuratedMembershipDecision[];
  items: readonly BoundaryReviewItem[];
}

/** public/data/boundary-review.json (schema: boundaryReviewFileSchema). */
export function boundaryReviewFile(i: ReviewFileInput): BoundaryReviewFile {
  const items = [...i.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    boundarySourceRef: i.boundarySourceRef,
    rules: {
      insideMinFraction: i.thresholds.insideMinFraction,
      outsideMaxFraction: i.thresholds.outsideMaxFraction,
      crossingInventoryMinFraction: i.thresholds.crossingInventoryMinFraction,
    },
    sections: i.sections.map((s) => ({
      ...s,
      affectedIds: items.filter((it) => it.reviewSectionId === s.id).map((it) => it.id),
    })),
    decisions: [...i.decisions].sort((a, b) => a.featureId.localeCompare(b.featureId)),
    items,
  };
}
