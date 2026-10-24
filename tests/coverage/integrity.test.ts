// @vitest-environment node
/**
 * Building coverage, integrity on the REAL dataset: campus search never
 * returns excluded buildings or (by default) context places; map keys are
 * unique and attached to the ids in the lock; labels agree between footprint
 * and place; building ↔ place ↔ relation references resolve; the routing
 * graph and the set of routable campus places do not regress against the
 * dataset committed at git HEAD; detections never duplicate an inventory
 * footprint; the generated coverage document is in sync.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSearchDocs, buildServices } from '../../src/app/data/services.ts';
import type { Manifest, Place } from '../../src/data/schema.ts';
import { createBoundary } from '../../src/geo/boundary.ts';
import type { PolygonalGeometry } from '../../src/geo/boundary.ts';
import { createSearchIndex, docsFromPlaces } from '../../src/search/index.ts';
import { pointInMultiPolygon } from '../../scripts/lib/geometry.ts';
import type { MultiPolygon } from '../../scripts/lib/geometry.ts';
import { gridCellOf, keyCell, LOCK_FILE, readLock } from '../../scripts/lib/directory-keys.ts';
import { committedJson, CURATED_DIR, loadRealData, REPO } from './real-data.ts';
import type { RealData } from './real-data.ts';

let data: RealData;
let shipped: Set<string>;
/** Footprints of the raw snapshot that are NOT campus inventory (outside, uncertain, duplicate). */
let excluded: string[];

beforeAll(() => {
  data = loadRealData();
  shipped = new Set(data.buildings.features.map((f) => f.properties.id));
  excluded = [
    ...data.quality.membership.outside.map((o) => o.id),
    ...data.quality.membership.uncertain.map((o) => o.id),
    ...data.quality.duplicatesResolved.map((d) => d.dropped),
  ];
});

const mapKeys = (d: RealData) => {
  const keys = new Map(d.buildings.features.map((f) => [f.properties.id, f.properties.directoryKey]));
  return (id: string) => keys.get(id);
};

describe('search', () => {
  it('the app search index holds no excluded building and no context place', () => {
    // The exact docs the app indexes (src/app/data/services.ts), built from the loaded campus data.
    const services = buildServices(data);
    const docs = buildSearchDocs(services.directory.all, services.categoryCounts, services.locatedCounts, data.relations);
    const refs = new Set(docs.filter((d) => d.kind === 'place').map((d) => d.ref));
    for (const id of excluded) expect(refs.has(id), id).toBe(false);
    for (const p of data.contextPlaces) expect(refs.has(p.id), p.id).toBe(false);
    for (const ref of refs) expect(data.places.some((p) => p.id === ref), ref).toBe(true);
  });

  it('searching for the name of an excluded or off-campus feature never returns it', () => {
    const docs = docsFromPlaces(data.places, { mapKey: mapKeys(data) });
    const index = createSearchIndex(docs);
    const offCampusNamed = data.contextPlaces.filter((p) => p.name).slice(0, 60);
    expect(offCampusNamed.length).toBeGreaterThan(0);
    const offIds = new Set(data.contextPlaces.map((p) => p.id));
    for (const p of offCampusNamed)
      for (const hit of index.search(p.name!)) expect(offIds.has(hit.doc.ref), `${p.name} → ${hit.doc.ref}`).toBe(false);
    for (const hit of docs) expect(excluded.includes(hit.ref), hit.ref).toBe(false);
  });

  it('context places become searchable only when the opt-in layer is enabled, labelled "Outside campus"', () => {
    const withContext = docsFromPlaces([...data.places, ...data.contextPlaces], { includeContext: true });
    const ctx = withContext.filter((d) => data.contextPlaces.some((p) => p.id === d.ref));
    expect(ctx.length).toBeGreaterThan(0);
    for (const d of ctx) expect(d.subtitle, d.ref).toContain('Outside campus');
    expect(docsFromPlaces([...data.places, ...data.contextPlaces]).some((d) => ctx.some((c) => c.ref === d.ref))).toBe(
      false,
    );
  });

  it('category counts come from campus data only (context places never counted)', () => {
    const services = buildServices(data);
    const total = Object.values(services.categoryCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(data.places.length);
    for (const [cat, n] of Object.entries(services.categoryCounts)) expect(data.manifest.counts[`category:${cat}`], cat).toBe(n);
  });
});

describe('map keys and labels', () => {
  it('keys are unique, match the lock, sit in the cell of their anchor and never pose as official numbers', () => {
    const lock = readLock(join(CURATED_DIR, LOCK_FILE))!;
    const keys = data.buildings.features.flatMap((f) => (f.properties.directoryKey ? [f.properties.directoryKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(data.manifest.counts['directory:keyed']);
    for (const f of data.buildings.features) {
      const p = f.properties;
      expect(p.directoryKey, p.id).toBe(lock.keys[p.id] ?? null);
      expect(p.officialBlockLabel, p.id).toBeNull();
      expect(p.officialBlockSourceId, p.id).toBeNull();
      if (p.directoryKey) {
        expect(p.directoryCell, p.id).toBe(keyCell(p.directoryKey));
        expect(gridCellOf([p.anchorLon, p.anchorLat]).cell, p.id).toBe(p.directoryCell);
      }
    }
    // Lock keys only for inventory buildings (none for excluded footprints).
    for (const id of Object.keys(lock.keys)) expect(shipped.has(id), id).toBe(true);
    for (const id of excluded) expect(lock.keys[id], id).toBeUndefined();
  });

  it('a footprint and its building place carry the same identity, label and category', () => {
    const byId = new Map(data.places.map((p) => [p.id, p]));
    for (const f of data.buildings.features) {
      const place = byId.get(f.properties.id);
      expect(place, f.properties.id).toBeDefined();
      expect(place!).toMatchObject({
        kind: 'building',
        name: f.properties.name,
        displayName: f.properties.displayName,
        categoryId: f.properties.categoryId,
        campusZone: 'on-campus',
      });
    }
  });
});

describe('building ↔ place ↔ relation integrity', () => {
  it('every building place has a footprint and every buildingId resolves to one', () => {
    for (const p of data.places) {
      if (p.kind === 'building') expect(shipped.has(p.id), p.id).toBe(true);
      if (p.buildingId !== undefined) expect(shipped.has(p.buildingId), `${p.id} → ${p.buildingId}`).toBe(true);
    }
  });

  it('every relation joins two campus places; located_in/part_of point at a container that exists', () => {
    const ids = new Set(data.places.map((p) => p.id));
    for (const r of data.relations) {
      expect(ids.has(r.from), r.id).toBe(true);
      expect(ids.has(r.to), r.id).toBe(true);
    }
    expect(data.relations.length).toBe(data.manifest.counts.relations);
  });

  it('places.json is campus-only; context-places.json is off-campus points only', () => {
    for (const p of data.places) expect(p.campusZone, p.id).toBe('on-campus');
    for (const p of data.contextPlaces) expect(p.campusZone, p.id).toBe('off-campus-nearby');
    const both = data.places.filter((p) => data.contextPlaces.some((c) => c.id === p.id));
    expect(both).toEqual([]);
  });
});

describe('graph regression against the dataset committed at git HEAD', () => {
  const committedManifest = committedJson<Manifest>('manifest.json');
  const committedPlaces = committedJson<{ places: Place[] }>('places.json');

  it.skipIf(!committedManifest)('component count does not grow and the largest component does not shrink', () => {
    const c = data.manifest.counts;
    const b = committedManifest!.counts;
    expect(c['graph:components']!).toBeLessThanOrEqual(b['graph:components']!);
    expect(c['graph:largestComponentNodes']!).toBeGreaterThanOrEqual(b['graph:largestComponentNodes']!);
    expect(data.graph.edges.every((e) => typeof e.campus === 'boolean')).toBe(true);
    expect(data.graph.edges.filter((e) => e.campus).length).toBe(c['graph:campusEdges']);
  });

  it.skipIf(!committedPlaces)('every routable campus place of the baseline is still routable, or is explained', () => {
    const now = new Map(data.places.map((p) => [p.id, p]));
    const reviewIds = new Set(data.review.items.map((i) => i.id));
    const duplicateIds = new Set(data.quality.duplicatesResolved.map((d) => d.dropped));
    const unexplained: string[] = [];
    let baselineRoutable = 0;
    for (const p of committedPlaces!.places) {
      if (p.campusZone !== 'on-campus' || p.graphNodeId === undefined) continue;
      baselineRoutable++;
      const cur = now.get(p.id);
      if (cur?.graphNodeId !== undefined) continue;
      if (reviewIds.has(p.id) || duplicateIds.has(p.id)) continue; // held for boundary review / duplicate removed
      unexplained.push(p.id);
    }
    expect(baselineRoutable).toBeGreaterThan(0);
    expect(unexplained).toEqual([]);
  });
});

describe('detections never duplicate the campus inventory', () => {
  it('no detection polygon matches an inventory footprint (IoU < 0.3 and < 50 % covered); no point inside one', () => {
    const inventory = data.buildings.features.map((f) => ({
      id: f.properties.id,
      geometry: f.geometry as PolygonalGeometry,
      mp: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as MultiPolygon,
    }));
    for (const d of data.detections.features) {
      const p = d.properties;
      expect(p.matchedOsmId, p.id).toBeNull();
      expect(p.campusStatus, p.id).not.toBe('outside');
      expect(Object.keys(p)).not.toContain('name');
      expect(Object.keys(p)).not.toContain('directoryKey');
      if (d.geometry.type === 'Point') {
        const pt = d.geometry.coordinates as [number, number];
        for (const o of inventory) expect(pointInMultiPolygon(pt, o.mp), `${p.id} in ${o.id}`).toBe(false);
        continue;
      }
      const region = createBoundary(d.geometry as PolygonalGeometry);
      let covered = 0;
      for (const o of inventory) {
        const inter = region.intersectionAreaM2(o.geometry);
        if (inter <= 0) continue;
        covered += inter;
        const other = createBoundary(o.geometry).areaM2;
        expect(inter / (region.areaM2 + other - inter), `${p.id} vs ${o.id}`).toBeLessThan(0.3);
      }
      expect(covered / region.areaM2, p.id).toBeLessThan(0.5);
    }
    const ids = new Set(data.detections.features.map((f) => f.properties.id));
    for (const id of ids) expect(shipped.has(id) || data.places.some((p) => p.id === id), id).toBe(false);
  });
});

describe('generated documents are in sync with the processed data', () => {
  it('docs/CAMPUS_BUILDING_COVERAGE.md was written by the build of this dataset', () => {
    const md = readFileSync(join(REPO, 'docs', 'CAMPUS_BUILDING_COVERAGE.md'), 'utf8');
    expect(md).toContain('GENERATED by scripts/build-data.ts');
    expect(md).toContain(`Dataset \`${data.manifest.datasetVersion}\``);
    expect(md).toMatch(new RegExp(`\\*\\*Campus inventory \\(buildings\\.geojson\\)\\*\\*\\s*\\|\\s*\\*\\*${data.buildings.features.length}\\*\\*`));
    expect(md).toContain('## Count-change guard');
    const report = readFileSync(join(REPO, 'docs', 'DATA_QUALITY_REPORT.md'), 'utf8');
    expect(report).toContain(data.manifest.datasetVersion);
  });
});
