// @vitest-environment node
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  BuildingsFile,
  DetectionsFile,
  GraphFile,
  Manifest,
  Place,
  PlacesFile,
  RelationsFile,
} from '../../../src/data/schema.ts';
import { runBuild } from '../../../scripts/lib/pipeline.ts';
import { validateDataset } from '../../../scripts/lib/validate.ts';

const fixture = (p: string) => fileURLToPath(new URL(`../../fixtures/osm/${p}`, import.meta.url));
let root: string;
let built: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'validate-'));
  built = join(root, 'built');
  runBuild({
    inputDir: fixture('synthetic-campus'),
    curatedDir: fixture('synthetic-curated'),
    outDir: built,
    relationId: 900001,
  });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
/** Copies the built dataset, applies `mutate` to one JSON file and re-hashes the manifest. */
function corrupt<T>(file: string, mutate: (json: T) => void): string {
  const dir = join(root, `case-${n++}`);
  cpSync(built, dir, { recursive: true });
  const path = join(dir, file);
  const json = JSON.parse(readFileSync(path, 'utf8')) as T;
  mutate(json);
  writeFileSync(path, `${JSON.stringify(json)}\n`);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  const keys = Object.keys(manifest.files).sort();
  const contents = keys.map((k) => readFileSync(join(dir, manifest.files[k]!.path), 'utf8'));
  keys.forEach((k, i) => {
    manifest.files[k] = {
      path: manifest.files[k]!.path,
      bytes: Buffer.byteLength(contents[i]!),
      sha256: sha(contents[i]!),
    };
  });
  manifest.datasetVersion = sha(contents.join('')).slice(0, 12);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

async function codes(dir: string, opts: Partial<Parameters<typeof validateDataset>[0]> = {}) {
  const r = await validateDataset({ dir, ...opts });
  return { errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code), r };
}

function place(json: PlacesFile, id: string): Place {
  const found = json.places.find((p) => p.id === id);
  if (!found) throw new Error(`fixture lacks ${id}`);
  return found;
}
const first = <T>(items: T[]): T => items[0]!;
type PlaceCase = [string, (j: PlacesFile) => void, string];
type RelationCase = [string, (j: RelationsFile) => void, string];
type GraphCase = [string, (j: GraphFile) => void, string];

describe('validateDataset', () => {
  it('accepts a freshly built dataset', async () => {
    const { errors, warnings } = await codes(built);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('detects files edited after the build', async () => {
    const dir = join(root, 'stale');
    cpSync(built, dir, { recursive: true });
    writeFileSync(
      join(dir, 'places.json'),
      readFileSync(join(dir, 'places.json'), 'utf8').replace('Synthetic', 'Synthetik'),
    );
    expect((await codes(dir)).errors).toContain('manifest-hash');
  });

  it('reports a missing file and schema violations', async () => {
    const dir = corrupt<PlacesFile>('places.json', (j) => (first(j.places).displayName = ''));
    expect((await codes(dir)).errors).toContain('schema');
    rmSync(join(dir, 'graph.json'));
    expect((await codes(dir)).errors).toContain('missing-file');
  });

  it.each<PlaceCase>([
    ['duplicate place ids', (j) => j.places.push(first(j.places)), 'duplicate-id'],
    [
      'on-campus place outside the boundary',
      (j) => (place(j, 'osm:node/41').location = [75.7, 31.25]),
      'campus-zone',
    ],
    ['location outside maxBounds', (j) => (place(j, 'osm:node/41').location = [75.0, 31.0]), 'out-of-bounds'],
    ['unknown category', (j) => (first(j.places).categoryId = 'made-up'), 'category'],
    [
      // v2: way/205 (the off-campus cafe) moved to context-places.json, so a campus place is used here.
      'non-http website',
      (j) => (place(j, 'osm:way/200').contact = { website: 'ftp://example.org/x' }),
      'website',
    ],
    [
      'off-campus place in the campus file',
      (j) => (first(j.places).campusZone = 'off-campus-nearby'),
      'schema',
    ],
    [
      'place count differs from the manifest',
      (j) => j.places.push({ ...first(j.places), id: 'osm:node/999' }),
      'count-derived',
    ],
    [
      'footprint without its building place',
      (j) => (j.places = j.places.filter((p) => p.id !== 'osm:way/202')),
      'building-place',
    ],
    [
      'building place label out of sync with its footprint',
      (j) => (place(j, 'osm:way/202').displayName = 'Renamed only in places'),
      'building-place',
    ],
    ['missing graph node', (j) => (place(j, 'osm:way/200').graphNodeId = 9999), 'graph-node'],
    ['dangling buildingId', (j) => (place(j, 'osm:node/40').buildingId = 'osm:way/1'), 'building-ref'],
    [
      'entrance not on its building outline',
      (j) => (place(j, 'osm:node/11').location = [75.6892, 31.2392]),
      'entrance-outline',
    ],
    ['connector longer than allowed', (j) => (place(j, 'osm:node/41').connectorLengthM = 500), 'connector'],
  ])('places: %s', async (_name, mutate, code) => {
    expect((await codes(corrupt<PlacesFile>('places.json', mutate))).errors).toContain(code);
  });

  it.each<RelationCase>([
    ['dangling endpoint', (j) => (first(j.relations).to = 'osm:way/123456'), 'relation-ref'],
    [
      'duplicate relation',
      (j) => j.relations.push({ ...first(j.relations), id: `${first(j.relations).id}-copy` }),
      'relation-duplicate',
    ],
    ['duplicate relation id', (j) => j.relations.push(first(j.relations)), 'relation-id'],
  ])('relations: %s', async (_name, mutate, code) => {
    expect((await codes(corrupt<RelationsFile>('relations.json', mutate))).errors).toContain(code);
  });

  it.each<GraphCase>([
    ['wrong length', (j) => (first(j.edges).lengthM *= 1.05), 'graph-length'],
    ['duplicate edge', (j) => j.edges.push({ ...first(j.edges), id: j.edges.length }), 'graph-duplicate'],
    ['missing endpoint', (j) => (first(j.edges).to = 999), 'graph-endpoint'],
    ['non-dense ids', (j) => (j.edges[1]!.id = 77), 'graph-edge-id'],
    ['isolated node', (j) => j.nodes.push([75.69, 31.24]), 'graph-isolated'],
    [
      'push where walking is banned',
      (j) => Object.assign(first(j.edges), { foot: false, bicycle: 'push' }),
      'graph-access',
    ],
  ])('graph: %s', async (_name, mutate, code) => {
    expect((await codes(corrupt<GraphFile>('graph.json', mutate))).errors).toContain(code);
  });

  it('accepts a centimetre-scale edge whose only difference is lengthM rounding', async () => {
    const dir = corrupt<GraphFile>('graph.json', (j) => {
      // Two coordinates 1e-7° apart (≈ 0.95 cm): 3-dp rounding alone exceeds 1 %.
      const a: [number, number] = [75.69, 31.24];
      const b: [number, number] = [75.6900001, 31.24];
      j.nodes.push(a, b);
      j.edges.push({
        ...first(j.edges),
        id: j.edges.length,
        from: j.nodes.length - 2,
        to: j.nodes.length - 1,
        lengthM: 0.01,
      });
    });
    expect((await codes(dir)).errors).not.toContain('graph-length');
  });

  it('requires the manifest to list every dataset file', async () => {
    const dir = corrupt<GraphFile>('graph.json', () => undefined);
    const path = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    delete manifest.files.graph;
    writeFileSync(path, JSON.stringify(manifest));
    // v2: manifestSchema itself requires every REQUIRED_MANIFEST_FILE_KEYS entry (v1 reported 'manifest-files').
    expect((await codes(dir)).errors).toContain('schema');
  });

  it('checks building rings', async () => {
    const outerRing = (j: BuildingsFile) => (first(j.features).geometry.coordinates as number[][][])[0]!;
    const open = corrupt<BuildingsFile>('buildings.geojson', (j) => outerRing(j).pop());
    expect((await codes(open)).errors).toContain('ring');
    const bowtie = corrupt<BuildingsFile>('buildings.geojson', (j) => {
      const r = outerRing(j);
      [r[1], r[2]] = [r[2]!, r[1]!];
    });
    expect((await codes(bowtie)).errors).toContain('ring');
  });

  it('fails on a large count drop unless accepted, and warns on moderate changes', async () => {
    const manifest = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8')) as Manifest;
    const places = manifest.counts.places!;
    const big = { ...manifest, counts: { ...manifest.counts, places: places + 100 } };
    const failed = await codes(built, { previousManifest: big });
    expect(failed.errors).toEqual(['count-change']);
    expect(failed.r.errors[0]!.message).toMatch(/"places" changed \d+ → \d+ .*above the 40 % limit/);
    const accepted = await codes(built, { previousManifest: big, acceptCountChanges: true });
    expect(accepted.errors).toEqual([]);
    expect(accepted.warnings).toContain('count-change');
    // Proportionate: a change of fewer than 5 records is never a regression signal.
    const small = { ...manifest, counts: { ...manifest.counts, places: places + 4 } };
    expect((await codes(built, { previousManifest: small })).warnings).not.toContain('count-change');
    // 15–40 %: warning only.
    const moderate = { ...manifest, counts: { ...manifest.counts, 'graph:edges': 20 } };
    const m = await codes(built, { previousManifest: moderate });
    expect(m.errors).toEqual([]);
    expect(m.warnings).toContain('count-change');
  });

  it('warns on unparseable opening hours, suspicious count changes and broken links', async () => {
    const parseHours = (raw: string) => (raw === '24/7' ? {} : null);
    const manifest = JSON.parse(readFileSync(join(built, 'manifest.json'), 'utf8')) as Manifest;
    const previous = {
      ...manifest,
      counts: { ...manifest.counts, places: manifest.counts.places! + 6, gone: 3 },
    };
    const fetchImpl = vi.fn(
      async (url: string) =>
        ({ ok: !url.includes('cafe'), status: url.includes('cafe') ? 404 : 200 }) as Response,
    );
    const { warnings, errors, r } = await codes(built, {
      parseHours,
      previousManifest: previous,
      checkLinks: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(errors).toEqual([]);
    expect(warnings).toContain('opening-hours');
    expect(r.warnings.find((w) => w.code === 'opening-hours')!.message).toMatch(/Mo-Fr 09:00-17:00/);
    expect(r.warnings.filter((w) => w.code === 'count-change').map((w) => w.message)).toEqual([
      expect.stringMatching(/"places" changed \d+ → \d+/),
    ]);
    expect(warnings).toContain('count-missing');
    expect(r.warnings.find((w) => w.code === 'link')!.message).toMatch(/cafe answered HTTP 404/);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.org/cafe',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });
});

describe('validateDataset — v2 regression guards (owner decisions 1–3)', () => {
  type Feature = BuildingsFile['features'][number];
  const feature = (j: BuildingsFile, id: string): Feature => {
    const f = j.features.find((x) => x.properties.id === id);
    if (!f) throw new Error(`fixture lacks ${id}`);
    return f;
  };

  it('rejects an outside footprint at schema level and an uncertain one as campus-status', async () => {
    const outside = corrupt<BuildingsFile>('buildings.geojson', (j) => {
      feature(j, 'osm:way/202').properties.campusStatus = 'outside';
    });
    expect((await codes(outside)).errors).toContain('schema');
    const uncertain = corrupt<BuildingsFile>('buildings.geojson', (j) => {
      Object.assign(feature(j, 'osm:way/202').properties, {
        campusStatus: 'uncertain',
        inCampusInventory: false,
        membershipReasonCode: 'crossing-minority',
      });
    });
    expect((await codes(uncertain)).errors).toContain('campus-status');
  });

  it('re-checks the stored inside fraction with the boundary service', async () => {
    const dir = corrupt<BuildingsFile>('buildings.geojson', (j) => {
      feature(j, 'osm:way/202').properties.insideFraction = 0.6;
    });
    expect((await codes(dir)).errors).toContain('membership');
  });

  it('rejects an unresolved duplicate footprint and a repeated map key', async () => {
    const dup = corrupt<BuildingsFile>('buildings.geojson', (j) => {
      const f = feature(j, 'osm:way/202');
      j.features.push({ ...f, properties: { ...f.properties, id: 'osm:way/999202' } });
    });
    expect((await codes(dup)).errors).toContain('duplicate-footprint');
    const keys = corrupt<BuildingsFile>('buildings.geojson', (j) => {
      for (const id of ['osm:way/200', 'osm:way/202'])
        Object.assign(feature(j, id).properties, { directoryKey: 'A1-01', directoryCell: 'A1' });
    });
    expect((await codes(keys)).errors).toContain('directory-key');
  });

  it('keeps context places off campus and never as buildings', async () => {
    const inside = corrupt<PlacesFile>('context-places.json', (j) => {
      first(j.places).location = [75.69, 31.24];
    });
    expect((await codes(inside)).errors).toContain('context-inside');
    const building = corrupt<PlacesFile>('context-places.json', (j) => {
      first(j.places).kind = 'building';
    });
    expect((await codes(building)).errors).toContain('schema');
  });

  it('rejects a detection that duplicates a campus building', async () => {
    const dir = corrupt<DetectionsFile>('detections.geojson', (j) => {
      const buildings = JSON.parse(readFileSync(join(built, 'buildings.geojson'), 'utf8')) as BuildingsFile;
      j.features.push({
        type: 'Feature',
        geometry: feature(buildings, 'osm:way/202')
          .geometry as DetectionsFile['features'][number]['geometry'],
        properties: {
          id: 'det:microsoft-ml:0123456789abcdef',
          source: 'microsoft-ml',
          geometryKind: 'footprint',
          sourceRef: 'synthetic',
          areaM2: 100,
          confidence: null,
          matchedOsmId: null,
          matchIoU: null,
          confirmedBy: [],
          campusStatus: 'inside',
          insideFraction: 1,
          reviewSectionId: null,
          reviewStatus: 'unreviewed',
        },
      });
    });
    const { errors } = await codes(dir);
    expect(errors).toContain('detection-matched');
    expect(errors).toContain('detection-source'); // and its source has no licensed manifest record
  });

  it('requires the v2 campus flag on every graph edge', async () => {
    const dir = corrupt<GraphFile>('graph.json', (j) => {
      delete first(j.edges).campus;
    });
    expect((await codes(dir)).errors).toContain('graph-campus-flag');
  });

  it('fails when a required landmark disappears', async () => {
    const landmarks = {
      landmarks: [
        { id: 'osm:way/200', in: ['buildings' as const, 'places' as const], why: 'named synthetic library' },
        { id: 'osm:relation/900001', in: ['boundary' as const], why: 'synthetic boundary' },
      ],
    };
    expect((await codes(built, { landmarks })).errors).toEqual([]);
    const gone = {
      landmarks: [...landmarks.landmarks, { id: 'osm:way/1', in: ['buildings' as const], why: 'gone' }],
    };
    const r = await codes(built, { landmarks: gone });
    expect(r.errors).toEqual(['landmark-missing']);
  });
});
