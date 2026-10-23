/**
 * Campus membership of every OSM building, using the shared boundary service
 * (src/geo/boundary.ts classifyFootprint, rules R1–R7), plus the footprint
 * defects the pipeline reports but never "fixes": exact duplicates, overlaps
 * and contained (stacked) parts, elevated structures and suspicious levels.
 *
 * Inventory = status 'inside' or 'crossing' (R6: ≥ 50 % inside and no
 * conflicting evidence). 'uncertain' footprints are held out for review and
 * 'outside' ones are excluded; neither is ever shipped in buildings.geojson.
 */
import { classifyFootprint, createBoundary } from '../../src/geo/boundary.ts';
import type { CampusBoundary, MembershipResult, MembershipThresholds } from '../../src/geo/boundary.ts';
import { DEFAULT_MEMBERSHIP_THRESHOLDS } from '../../src/geo/boundary.ts';
import type { BoundaryReviewSection, CuratedMembershipDecision } from '../../src/data/schema.ts';
import type { BuildingRecord } from './build-buildings.ts';
import { round } from './geometry.ts';
import type { Tags } from './osm-parse.ts';

/** Operators that are the university itself (the boundary relation says operator=Lovely Group). */
const CAMPUS_OPERATOR_RE = /\b(lovely|lpu)\b/i;
/** Commercial accommodation tags: evidence that a footprint is a private business, not a campus building. */
const PRIVATE_ACCOMMODATION = new Set(['apartment', 'hotel', 'guest_house', 'hostel', 'motel']);

/**
 * Evidence that contradicts campus membership, consulted only for crossing
 * footprints (R6). Derived from source tags only; documented in
 * docs/CAMPUS_BUILDING_COVERAGE.md.
 */
export function buildingConflicts(tags: Tags): string[] {
  const out: string[] = [];
  const operator = tags.operator?.trim();
  if (operator && !CAMPUS_OPERATOR_RE.test(operator)) out.push(`operator=${operator}`);
  const tourism = tags.tourism?.trim();
  if (tourism && PRIVATE_ACCOMMODATION.has(tourism)) out.push(`tourism=${tourism} (private accommodation)`);
  return out;
}

export interface ClassifiedBuilding {
  record: BuildingRecord;
  membership: MembershipResult;
}

export function classifyBuildings(
  records: readonly BuildingRecord[],
  boundary: CampusBoundary,
  sections: readonly BoundaryReviewSection[],
  decisions: readonly CuratedMembershipDecision[],
  thresholds: MembershipThresholds = DEFAULT_MEMBERSHIP_THRESHOLDS,
): ClassifiedBuilding[] {
  return records.map((record) => ({
    record,
    membership: classifyFootprint(
      { id: record.id, geometry: record.geometry, conflicts: buildingConflicts(record.tags) },
      boundary,
      sections,
      decisions,
      thresholds,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Pairwise footprint relations (duplicates, overlaps, contained parts)
// ---------------------------------------------------------------------------

/** IoU at or above this = the same footprint drawn twice (docs/CAMPUS_GEOGRAPHY_AUDIT.md §6). */
export const DUPLICATE_IOU = 0.95;
/** Overlaps smaller than this (m²) are tracing noise and not reported. */
export const OVERLAP_MIN_M2 = 1;
/** A footprint this much covered by another is "contained" (a stacked part drawn from the ground). */
export const CONTAINED_SHARE = 0.95;

export interface FootprintPair {
  a: string;
  b: string;
  intersectionM2: number;
  iou: number;
  /** Share of the smaller footprint covered by the other. */
  smallerCovered: number;
  kind: 'duplicate' | 'contained' | 'overlap';
}

/** Valid footprints only; deterministic (sorted by id pair). */
export function footprintPairs(records: readonly BuildingRecord[]): FootprintPair[] {
  const valid = records
    .filter((r) => r.problems.length === 0 && r.areaM2 !== null && r.areaM2 > 0)
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const cache = new Map<string, CampusBoundary>();
  const regionOf = (r: BuildingRecord) => {
    let reg = cache.get(r.id);
    if (!reg) {
      reg = createBoundary(r.geometry);
      cache.set(r.id, reg);
    }
    return reg;
  };
  const out: FootprintPair[] = [];
  for (let i = 0; i < valid.length; i++) {
    const a = valid[i]!;
    for (let j = i + 1; j < valid.length; j++) {
      const b = valid[j]!;
      if (a.bbox[0] > b.bbox[2] || b.bbox[0] > a.bbox[2] || a.bbox[1] > b.bbox[3] || b.bbox[1] > a.bbox[3])
        continue;
      const inter = regionOf(a).intersectionAreaM2(b.geometry);
      if (inter < OVERLAP_MIN_M2) continue;
      const areaA = regionOf(a).areaM2;
      const areaB = regionOf(b).areaM2;
      const iou = inter / (areaA + areaB - inter);
      const smallerCovered = inter / Math.min(areaA, areaB);
      out.push({
        a: a.id,
        b: b.id,
        intersectionM2: round(inter, 2),
        iou: round(iou, 4),
        smallerCovered: round(Math.min(1, smallerCovered), 4),
        kind:
          iou >= DUPLICATE_IOU ? 'duplicate' : smallerCovered >= CONTAINED_SHARE ? 'contained' : 'overlap',
      });
    }
  }
  return out;
}

const osmNumericId = (id: string) => Number(id.split('/')[1] ?? Number.NaN);

export interface DuplicateResolution {
  kept: string;
  dropped: string;
  iou: number;
  rule: string;
}

/**
 * Resolves duplicate pairs deterministically: the footprint with the lower
 * OSM element id (the older drawing) is kept, the other is removed from the
 * dataset and recorded here. Tags are never merged.
 */
export function resolveDuplicates(pairs: readonly FootprintPair[]): DuplicateResolution[] {
  const dropped = new Set<string>();
  const out: DuplicateResolution[] = [];
  for (const p of pairs) {
    if (p.kind !== 'duplicate' || dropped.has(p.a) || dropped.has(p.b)) continue;
    const [kept, drop] = osmNumericId(p.a) <= osmNumericId(p.b) ? [p.a, p.b] : [p.b, p.a];
    dropped.add(drop);
    out.push({
      kept,
      dropped: drop,
      iou: p.iou,
      rule: `IoU ${p.iou} ≥ ${DUPLICATE_IOU}: kept the lower OSM id (${kept}); ${drop} removed. Fix upstream in OSM.`,
    });
  }
  return out;
}

export interface BuildingFlag {
  id: string;
  code: 'suspicious-levels' | 'elevated-structure' | 'min-height-ignored' | 'invalid-geometry';
  message: string;
}

export function buildingFlags(records: readonly BuildingRecord[]): BuildingFlag[] {
  const out: BuildingFlag[] = [];
  for (const r of records) {
    const h = r.height;
    if (h.levelsSuspicious)
      out.push({
        id: r.id,
        code: 'suspicious-levels',
        message: `building:levels tagged ${h.levels} (suspicious: below 1 storey); rendered with the placeholder height.`,
      });
    if (h.minHeightM > 0)
      out.push({
        id: r.id,
        code: 'elevated-structure',
        message:
          `Drawn from ${h.minHeightM} m to ${h.heightM} m (` +
          [
            h.minLevel !== null ? `building:min_level=${h.minLevel}` : null,
            h.osmMinHeightM !== null ? `min_height=${h.osmMinHeightM}` : null,
            h.levels !== null ? `building:levels=${h.levels}` : null,
          ]
            .filter(Boolean)
            .join(', ') +
          '). Verify on site; nothing is changed.',
      });
    if (h.minHeightIgnored)
      out.push({
        id: r.id,
        code: 'min-height-ignored',
        message: 'min_height/min_level is not below the top; drawn from the ground.',
      });
    if (r.problems.length > 0)
      out.push({ id: r.id, code: 'invalid-geometry', message: r.problems.join('; ') });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id) || a.code.localeCompare(b.code));
}
