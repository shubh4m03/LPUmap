// @vitest-environment node
/**
 * Building coverage, membership: on the REAL dataset, every footprint of the
 * raw snapshot is re-classified independently with the shared boundary
 * service against the shipped boundary and the curated review sections, and
 * the shipped files must agree — no external (outside) or held (uncertain)
 * footprint anywhere, no extrusion source outside the campus inventory,
 * landmarks present, no duplicates, valid geometry.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBoundary, geometryProblems } from '../../src/geo/boundary.ts';
import type { PolygonalGeometry } from '../../src/geo/boundary.ts';
import { readLandmarks } from '../../scripts/lib/landmarks.ts';
import { CURATED_DIR, DATA_DIR, loadRealData, reclassifyRawSnapshot } from './real-data.ts';
import type { Reclassified, RealData } from './real-data.ts';

let data: RealData;
let re: Reclassified;
let shippedIds: Set<string>;

beforeAll(() => {
  data = loadRealData();
  re = reclassifyRawSnapshot(data);
  shippedIds = new Set(data.buildings.features.map((f) => f.properties.id));
});

describe('campus membership (recomputed with src/geo/boundary.ts)', () => {
  it('accounts for every footprint of the raw snapshot', () => {
    expect(re.records.length).toBe(data.manifest.counts['buildings:inSnapshot']);
    expect(re.records.length).toBe(data.quality.membership.footprintsInSnapshot);
  });

  it('no external (outside) footprint is in buildings.geojson or is a building place', () => {
    const outside = re.classified.filter((c) => c.membership.status === 'outside').map((c) => c.record.id);
    expect(outside.length).toBe(data.manifest.counts['buildings:outsideExcluded']);
    expect(outside.length).toBeGreaterThan(0); // the Law Gate area footprints exist in the snapshot
    const buildingPlaces = new Set(data.places.filter((p) => p.kind === 'building').map((p) => p.id));
    for (const id of outside) {
      expect(shippedIds.has(id), id).toBe(false);
      expect(buildingPlaces.has(id), id).toBe(false);
    }
    // Context places never carry a footprint reference or the building kind.
    for (const p of data.contextPlaces) {
      expect(p.kind, p.id).not.toBe('building');
      expect(p.buildingId, p.id).toBeUndefined();
    }
  });

  it('uncertain footprints (open review sections, conflicts) are held out and listed for review', () => {
    const uncertain = re.classified.filter((c) => c.membership.status === 'uncertain').map((c) => c.record.id);
    expect(uncertain.length).toBe(data.manifest.counts['buildings:uncertain']);
    const reviewIds = new Set(data.review.items.map((i) => i.id));
    for (const id of uncertain) {
      expect(shippedIds.has(id), id).toBe(false);
      expect(reviewIds.has(id), id).toBe(true);
    }
    // The three blocks the boundary edge cuts near 75.7047 E, 31.2566 N are review items, not campus.
    for (const id of ['osm:way/422437899', 'osm:way/422437900', 'osm:way/422437901']) {
      expect(re.byId.get(id)?.membership).toMatchObject({ status: 'uncertain', reviewSectionId: 'centre-indent-blocks' });
      expect(shippedIds.has(id)).toBe(false);
    }
  });

  it('every shipped footprint is inventory (inside, or crossing by rule R6) and its stored membership matches', () => {
    const dropped = new Set(data.quality.duplicatesResolved.map((d) => d.dropped));
    const expected = re.classified
      .filter((c) => c.membership.inCampusInventory && !dropped.has(c.record.id))
      .map((c) => c.record.id)
      .sort();
    expect([...shippedIds].sort()).toEqual(expected);
    for (const f of data.buildings.features) {
      const p = f.properties;
      const m = re.byId.get(p.id)!.membership;
      expect(['inside', 'crossing'], p.id).toContain(p.campusStatus);
      expect(p.inCampusInventory, p.id).toBe(true);
      expect({ status: p.campusStatus, f: p.insideFraction, code: p.membershipReasonCode }, p.id).toEqual({
        status: m.status,
        f: m.insideFraction,
        code: m.reasonCode,
      });
    }
    expect(data.manifest.counts.buildings).toBe(data.buildings.features.length);
  });

  it('crossing footprints in the inventory are mostly inside and have no conflicting evidence', () => {
    for (const f of data.buildings.features.filter((x) => x.properties.campusStatus === 'crossing')) {
      expect(f.properties.insideFraction!, f.properties.id).toBeGreaterThanOrEqual(0.5);
      expect(f.properties.membershipReasonCode).toBe('crossing-majority');
    }
  });

  it('no curated decision is pre-filled (owner decision 3: only the owner or an OSM fix resolves a section)', () => {
    expect(data.review.decisions).toEqual([]);
    expect(data.review.sections.map((s) => s.id).sort()).toEqual(['centre-indent-blocks', 'east-lpu-ground', 'ne-bay']);
  });
});

describe('extrusion sources', () => {
  const POLY = new Set(['Polygon', 'MultiPolygon']);
  const HEIGHTISH = /height|levels|extru/i;

  it('only campus-inventory footprints carry render heights; no other public/data file has an extrudable building', () => {
    for (const f of data.buildings.features) {
      expect(f.properties.inCampusInventory).toBe(true);
      expect(f.properties.renderHeightM).toBeGreaterThan(0);
    }
    const geojsonFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith('.geojson') && f !== 'buildings.geojson');
    expect(geojsonFiles.sort()).toEqual(['basemap.geojson', 'boundary.geojson', 'detections.geojson']);
    for (const file of geojsonFiles) {
      const fc = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as {
        features: Array<{ geometry: { type: string }; properties: Record<string, unknown> }>;
      };
      for (const feat of fc.features) {
        const keys = Object.keys(feat.properties);
        expect(keys.filter((k) => HEIGHTISH.test(k)), `${file} ${String(feat.properties.id)}`).toEqual([]);
        if (file === 'basemap.geojson' && POLY.has(feat.geometry.type))
          expect(String(feat.properties.layer), String(feat.properties.id)).not.toMatch(/building/);
      }
    }
  });

  it('the School of Design outline (building:* tags, no building tag) is not extruded', () => {
    const q = JSON.parse(readFileSync(join(DATA_DIR, 'quality-report.json'), 'utf8')) as {
      osmTaggingNeeded: Array<{ id: string; reason: string }>;
    };
    const ids = q.osmTaggingNeeded.map((o) => o.id);
    expect(ids).toContain('osm:way/425717552');
    for (const id of ids) expect(shippedIds.has(id), id).toBe(false);
  });
});

describe('landmarks, duplicates and geometry validity', () => {
  it('every required landmark is present in the files it must appear in', () => {
    const landmarks = readLandmarks(CURATED_DIR)!;
    expect(landmarks.landmarks.length).toBeGreaterThan(0);
    const present: Record<string, Set<string>> = {
      buildings: shippedIds,
      places: new Set(data.places.map((p) => p.id)),
      boundary: new Set(data.boundary.features.map((f) => f.properties.id)),
    };
    for (const l of landmarks.landmarks) for (const where of l.in) expect(present[where]!.has(l.id), `${l.id} in ${where}`).toBe(true);
    // Landmarks list only named campus features: each named building is a landmark.
    const namedBuildings = data.buildings.features.filter((f) => f.properties.name !== null).map((f) => f.properties.id);
    const listed = new Set(landmarks.landmarks.map((l) => l.id));
    for (const id of namedBuildings) expect(listed.has(id), id).toBe(true);
  });

  it('no two shipped footprints are duplicates (IoU ≥ 0.95); the resolved pair is recorded', () => {
    const feats = data.buildings.features;
    const regions = feats.map((f) => createBoundary(f.geometry as PolygonalGeometry));
    for (let i = 0; i < feats.length; i++) {
      for (let j = i + 1; j < feats.length; j++) {
        const [a, b] = [regions[i]!, regions[j]!];
        if (a.bbox[0] > b.bbox[2] || b.bbox[0] > a.bbox[2] || a.bbox[1] > b.bbox[3] || b.bbox[1] > a.bbox[3]) continue;
        const inter = a.intersectionAreaM2(feats[j]!.geometry as PolygonalGeometry);
        const iou = inter / (a.areaM2 + b.areaM2 - inter);
        expect(iou, `${feats[i]!.properties.id} vs ${feats[j]!.properties.id}`).toBeLessThan(0.95);
      }
    }
    expect(data.quality.duplicatesResolved).toEqual([
      expect.objectContaining({ kept: 'osm:way/422437890', dropped: 'osm:way/675395630', iou: 1 }),
    ]);
    expect(shippedIds.has('osm:way/422437890')).toBe(true);
    expect(shippedIds.has('osm:way/675395630')).toBe(false);
  });

  it('every shipped footprint, the boundary and every detection polygon is valid geometry', () => {
    for (const f of data.buildings.features) expect(geometryProblems(f.geometry), f.properties.id).toEqual([]);
    for (const f of data.boundary.features) expect(geometryProblems(f.geometry), f.properties.id).toEqual([]);
    for (const f of data.detections.features)
      if (f.geometry.type !== 'Point') expect(geometryProblems(f.geometry), f.properties.id).toEqual([]);
  });

  it('stored areas agree with the geometry (no silent clipping or repositioning)', () => {
    const raw = reclassifyRawSnapshot(data);
    for (const f of data.buildings.features) {
      const rec = raw.byId.get(f.properties.id)!.record;
      expect(f.geometry.coordinates, f.properties.id).toEqual(rec.geometry.coordinates);
      expect(f.properties.areaM2, f.properties.id).toBe(rec.areaM2 === null ? null : Math.round(rec.areaM2 * 100) / 100);
    }
  });
});
