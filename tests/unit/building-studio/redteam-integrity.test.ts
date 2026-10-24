/**
 * Integrity red team (Building Studio), client side, on the REAL dataset:
 *  - generator v1 is frozen: every starter template variant still produces
 *    the exact mesh and footprint it produced when instances were published
 *    (golden hashes); a behaviour change needs a new generator version;
 *  - one building = one id in realistic 3D, the overview, 2D, search, the
 *    directory, saved places and the URL; no duplicate public records;
 *  - published studio buildings and base-building models survive a dataset
 *    regeneration (rebuilt from a modified raw snapshot into a TEMP dir);
 *  - detection, context and held-for-review records never enter the campus
 *    inventory through the studio merge;
 *  - a model the merge must not draw as authored (ignored position
 *    correction) is drawn as its footprint prism in BOTH 3D renderers;
 *  - honesty: a modelled base building's place carries the S3 label and never
 *    the base height estimate as if it described the model; a verified record
 *    of a generic template says the shape is generic;
 *  - routing is never inferred from a drawn position (picking a place on the
 *    map included);
 *  - in-flight saves never discard or falsely mark newer local edits as saved;
 *  - Google Maps / Street View URLs are caught behind redirect, consent and
 *    archive wrappers, encodings and Street View image endpoints.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPublication } from '../../../src/app/data/apply-publication.ts';
import { buildAppServices } from '../../../src/app/data/services.ts';
import { buildPlaceUrl, parsePlaceParam } from '../../../src/app/deep-link.ts';
import { placeEndpoint } from '../../../src/app/place-actions.ts';
import {
  modelFromVariant,
  STARTER_TEMPLATE_VERSIONS,
  starterTemplate,
} from '../../../src/building-studio/asset-library.ts';
import {
  currentDraft,
  editorReducer,
  editorStatus,
  initialEditorState,
  type EditorAction,
  type EditorState,
} from '../../../src/building-studio/editor-state.ts';
import { createEnuFrame, deriveFootprint } from '../../../src/building-studio/footprint.ts';
import { GENERIC_SHAPE_NOTE, studioPublicLabel } from '../../../src/building-studio/labels.ts';
import { canonicalJson, hashString, meshHash } from '../../../src/building-studio/mesh/cache.ts';
import { generateStudioMesh } from '../../../src/building-studio/mesh/generate.ts';
import { mergeStudioBuildings } from '../../../src/building-studio/merge.ts';
import {
  clearStudioInstanceMemo,
  studioInstanceFor,
} from '../../../src/building-studio/render/maplibre/instances.ts';
import {
  VERIFICATION_LABELS,
  type PublishedStudioBuilding,
  type StudioBuildingHead,
  type StudioDraft,
} from '../../../src/building-studio/schema.ts';
import { containsProhibitedSourceUrl, isProhibitedSourceUrl } from '../../../src/building-studio/text.ts';
import { EMPTY_PUBLICATION, type Publication } from '../../../src/community/schema.ts';
import { heightText, studioModelLabel } from '../../../src/components/place/place-format.ts';
import type { CampusData } from '../../../src/data/campus-data.ts';
import {
  basemapFileSchema,
  boundaryFileSchema,
  boundaryReviewFileSchema,
  buildingsFileSchema,
  createOptionalLoaders,
  DATA_FILES,
  graphFileSchema,
  manifestSchema,
  placesFileSchema,
  relationsFileSchema,
  type LngLat,
} from '../../../src/data/index.ts';
import { isoStudioModel } from '../../../src/isometric/studio.ts';
import { ANCHOR, STU_ID, T, draft, model, published } from './fixtures.ts';
import { realData } from './real-data.ts';

const { campus } = realData();
const REPO = process.cwd();
const reviewFile = boundaryReviewFileSchema.parse(
  JSON.parse(readFileSync(join(REPO, 'public', 'data', DATA_FILES.boundaryReview), 'utf8')),
);
const review = { sections: reviewFile.sections, decisions: reviewFile.decisions };
const ID2 = 'stu:bbbbbbbbbbbbbbbbbbbbbbbb';
const ID3 = 'stu:cccccccccccccccccccccccc';

const pub = (over: Partial<Publication> = {}): Publication => ({
  ...EMPTY_PUBLICATION,
  publicationVersion: 9,
  generatedAt: T,
  ...over,
});

const featureOf = (data: CampusData, id: string) =>
  data.buildings.features.find((f) => f.properties.id === id);

/** A base-building model (footprint-prism) of `targetId` in `data`. */
function baseModelOf(data: CampusData, targetId: string, over: Partial<PublishedStudioBuilding> = {}) {
  const f = featureOf(data, targetId)!;
  return published({
    id: ID2,
    targetId,
    identity: null,
    model: model({
      anchor: [f.properties.anchorLon, f.properties.anchorLat],
      rotationDeg: 0,
      generatorId: 'footprint-prism',
      shape: { kind: 'footprint-prism' },
      heightM: 32,
      floors: 10,
    }),
    footprint: { type: 'Polygon', coordinates: f.geometry.coordinates as LngLat[][] },
    ...over,
  });
}

// ---------------------------------------------------------------------------
// 1. Generator v1 freeze (golden hashes)
// ---------------------------------------------------------------------------

/**
 * meshHash and a footprint hash (1e-9° rounding) of every starter variant at
 * ANCHOR, rotated 30°. Published instances store their full config and are
 * re-meshed by the CURRENT generator code on every client: if any value here
 * changes, published buildings would silently change shape. Add a new
 * generator version instead (docs/BUILDING_STUDIO_DESIGN.md §12).
 */
const GOLDEN: Record<string, [string, string]> = {
  'academic-block@1/plain': ['1ed04b6e256994', '10ab000ae0feb0'],
  'academic-block@1/ribbon-hip': ['1990ace97a93c0', '080988c5470d33'],
  'academic-block@1/grid-tall': ['0c9eefbf3c9d88', '190447764a8e0f'],
  'lecture-hall@1/gable': ['076af413e75a15', '1cf0478bac8604'],
  'lecture-hall@1/shed': ['1d4f2fd35a87e5', '085516ccad08fb'],
  'lab-research@1/grid': ['1fbed66ba64ffa', '03be456c963bc9'],
  'lab-research@1/ribbon': ['07e38874637401', '125147c1c22b96'],
  'hostel-multistorey@1/balcony-slab': ['1fafbea7a40981', '0058ae87eb673d'],
  'hostel-multistorey@1/hipped-brick': ['1d932f941fde82', '117dfba8def404'],
  'hostel-multistorey@1/ribbon-tall': ['09b19ffb43fbf7', '0da3c51ecacd8a'],
  'residential@1/flat-balconies': ['0755fcf5f6dffb', '1556ddbf962253'],
  'residential@1/gabled-house': ['0d1abff9d695a6', '01ce7e3676013d'],
  'residential@1/hipped-house': ['1df3c6452c7385', '1b75c09efa3269'],
  'canteen-kiosk@1/front-canopy': ['17d61c73467e65', '032ffac157b18c'],
  'canteen-kiosk@1/side-canopy-shed': ['0a582c89b7d537', '12721f311082a5'],
  'retail-service@1/shopfront': ['074550f8673d98', '1f37ec6e4a85f8'],
  'retail-service@1/shed-unit': ['1ac8b504755a71', '171cad96508acc'],
  'administrative@1/l-punched': ['1dc67226589403', '0a5e42898b176b'],
  'administrative@1/l-ribbon': ['07d92b118e4c2b', '1842b823fd39cd'],
  'library@1/courtyard': ['01c5328becdc4f', '1ec544794ecaaf'],
  'library@1/open-u': ['1d863d3ff28c54', '0b719c320562a4'],
  'auditorium@1/gable': ['10e0347abd88cc', '0c2b14fc98f20f'],
  'auditorium@1/flat-blind': ['03b26908a9d64b', '03dda3e20031b5'],
  'sports-facility@1/gable-hall': ['0f80ec3588c34a', '1c00fc269d1f5c'],
  'sports-facility@1/shed-hall': ['04727d0306f6df', '01aea0b92bfa15'],
  'sports-facility@1/flat-pavilion': ['1905cc890f6e26', '085516ccad08fb'],
  'parking-structure@1/open-deck': ['18b8caa64e5eb1', '024a5f7744e985'],
  'utility@1/plant-room': ['0490bdda51274c', '1901674e59f49d'],
  'small-single-storey@1/flat': ['01d67ac1f01e70', '033698f8b99238'],
  'small-single-storey@1/gable': ['114423f1cb87f3', '033698f8b99238'],
  'generic-low-rise@1/flat': ['1494c4668f29e1', '040caf97cfa4b0'],
  'generic-mid-rise@1/two-tier': ['0b0c2a83f456f7', '1e0666b01cdeba'],
  'generic-mid-rise@1/three-tier': ['1207b239768d26', '106b3101845eb3'],
  'generic-high-rise@1/curtain-tower': ['1654454dc062cb', '021d331b38d084'],
  'generic-high-rise@1/grid-tower': ['0959df01aad732', '036332e76f49be'],
};

function variantHashes(): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  const r9 = (x: number) => Math.round(x * 1e9) / 1e9 + 0;
  for (const { draft: d, version } of STARTER_TEMPLATE_VERSIONS) {
    const def = starterTemplate(d.id, version)!.definition;
    for (const v of def.variants) {
      const m = modelFromVariant(v, { anchor: ANCHOR, rotationDeg: 30 });
      const mesh = generateStudioMesh(m);
      const fp = deriveFootprint(m);
      if (!mesh.ok || !fp.ok) throw new Error(`${def.id}/${v.id} does not generate`);
      out[`${def.id}@${def.version}/${v.id}`] = [
        meshHash(mesh.mesh),
        hashString(canonicalJson(fp.footprint.coordinates.map((ring) => ring.map((p) => p.map(r9))))),
      ];
    }
  }
  return out;
}

describe('generator v1 is frozen: published instances keep their exact geometry', () => {
  it('every starter variant matches its golden mesh and footprint hash', () => {
    const now = variantHashes();
    expect(Object.keys(now).length).toBeGreaterThanOrEqual(30);
    for (const [k, v] of Object.entries(GOLDEN)) expect(now[k], k).toEqual(v);
    // A new template version may add entries; no released variant may disappear or change.
    expect(Object.keys(GOLDEN).every((k) => k in now)).toBe(true);
  });

  it('meshing is a pure function of the stored config (same config, same bytes)', () => {
    const m = modelFromVariant(starterTemplate('academic-block', 1)!.definition.variants[0]!, {
      anchor: ANCHOR,
      rotationDeg: 30,
    });
    const a = generateStudioMesh(structuredClone(m));
    const b = generateStudioMesh(JSON.parse(JSON.stringify(m)) as typeof m);
    if (!a.ok || !b.ok) throw new Error('no mesh');
    expect(meshHash(a.mesh)).toBe(meshHash(b.mesh));
  });
});

// ---------------------------------------------------------------------------
// 2. One building, one id, every view
// ---------------------------------------------------------------------------

describe('one id in realistic 3D, the overview, 2D, search, the directory, saved places and the URL', () => {
  const optional = {
    ...createOptionalLoaders(campus.manifest, { fetchImpl: () => Promise.reject(new Error('offline')) }),
    boundaryReview: () => Promise.resolve(reviewFile as never),
  };
  const live = (p: Publication) => ({
    status: {
      kind: 'live' as const,
      publicationVersion: p.publicationVersion,
      generatedAt: p.generatedAt,
      buildings: p.buildings?.length ?? 0,
    },
    publication: p,
  });
  const TARGET = 'osm:way/1550425052';

  it('new building and base model: exactly one record each, same id everywhere, no record id leaks', async () => {
    const s = (
      await buildAppServices(
        campus,
        live(pub({ buildings: [published(), baseModelOf(campus, TARGET)] })),
        optional,
      )
    ).services;
    for (const [publicId, recordId] of [
      [STU_ID, STU_ID],
      [TARGET, ID2],
    ] as const) {
      // 2D / picking: one footprint feature; one place (details, favourites resolve through it).
      expect(s.data.buildings.features.filter((f) => f.properties.id === publicId)).toHaveLength(1);
      expect(s.data.places.filter((p) => p.id === publicId && p.kind === 'building')).toHaveLength(1);
      expect(s.getPlace(publicId)?.id).toBe(publicId);
      // Search: one place doc; directory: one entry.
      // (an unnamed base building is found by its map key, D6)
      const query =
        s.getPlace(publicId)!.name ?? featureOf(s.data, publicId)!.properties.directoryKey ?? publicId;
      const docs = s.searchIndex.search(query, { limit: 500 });
      expect(docs.filter((h) => h.doc.ref === publicId)).toHaveLength(1);
      expect(s.buildingDirectory.byId.get(publicId)?.id).toBe(publicId);
      // Realistic 3D and the overview: one model with the same id.
      const models = s.studioModels.filter((m) => m.publicId === publicId);
      expect(models).toHaveLength(1);
      clearStudioInstanceMemo();
      expect(studioInstanceFor(models[0]!).instance.id).toBe(publicId);
      expect(isoStudioModel(models[0]!).id).toBe(publicId);
      // URL: the deep link round-trips the public id.
      const url = buildPlaceUrl('https://atlas.test/?view=iso', publicId);
      expect(parsePlaceParam(new URL(url).search)).toBe(publicId);
      if (recordId !== publicId) {
        expect(s.getPlace(recordId)).toBeUndefined();
        expect(s.searchIndex.search(recordId, { limit: 500 }).some((h) => h.doc.ref === recordId)).toBe(
          false,
        );
        expect(s.buildingDirectory.byId.has(recordId)).toBe(false);
      }
    }
    // No duplicate public records at all.
    const ids = s.data.places.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const fids = s.data.buildings.features.map((f) => f.properties.id);
    expect(new Set(fids).size).toBe(fids.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Dataset regeneration (temp build from a modified raw snapshot)
// ---------------------------------------------------------------------------

const REMOVED = 'osm:way/1566888543';
const KEPT = 'osm:way/1550425052';
let tmp: string | null = null;
let regen: CampusData | null = null;

function loadDataset(dir: string): CampusData {
  const read = <S extends z.ZodType>(schema: S, file: string): z.infer<S> =>
    schema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  return {
    manifest: read(manifestSchema, DATA_FILES.manifest),
    boundary: read(boundaryFileSchema, DATA_FILES.boundary),
    buildings: read(buildingsFileSchema, DATA_FILES.buildings),
    basemap: read(basemapFileSchema, DATA_FILES.basemap),
    places: read(placesFileSchema, DATA_FILES.places).places,
    relations: read(relationsFileSchema, DATA_FILES.relations).relations,
    graph: read(graphFileSchema, DATA_FILES.graph),
  };
}

beforeAll(() => {
  // A copy of the raw OSM snapshot without one mapped building, built into a temp dir (never public/data).
  tmp = mkdtempSync(join(tmpdir(), 'lpu-studio-regen-'));
  const raw = join(tmp, 'osm');
  cpSync(join(REPO, 'data', 'raw', 'osm'), raw, { recursive: true });
  const file = join(raw, 'campus-bbox.osm');
  const xml = readFileSync(file, 'utf8');
  const way = REMOVED.split('/')[1]!;
  const edited = xml.replace(new RegExp(`<way id="${way}"[\\s\\S]*?</way>\\s*`), '');
  if (edited === xml) throw new Error('target way not found in the raw snapshot');
  writeFileSync(file, edited);
  execFileSync(
    process.execPath,
    [join(REPO, 'scripts', 'build-data.ts'), '--input', raw, '--out', join(tmp, 'out')],
    {
      cwd: REPO,
      stdio: 'pipe',
    },
  );
  regen = loadDataset(join(tmp, 'out'));
}, 120_000);

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('studio buildings and base-building models survive a dataset regeneration', () => {
  it('ids stay stable; a vanished target becomes an orphan and is never applied to another building', () => {
    const data = regen!;
    expect(featureOf(data, REMOVED)).toBeUndefined();
    expect(featureOf(data, KEPT)).toBeDefined();
    const records = [published(), baseModelOf(campus, KEPT), baseModelOf(campus, REMOVED, { id: ID3 })];
    const before = applyPublication(campus, pub({ buildings: records }), review);
    const after = applyPublication(data, pub({ buildings: records }), review);
    // Same new building: identical feature and place before and after the rebuild.
    const stuBefore = before.data.places.find((p) => p.id === STU_ID);
    expect(after.data.places.find((p) => p.id === STU_ID)).toEqual(stuBefore);
    expect(featureOf(after.data, STU_ID)).toEqual(featureOf(before.data, STU_ID));
    // The kept base model still applies to the same base id.
    expect(after.report?.studio?.modelled).toEqual([ID2]);
    expect(featureOf(after.data, KEPT)?.properties.renderHeightSource).toBe('studio-model');
    // The removed target: orphan, reported, kept out of every view, applied to nothing else.
    expect(before.report?.studio?.modelled).toEqual(expect.arrayContaining([ID2, ID3]));
    expect(after.report?.studio?.orphan).toEqual([ID3]);
    expect(after.studioModels.map((m) => m.recordId).sort()).toEqual([STU_ID, ID2].sort());
    const modelled = after.data.buildings.features.filter(
      (f) => f.properties.renderHeightSource === 'studio-model',
    );
    expect(modelled.map((f) => f.properties.id).sort()).toEqual([KEPT, STU_ID].sort());
    expect(after.data.places.some((p) => p.id === REMOVED || p.id === ID3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Detection, context and held-for-review records never join the inventory
// ---------------------------------------------------------------------------

describe('the studio merge never adds detection, context or held-for-review records to the campus', () => {
  it('such targets are invalid or orphans; places, buildings and counts are unchanged', () => {
    const held = reviewFile.items.find((i) => i.id.startsWith('osm:way/'))!;
    expect(featureOf(campus, held.id)).toBeUndefined();
    const r = mergeStudioBuildings({
      data: campus,
      buildings: [
        baseModelOf(campus, KEPT, { id: ID2, targetId: 'det:google-open-buildings:1c9ac548b9c0fe58' }),
        baseModelOf(campus, KEPT, { id: ID3, targetId: 'osm:node/12031088561' }),
        baseModelOf(campus, KEPT, { id: 'stu:dddddddddddddddddddddddd', targetId: held.id }),
      ],
      reviewSections: review.sections,
      curatedDecisions: review.decisions,
    });
    expect(r.report.invalid.map((i) => i.id).sort()).toEqual([ID2, ID3].sort());
    expect(r.report.orphan).toEqual(['stu:dddddddddddddddddddddddd']);
    expect(r.studioModels).toEqual([]);
    expect(r.data.places).toHaveLength(campus.places.length);
    expect(r.data.buildings.features).toHaveLength(campus.buildings.features.length);
    expect(r.data.manifest.counts.buildings).toBe(campus.manifest.counts.buildings);
    expect(r.data.manifest.counts.places).toBe(campus.manifest.counts.places);
  });
});

// ---------------------------------------------------------------------------
// 5. A model the merge must not draw as authored
// ---------------------------------------------------------------------------

describe('an ignored position correction is drawn as the base footprint prism in both 3D modes', () => {
  it('neither renderer draws the model at the rejected (off-campus) position', () => {
    const TARGET = 'osm:way/422823421';
    const f = featureOf(campus, TARGET)!;
    const off: LngLat = [75.69, 31.25];
    const offFootprint = deriveFootprint(model({ anchor: off, rotationDeg: 0 }));
    if (!offFootprint.ok) throw new Error(offFootprint.message);
    const r = mergeStudioBuildings({
      data: campus,
      buildings: [
        baseModelOf(campus, TARGET, {
          positionCorrected: true,
          model: model({ anchor: off, rotationDeg: 0 }),
          footprint: offFootprint.footprint,
        }),
      ],
    });
    expect(r.report.correctionsIgnored).toEqual([ID2]);
    const rm = r.studioModels[0]!;
    expect(rm.modelAvailable).toBe(false);

    const ring = f.geometry.coordinates[0] as LngLat[];
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const inBaseBox = ([lon, lat]: LngLat) =>
      lon >= Math.min(...lons) - 1e-6 &&
      lon <= Math.max(...lons) + 1e-6 &&
      lat >= Math.min(...lats) - 1e-6 &&
      lat <= Math.max(...lats) + 1e-6;
    const vertices = (mesh: { origin: LngLat; faces: { ring: readonly (readonly number[])[] }[] }) => {
      const frame = createEnuFrame(mesh.origin);
      return mesh.faces.flatMap((face) => face.ring.map((v) => frame.toLngLat([v[0]!, v[1]!])));
    };

    clearStudioInstanceMemo();
    const inst = studioInstanceFor(rm);
    expect(inst.modelAvailable).toBe(false);
    expect(vertices(inst.instance.mesh).every((p) => inBaseBox([p[0], p[1]]))).toBe(true);

    const iso = isoStudioModel(rm, { baseFootprint: rm.footprint.coordinates });
    expect(iso.fallback).toBe(true);
    expect(vertices(iso.mesh).every((p) => inBaseBox([p[0], p[1]]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Honesty labels
// ---------------------------------------------------------------------------

describe('honesty labels wherever a studio model is shown', () => {
  it("a modelled base building's place carries the S3 label and no base height posing as the model's", () => {
    const TARGET = 'osm:way/1550425052';
    const basePlace = campus.places.find((p) => p.id === TARGET)!;
    expect(basePlace.heightM).toBeDefined();
    const r = mergeStudioBuildings({ data: campus, buildings: [baseModelOf(campus, TARGET)] });
    const place = r.data.places.find((p) => p.id === TARGET)!;
    expect(place.heightSource).toBe('studio-model');
    expect(place.heightM).toBeUndefined();
    expect(place.provenance.notes).toBe(VERIFICATION_LABELS.unverified);
    expect(studioModelLabel(place)).toBe(VERIFICATION_LABELS.unverified);
    expect(heightText(place)).toMatch(/illustrative height of an owner-placed model/);
    // Identity, location, access and source stay the base building's.
    expect(place).toMatchObject({
      name: basePlace.name,
      displayName: basePlace.displayName,
      location: basePlace.location,
      graphNodeId: basePlace.graphNodeId,
      provenance: { sourceId: basePlace.provenance.sourceId, verificationStatus: 'imported' },
    });
    expect(campus.places.find((p) => p.id === TARGET)).toEqual(basePlace); // base snapshot untouched
  });

  it('a verified record of a generic template never reads as a verified real design', () => {
    const sourceBacked = {
      status: 'source-backed' as const,
      citation: { url: 'https://example.org/plan', title: 'Campus plan', accessedOn: '2026-10-01' },
      note: 'Shown on the published campus plan.',
    };
    const r = mergeStudioBuildings({
      data: campus,
      buildings: [published({ verification: sourceBacked, accuracyClass: 'generic-prefab' })],
    });
    const notes = r.data.places.find((p) => p.id === STU_ID)!.provenance.notes!;
    expect(notes).toContain(VERIFICATION_LABELS['source-backed']);
    expect(notes).toContain(GENERIC_SHAPE_NOTE);
    expect(
      studioPublicLabel({ verification: { status: 'unverified' }, accuracyClass: 'generic-prefab' }),
    ).toBe(VERIFICATION_LABELS.unverified);
    expect(studioPublicLabel({ verification: sourceBacked, accuracyClass: 'source-backed' })).toBe(
      VERIFICATION_LABELS['source-backed'],
    );
    // The overview's info card says the same.
    expect(isoStudioModel(r.studioModels[0]!).verificationLabel).toBe(notes);
  });
});

// ---------------------------------------------------------------------------
// 7. Routing is never inferred from a drawn position
// ---------------------------------------------------------------------------

describe('routing only through a validated access node', () => {
  it('a place without a path node has no route endpoint (map picking included)', () => {
    const r = mergeStudioBuildings({ data: campus, buildings: [published({ accessNodeId: null })] });
    const place = r.data.places.find((p) => p.id === STU_ID)!;
    expect(place.graphNodeId).toBeUndefined();
    expect(placeEndpoint(place)).toBeNull();
    const connected = campus.places.find((p) => p.location !== null && p.graphNodeId !== undefined)!;
    expect(placeEndpoint(connected)).toMatchObject({ kind: 'place', nodeId: connected.graphNodeId });
    const unconnected = campus.places.find((p) => p.location !== null && p.graphNodeId === undefined)!;
    expect(placeEndpoint(unconnected)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Saves in flight never discard or falsely save newer local edits
// ---------------------------------------------------------------------------

describe('editor: a save that succeeds after further local edits', () => {
  const head = (over: Partial<StudioBuildingHead> = {}): StudioBuildingHead => ({
    id: STU_ID,
    targetId: null,
    status: 'draft',
    revision: 1,
    draftRevision: 1,
    hasDraft: true,
    publishedVersion: null,
    archivedAt: null,
    archiveReason: null,
    createdBy: 'owner',
    createdAt: T,
    updatedBy: 'owner',
    updatedAt: T,
    ...over,
  });
  const reduce = (s: EditorState, ...a: EditorAction[]) => a.reduce(editorReducer, s);
  const height = (d: StudioDraft, h: number): StudioDraft => ({ ...d, model: { ...d.model, heightM: h } });
  const d0 = draft();
  const loaded = () => reduce(initialEditorState, { type: 'record/load', head: head(), draft: d0 });
  const saved = (sent: StudioDraft): EditorAction => ({
    type: 'server/success',
    op: 'save-draft',
    head: head({ revision: 2, draftRevision: 2 }),
    draft: sent,
  });

  it('typing on in the same field keeps the newer value, unsaved; undo returns to the saved value, clean', () => {
    const typing = (h: number): EditorAction => ({
      type: 'edit',
      draft: height(d0, h),
      label: 'Height',
      coalesceKey: 'model.heightM',
    });
    let s = reduce(loaded(), typing(13), { type: 'server/start', op: 'save-draft' }, typing(135));
    s = reduce(s, saved(height(d0, 13)));
    expect(currentDraft(s)!.model.heightM).toBe(135);
    expect(editorStatus(s)).toMatchObject({ kind: 'unsaved', serverLabel: 'Saved draft (rev 2)' });
    s = reduce(s, { type: 'undo' });
    expect(currentDraft(s)!.model.heightM).toBe(13);
    expect(editorStatus(s).kind).toBe('saved-draft');
  });

  it('undo + a new edit during the save keeps the new edit as unsaved changes', () => {
    let s = reduce(
      loaded(),
      { type: 'edit', draft: height(d0, 13), label: 'Height' },
      { type: 'server/start', op: 'save-draft' },
      { type: 'undo' },
      { type: 'edit', draft: height(d0, 20), label: 'Height' },
    );
    s = reduce(s, saved(height(d0, 13)));
    expect(currentDraft(s)!.model.heightM).toBe(20);
    expect(editorStatus(s).kind).toBe('unsaved');
  });

  it('with no local edits in between, the server copy is shown as saved', () => {
    const s = reduce(
      loaded(),
      { type: 'edit', draft: height(d0, 13), label: 'Height', coalesceKey: 'model.heightM' },
      { type: 'server/start', op: 'save-draft' },
      saved(height(d0, 13)),
    );
    expect(currentDraft(s)!.model.heightM).toBe(13);
    expect(editorStatus(s).kind).toBe('saved-draft');
  });
});

// ---------------------------------------------------------------------------
// 9. Google Maps / Earth / Street View behind wrappers
// ---------------------------------------------------------------------------

describe('prohibited sources behind wrappers, encodings and image endpoints', () => {
  const BLOCKED = [
    'https://www.google.com/url?sa=t&url=https%3A%2F%2Fwww.google.com%2Fmaps%2Fplace%2FLPU',
    'https://www.google.com/url?q=https://maps.google.com/?cid=123',
    'https://consent.google.com/ml?continue=https://www.google.com/maps/place/x',
    'https://web.archive.org/web/2020/https://www.google.com/maps/place/x',
    'https://cbk0.google.com/cbk?output=thumbnail&panoid=abc',
    'https://geo0.ggpht.com/cbk?panoid=abc&output=thumbnail',
    'https://www.google.com//maps/place/x',
    'https://www.google.com/%6Daps/place/x',
    'https://www.google.co.in/search?q=lpu&tbm=map',
  ];
  const ALLOWED = [
    'https://www.openstreetmap.org/way/123',
    'https://web.archive.org/web/2020/https://example.org/maps',
    'https://example.org/?next=https://www.openstreetmap.org/way/1',
    'https://storage.googleapis.com/open-buildings-data/v3/x.csv',
    'https://sites.research.google/open-buildings/',
    'https://www.google.com/search?q=lpu',
  ];
  it.each(BLOCKED)('blocks %s (as a field and inside free text)', (u) => {
    expect(isProhibitedSourceUrl(u)).toBe(true);
    expect(containsProhibitedSourceUrl(`Compared with ${u} before publishing.`)).toBe(true);
  });
  it.each(ALLOWED)('allows %s', (u) => {
    expect(isProhibitedSourceUrl(u)).toBe(false);
    expect(containsProhibitedSourceUrl(`See ${u}.`)).toBe(false);
  });
});
