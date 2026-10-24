/**
 * The app's publication wiring on the REAL dataset (docs/BUILDING_STUDIO_DESIGN.md
 * §11, test list C): base data + publication v2 → one feature, one place, one
 * search doc and one directory entry per published studio building, with the
 * same id everywhere; directoryVisible; base-model precedence; off-campus
 * results only through the opt-in layer; deterministic; never mutating.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPublication, type BoundaryReviewInput } from '../../../src/app/data/apply-publication.ts';
import type { PublicationLoad } from '../../../src/app/data/publication.ts';
import {
  buildAppServices,
  buildServices,
  withContextPlaces,
  type AtlasServices,
} from '../../../src/app/data/services.ts';
import { UNNAMED_STUDIO_BUILDING } from '../../../src/building-studio/merge.ts';
import { VERIFICATION_LABELS, type PublishedStudioBuilding } from '../../../src/building-studio/schema.ts';
import {
  EMPTY_PUBLICATION,
  type Publication,
  type PublishedLocation,
} from '../../../src/community/schema.ts';
import type { CampusData } from '../../../src/data/campus-data.ts';
import {
  boundaryReviewFileSchema,
  buildingsFileSchema,
  createOptionalLoaders,
  DATA_FILES,
  type LngLat,
  type OptionalDataLoaders,
} from '../../../src/data/index.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STU_ID, identity, published } from '../building-studio/fixtures.ts';
import { realData } from '../building-studio/real-data.ts';

const ID2 = 'stu:bbbbbbbbbbbbbbbbbbbbbbbb';
const ID3 = 'stu:cccccccccccccccccccccccc';
const T = '2026-10-24T09:30:00.000Z';

let base: CampusData;
let review: BoundaryReviewInput;
let optional: OptionalDataLoaders;

beforeAll(() => {
  base = realData().campus;
  review = boundaryReviewFileSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', DATA_FILES.boundaryReview), 'utf8')),
  );
  // Optional loaders that serve the real boundary review (the other lazy files are not needed here).
  optional = {
    ...createOptionalLoaders(base.manifest, { fetchImpl: () => Promise.reject(new Error('offline')) }),
    boundaryReview: () => Promise.resolve(review as never),
  };
});

const pub = (over: Partial<Publication> = {}): Publication => ({
  ...EMPTY_PUBLICATION,
  publicationVersion: 7,
  generatedAt: T,
  ...over,
});
const live = (p: Publication | null): PublicationLoad => ({
  status: p
    ? { kind: 'live', publicationVersion: p.publicationVersion, generatedAt: p.generatedAt, buildings: 0 }
    : { kind: 'unavailable' },
  publication: p,
});
const appServices = async (p: Publication | null, loaders: OptionalDataLoaders | null = optional) =>
  (await buildAppServices(base, live(p), loaders)).services;

/** Every search doc for a place id, whatever the query that finds it. */
function docsFor(s: AtlasServices, query: string, id: string) {
  return s.searchIndex.search(query, { limit: 200 }).filter((h) => h.doc.ref === id);
}

describe('published studio building: one record, one id in every view', () => {
  it('adds one feature, one place, one search doc, one directory entry and one render model', async () => {
    const before = JSON.stringify(base.places);
    const s = await appServices(pub({ buildings: [published()] }));
    expect(JSON.stringify(base.places)).toBe(before); // the base snapshot is never modified

    expect(s.data.buildings.features.filter((f) => f.properties.id === STU_ID)).toHaveLength(1);
    expect(s.data.places.filter((p) => p.id === STU_ID)).toHaveLength(1);
    expect(s.getPlace(STU_ID)).toMatchObject({ kind: 'building', name: 'Studio Hall', buildingId: STU_ID });
    expect(docsFor(s, 'Studio Hall', STU_ID)).toHaveLength(1);
    expect(docsFor(s, 'SH', STU_ID)).toHaveLength(1); // alias
    expect(s.buildingDirectory.byId.get(STU_ID)).toMatchObject({
      title: 'Studio Hall',
      subtitle: VERIFICATION_LABELS.unverified,
      renderHeightSource: 'studio-model',
    });
    expect(s.studioModels.map((m) => m.publicId)).toEqual([STU_ID]);
    // The merged buildings file is valid under the shipped schema (change C1).
    expect(buildingsFileSchema.safeParse(s.data.buildings).success).toBe(true);
    expect(s.data.manifest.counts['heightSource:studio-model']).toBe(1);
    expect(s.data.manifest.counts.buildings).toBe((base.manifest.counts.buildings ?? 0) + 1);
  });

  it('directoryVisible false: drawn and selectable, but neither in the directory nor in search', async () => {
    const hidden = published({ identity: { ...published().identity!, directoryVisible: false } });
    const s = await appServices(pub({ buildings: [hidden] }));
    expect(s.getPlace(STU_ID)?.kind).toBe('building');
    expect(s.studioModels.map((m) => m.publicId)).toEqual([STU_ID]);
    expect(s.data.buildings.features.some((f) => f.properties.id === STU_ID)).toBe(true);
    expect(s.buildingDirectory.byId.has(STU_ID)).toBe(false);
    expect(docsFor(s, 'Studio Hall', STU_ID)).toHaveLength(0);
  });

  it('an unnamed owner-placed building gets exactly one doc with its honest label, no invented name', async () => {
    const { notes: _n, ...unnamed } = identity();
    const s = await appServices(pub({ buildings: [published({ identity: unnamed })] }));
    const hits = docsFor(s, 'Unnamed building owner-placed', STU_ID);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.doc.title).toBe(UNNAMED_STUDIO_BUILDING);
    expect(hits[0]!.doc.subtitle).toBe(VERIFICATION_LABELS.unverified);
    expect(hits[0]!.doc.keywords).toEqual([]); // generic category words never surface it
  });

  it('a model of a base building keeps the base id: no new feature, place or doc', async () => {
    const target = base.buildings.features.find(
      (f) => f.properties.inCampusInventory && f.geometry.type === 'Polygon' && f.properties.name !== null,
    )!;
    const id = target.properties.id;
    const record = published({
      id: ID2,
      targetId: id,
      identity: null,
      footprint: { type: 'Polygon', coordinates: target.geometry.coordinates as LngLat[][] },
      model: {
        ...published().model,
        anchor: [target.properties.anchorLon, target.properties.anchorLat],
        generatorId: 'footprint-prism',
        shape: { kind: 'footprint-prism' },
      },
    } as Partial<PublishedStudioBuilding>);
    const s = await appServices(pub({ buildings: [record] }));
    expect(s.data.buildings.features).toHaveLength(base.buildings.features.length);
    expect(s.getPlace(ID2)).toBeUndefined();
    expect(s.studioModels.map((m) => m.publicId)).toEqual([id]);
    expect(s.buildingDirectory.byId.get(id)?.renderHeightSource).toBe('studio-model');
  });

  it('is deterministic: the order of published records does not matter', async () => {
    const a = published();
    const b = published({
      id: ID3,
      identity: { ...published().identity!, name: 'Second Hall', aliases: [] },
    });
    const one = await appServices(pub({ buildings: [a, b] }));
    const two = await appServices(pub({ buildings: [b, a] }));
    expect(JSON.stringify(two.data)).toBe(JSON.stringify(one.data));
    expect(two.studioModels).toEqual(one.studioModels);
  });

  it('drafts, notes and unknown fields in a body never reach the app (the public schema strips them)', () => {
    const body = {
      ...published(),
      draft: { secret: 1 },
      notes: 'private',
    } as unknown as PublishedStudioBuilding;
    const r = applyPublication(base, pub({ buildings: [body] }), review);
    const feature = r.data.buildings.features.find((f) => f.properties.id === STU_ID);
    expect(feature).toBeDefined();
    expect(JSON.stringify(r.data)).not.toContain('private');
    expect(JSON.stringify(r.studioModels)).not.toContain('secret');
  });

  it('without the boundary review the buildings wait (reported), locations still apply', async () => {
    const failing: OptionalDataLoaders = {
      ...optional,
      boundaryReview: () => Promise.reject(new Error('x')),
    };
    const s = await appServices(pub({ buildings: [published()] }), failing);
    expect(s.getPlace(STU_ID)).toBeUndefined();
    expect(s.studioModels).toEqual([]);
    expect(s.studioSkipped).toBe(1);
  });
});

describe('publication states and the base dataset', () => {
  it('no publication (API absent): the base data unchanged, no studio models', async () => {
    const s = await appServices(null);
    expect(s.data).toBe(base);
    expect(s.studioModels).toEqual([]);
    expect(s.publication).toEqual({ kind: 'unavailable' });
  });

  it('a v1 body (rolled-back server) shows no studio buildings and no error', async () => {
    const v1 = pub({ schemaVersion: 1 });
    delete (v1 as { buildings?: unknown }).buildings;
    const s = await appServices(v1);
    expect(s.studioModels).toEqual([]);
    expect(s.studioSkipped).toBe(0);
  });
});

describe('search by map key (D6) and off-campus results (rule 4a)', () => {
  it('an unnamed keyed building is searchable by its map key', () => {
    const keyed = base.buildings.features.find(
      (f) =>
        f.properties.directoryKey &&
        f.properties.name === null &&
        base.places.some((p) => p.id === f.properties.id),
    );
    expect(keyed, 'the real dataset has an unnamed keyed building with a place').toBeDefined();
    const key = keyed!.properties.directoryKey!;
    const s = buildServices(base);
    expect(s.searchIndex.search(key)[0]?.doc.ref).toBe(keyed!.properties.id);
  });

  it('an off-campus published location is searchable only through the nearby layer, labelled', async () => {
    const [w, s0] = base.manifest.bbox;
    const outside: PublishedLocation = {
      id: 'own:outside-test',
      origin: 'owner',
      name: 'Synthetic Outside Kiosk',
      categoryId: 'food',
      location: [w - 0.002, s0 - 0.002],
      wheelchair: 'unknown',
      verificationStatus: 'unverified',
      accessNodeId: null,
      revision: 1,
      updatedAt: T,
    };
    const built = await buildAppServices(base, live(pub({ locations: [outside] })), optional);
    const s = built.services;
    expect(s.getPlace(outside.id)).toBeUndefined();
    expect(s.searchIndex.search('Synthetic Outside Kiosk').some((h) => h.doc.ref === outside.id)).toBe(false);
    expect(s.buildingDirectory.byId.has(outside.id)).toBe(false);
    expect(built.publicationContextPlaces.map((p) => p.id)).toEqual([outside.id]);

    const on = withContextPlaces(s, built.publicationContextPlaces);
    expect(on.getPlace(outside.id)?.campusZone).toBe('off-campus-nearby');
    const hit = on.searchIndex.search('Synthetic Outside Kiosk').find((h) => h.doc.ref === outside.id);
    expect(hit?.doc.subtitle).toContain('Outside campus');
    expect(on.contextPlaces.map((p) => p.id)).toEqual([outside.id]);
    // Campus counts and the base services are untouched; turning the layer off restores them.
    expect(on.categoryCounts).toBe(s.categoryCounts);
    expect(s.getPlace(outside.id)).toBeUndefined();
    expect(withContextPlaces(s, [])).toBe(s);
  });
});
