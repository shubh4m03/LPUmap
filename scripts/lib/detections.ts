/**
 * detections.geojson: machine-detected footprints that OSM does not have.
 *
 * Owner decision 1: a separate, flat, dashed "Unverified detected footprints"
 * layer — never extruded, searched, routed, keyed, named, categorised or
 * counted as campus buildings, and never shifted to "correct" the documented
 * ~5.6 m Microsoft–OSM offset (no evidence says which source is right).
 *
 * Rules (docs/CAMPUS_GEOGRAPHY_AUDIT.md §5.1 matching method):
 *  - Microsoft footprints are considered when ≥ 50 % of their area lies inside
 *    the campus boundary (exact area, src/geo/boundary.ts).
 *  - matched (NOT shipped) = IoU ≥ 0.3 with one OSM footprint, or ≥ 50 % of
 *    the MS footprint covered by OSM footprints. Every OSM building in the
 *    snapshot counts, whatever its campus status, so an OSM footprint held for
 *    review is never duplicated as an "unverified detection".
 *  - confirmedBy ['google-open-buildings'] when a Google Open Buildings point
 *    with confidence ≥ the recorded threshold falls inside the MS polygon.
 *  - Google-only strong detections: a Google point with confidence ≥ the
 *    threshold and source area ≥ minAreaM2, inside the boundary, inside no OSM
 *    footprint and no Microsoft footprint. No Google polygon is available
 *    (the points file is used), so these are typed geometryKind 'point'.
 */
import { createHash } from 'node:crypto';
import { DETECTION_MANIFEST_SOURCE_IDS } from '../../src/data/schema.ts';
import type { DetectionProps, DetectionsFile, LngLat, SourceRecord } from '../../src/data/schema.ts';
import type { BoundaryReviewSection } from '../../src/data/schema.ts';
import { classifyFootprint, createBoundary, geometryProblems } from '../../src/geo/boundary.ts';
import type { CampusBoundary, PolygonalGeometry } from '../../src/geo/boundary.ts';
import type { BuildingRecord } from './build-buildings.ts';
import { openSectionForPoint } from './boundary-review.ts';
import type { GoogleSnapshot, MsSnapshot } from './detection-sources.ts';
import { SHIPPED_LICENSE_DIR, SHIPPED_MS_LICENSE } from './detection-sources.ts';
import { bboxOfCoords, pointInMultiPolygon, round } from './geometry.ts';
import type { BBox, MultiPolygon } from './geometry.ts';

export const MATCH_IOU = 0.3;
export const MATCH_COVERAGE = 0.5;
export const PARTIAL_COVERAGE = 0.1;
export const CANDIDATE_MIN_INSIDE = 0.5;

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

interface MsFootprint {
  geometry: PolygonalGeometry;
  mp: MultiPolygon;
  bbox: BBox;
  hash: string;
}

export interface DetectionsSummary {
  microsoft: {
    used: boolean;
    inSnapshot: number;
    invalid: number;
    candidates: number;
    matched: number;
    partial: number;
    msOnly: number;
    shipped: number;
    confirmedByGoogle: number;
    byStatus: Record<string, number>;
  };
  google: {
    used: boolean;
    inSnapshot: number;
    inBoundary: number;
    strongInBoundary: number;
    googleOnlyStrong: number;
    shipped: number;
    threshold: number | null;
    minAreaM2: number | null;
  };
}

export interface DetectionsResult {
  file: DetectionsFile;
  sources: SourceRecord[];
  summary: DetectionsSummary;
  /** Licence texts to ship next to the data: published relative path → text. */
  licenseFiles: Record<string, string>;
  /** All MS footprints of the snapshot (also used for coverage figures). */
  shippedAreaM2: number;
}

function parseMs(lines: readonly string[]): { footprints: MsFootprint[]; invalid: number } {
  const footprints: MsFootprint[] = [];
  let invalid = 0;
  for (const line of lines) {
    const f = JSON.parse(line) as { geometry?: { type?: string; coordinates?: unknown } };
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || geometryProblems(g).length > 0) {
      invalid++;
      continue;
    }
    const geometry = g as PolygonalGeometry;
    const mp = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) as MultiPolygon;
    footprints.push({
      geometry,
      mp,
      bbox: bboxOfCoords(mp.flat(2))!,
      // Hash of the source coordinates exactly as published: stable for an unchanged release.
      hash: sha(JSON.stringify(geometry.coordinates)).slice(0, 16),
    });
  }
  return { footprints, invalid };
}

interface GooglePoint {
  location: LngLat;
  areaM2: number;
  confidence: number;
  plusCode: string;
  raw: string;
}

function parseGoogle(rows: readonly string[]): GooglePoint[] {
  return rows.map((raw) => {
    const [lat, lon, area, conf, plus] = raw.split(',');
    return {
      location: [Number(lon), Number(lat)] as LngLat,
      areaM2: Number(area),
      confidence: Number(conf),
      plusCode: (plus ?? '').trim(),
      raw,
    };
  });
}

const overlaps = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export interface DetectionsInput {
  ms: MsSnapshot | null;
  google: GoogleSnapshot | null;
  boundary: CampusBoundary;
  sections: readonly BoundaryReviewSection[];
  /** Every OSM building footprint of the snapshot (any campus status). */
  osmFootprints: readonly BuildingRecord[];
}

export function buildDetections(input: DetectionsInput): DetectionsResult {
  const { boundary, sections } = input;
  const osm = input.osmFootprints.filter((b) => b.problems.length === 0);
  const features: DetectionsFile['features'] = [];
  const sources: SourceRecord[] = [];
  const licenseFiles: Record<string, string> = {};
  const summary: DetectionsSummary = {
    microsoft: {
      used: false,
      inSnapshot: 0,
      invalid: 0,
      candidates: 0,
      matched: 0,
      partial: 0,
      msOnly: 0,
      shipped: 0,
      confirmedByGoogle: 0,
      byStatus: {},
    },
    google: {
      used: false,
      inSnapshot: 0,
      inBoundary: 0,
      strongInBoundary: 0,
      googleOnlyStrong: 0,
      shipped: 0,
      threshold: input.google?.source.confidenceThreshold ?? null,
      minAreaM2: input.google?.source.minAreaM2 ?? null,
    },
  };
  const threshold = input.google?.source.confidenceThreshold ?? 1;
  const points = input.google ? parseGoogle(input.google.rows) : [];
  const strongPoints = points.filter((p) => p.confidence >= threshold);
  const [bw, bs, be, bn] = boundary.bbox;
  const boundaryBBox: BBox = [bw, bs, be, bn];
  let shippedAreaM2 = 0;

  const ms = input.ms ? parseMs(input.ms.lines) : { footprints: [], invalid: 0 };
  if (input.ms) {
    const src = input.ms.source;
    summary.microsoft.used = true;
    summary.microsoft.inSnapshot = input.ms.lines.length;
    summary.microsoft.invalid = ms.invalid;
    const sourceRef = `quadkey ${src.quadkey}, release ${src.release}`;
    const seen = new Set<string>();
    for (const fp of ms.footprints) {
      if (!overlaps(fp.bbox, boundaryBBox) || seen.has(fp.hash)) continue;
      seen.add(fp.hash); // an exact repeat of a published polygon is one detection
      const f = boundary.insideFraction(fp.geometry);
      if (f < CANDIDATE_MIN_INSIDE) continue;
      summary.microsoft.candidates++;
      const region = createBoundary(fp.geometry);
      let bestIoU = 0;
      const touching: PolygonalGeometry[] = [];
      for (const o of osm) {
        if (!overlaps(fp.bbox, o.bbox)) continue;
        const inter = region.intersectionAreaM2(o.geometry);
        if (inter <= 0) continue;
        touching.push(o.geometry);
        const iou = inter / (region.areaM2 + (o.areaM2 ?? 0) - inter);
        if (iou > bestIoU) bestIoU = iou;
      }
      // Coverage by the UNION of OSM footprints: overlapping, contained or duplicate
      // OSM outlines must not be counted twice.
      const covered = touching.length === 0 ? 0 : region.unionIntersectionAreaM2(touching);
      const coverage = Math.min(1, covered / region.areaM2);
      if (bestIoU >= MATCH_IOU || coverage >= MATCH_COVERAGE) {
        summary.microsoft.matched++;
        continue;
      }
      if (coverage >= PARTIAL_COVERAGE) summary.microsoft.partial++;
      else summary.microsoft.msOnly++;
      const id = `det:microsoft-ml:${fp.hash}`;
      const m = classifyFootprint({ id, geometry: fp.geometry }, boundary, sections);
      if (m.status === 'outside') continue;
      const confirmed = strongPoints.some(
        (p) =>
          p.location[0] >= fp.bbox[0] &&
          p.location[0] <= fp.bbox[2] &&
          p.location[1] >= fp.bbox[1] &&
          p.location[1] <= fp.bbox[3] &&
          pointInMultiPolygon(p.location, fp.mp),
      );
      if (confirmed) summary.microsoft.confirmedByGoogle++;
      summary.microsoft.byStatus[m.status] = (summary.microsoft.byStatus[m.status] ?? 0) + 1;
      const props: DetectionProps = {
        id,
        source: 'microsoft-ml',
        geometryKind: 'footprint',
        sourceRef,
        areaM2: round(region.areaM2, 2),
        confidence: null, // the tile publishes -1 (no score) for every feature
        matchedOsmId: null,
        matchIoU: null,
        confirmedBy: confirmed ? ['google-open-buildings'] : [],
        campusStatus: m.status,
        insideFraction: m.insideFraction,
        reviewSectionId: m.reviewSectionId,
        reviewStatus: 'unreviewed',
      };
      shippedAreaM2 += region.areaM2;
      features.push({
        type: 'Feature',
        geometry: fp.geometry as DetectionsFile['features'][number]['geometry'],
        properties: props,
      });
      summary.microsoft.shipped++;
    }
    sources.push({
      id: DETECTION_MANIFEST_SOURCE_IDS['microsoft-ml'],
      name: src.name,
      url: src.url,
      license: src.license,
      licenseUrl: src.licenseUrl,
      licenseTextPath: `data/${SHIPPED_LICENSE_DIR}/${SHIPPED_MS_LICENSE}`,
      attribution: src.attribution,
      retrievedAt: src.retrievedAt,
      notes:
        `Tile quadkey ${src.quadkey}, release ${src.release} (${src.tileUrl}). Unverified machine detections shown only ` +
        'as a flat review layer; geometry kept exactly as published (the ~5.6 m offset to OSM is documented, not corrected).',
    });
    licenseFiles[`${SHIPPED_LICENSE_DIR}/${SHIPPED_MS_LICENSE}`] = input.ms.licenseText;
  }

  if (input.google) {
    const src = input.google.source;
    summary.google.used = true;
    summary.google.inSnapshot = points.length;
    for (const p of points) {
      if (!boundary.containsPoint(p.location)) continue;
      summary.google.inBoundary++;
      if (p.confidence < threshold) continue;
      summary.google.strongInBoundary++;
      if (p.areaM2 < src.minAreaM2) continue;
      if (osm.some((o) => pointInMultiPolygon(p.location, o.multiPolygon))) continue;
      if (ms.footprints.some((fp) => pointInMultiPolygon(p.location, fp.mp))) continue;
      summary.google.googleOnlyStrong++;
      const section = openSectionForPoint(p.location, sections);
      const props: DetectionProps = {
        id: `det:google-open-buildings:${sha(p.raw).slice(0, 16)}`,
        source: 'google-open-buildings',
        geometryKind: 'point',
        sourceRef: `v3 points, S2 cell ${src.s2Token}, plus code ${p.plusCode}`,
        areaM2: round(p.areaM2, 2),
        confidence: round(p.confidence, 4),
        matchedOsmId: null,
        matchIoU: null,
        confirmedBy: [],
        campusStatus: section ? 'uncertain' : 'inside',
        insideFraction: null,
        reviewSectionId: section ? section.section.id : null,
        reviewStatus: 'unreviewed',
      };
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: p.location,
        } as unknown as DetectionsFile['features'][number]['geometry'],
        properties: props,
      });
      summary.google.shipped++;
    }
    sources.push({
      id: DETECTION_MANIFEST_SOURCE_IDS['google-open-buildings'],
      name: src.name,
      url: src.url,
      license: src.license,
      licenseUrl: src.licenseUrl,
      attribution: src.attribution,
      retrievedAt: src.retrievedAt,
      notes:
        `Open Buildings ${src.version} points, S2 cell ${src.s2Token} (${src.tileUrl}). Dual-licensed CC BY 4.0 or ODbL 1.0; ` +
        `used under ODbL 1.0. Confidence threshold ${src.confidenceThreshold} (${src.confidenceThresholdSource}).`,
    });
  }

  features.sort((a, b) =>
    a.properties.id < b.properties.id ? -1 : a.properties.id > b.properties.id ? 1 : 0,
  );
  return {
    file: { type: 'FeatureCollection', features },
    sources,
    summary,
    licenseFiles,
    shippedAreaM2: round(shippedAreaM2, 1),
  };
}
