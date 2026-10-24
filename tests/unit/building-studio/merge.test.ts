/**
 * mergeStudioBuildings (docs/BUILDING_STUDIO_DESIGN.md §11) on the real
 * dataset: one feature + one place + one id per published building, base
 * models keep the base id, outside/hidden/orphan/shadowed/invalid records
 * are dropped with reasons, deterministic under shuffles, never mutating.
 */
import { describe, expect, it } from 'vitest';
import { createEnuFrame, deriveFootprint } from '../../../src/building-studio/footprint.ts';
import { mergeStudioBuildings, UNNAMED_STUDIO_BUILDING } from '../../../src/building-studio/merge.ts';
import type { PublishedStudioBuilding } from '../../../src/building-studio/schema.ts';
import type { LngLat } from '../../../src/data/schema.ts';
import { haversineM } from '../../../src/distance/geodesic.ts';
import { createBoundary } from '../../../src/geo/boundary.ts';
import { ANCHOR, FOOTPRINT, STU_ID, clone, model, published } from './fixtures.ts';
import { realData } from './real-data.ts';

const { campus } = realData();
const TARGET = 'osm:way/422823421';
const ID2 = 'stu:bbbbbbbbbbbbbbbbbbbbbbbb';
const ID3 = 'stu:cccccccccccccccccccccccc';

const merge = (
  buildings: PublishedStudioBuilding[],
  over: Partial<Parameters<typeof mergeStudioBuildings>[0]> = {},
) => mergeStudioBuildings({ data: campus, buildings, ...over });

/** A published footprint for a 20 × 40 box at `anchor`. */
function footprintAt(anchor: LngLat): PublishedStudioBuilding['footprint'] {
  const r = deriveFootprint(model({ anchor, rotationDeg: 0 }));
  if (!r.ok) throw new Error(r.message);
  return r.footprint;
}

const targetFeature = () => campus.buildings.features.find((f) => f.properties.id === TARGET)!;
const baseModel = (over: Partial<PublishedStudioBuilding> = {}): PublishedStudioBuilding => {
  const f = targetFeature();
  return published({
    id: ID2,
    targetId: TARGET,
    identity: null,
    model: model({
      anchor: [f.properties.anchorLon, f.properties.anchorLat],
      rotationDeg: 0,
      generatorId: 'footprint-prism',
      shape: { kind: 'footprint-prism' },
      heightM: 32,
      floors: 10,
      baseOffsetM: 0,
    }),
    footprint: { type: 'Polygon', coordinates: f.geometry.coordinates as LngLat[][] },
    ...over,
  });
};

describe('new studio building: one feature, one place, one id', () => {
  it('adds exactly one footprint feature and one building place with the stu: id', () => {
    const before = JSON.stringify(campus);
    const r = merge([published()]);
    expect(JSON.stringify(campus)).toBe(before); // base snapshot never mutated
    const feats = r.data.buildings.features.filter((f) => f.properties.id === STU_ID);
    const places = r.data.places.filter((p) => p.id === STU_ID || p.buildingId === STU_ID);
    expect(feats).toHaveLength(1);
    expect(places).toHaveLength(1);
    expect(r.data.buildings.features).toHaveLength(campus.buildings.features.length + 1);
    expect(r.data.places).toHaveLength(campus.places.length + 1);
    const p = feats[0]!.properties;
    expect(p).toMatchObject({
      name: 'Studio Hall',
      displayName: 'Studio Hall',
      categoryId: 'academic',
      geometrySource: 'studio',
      renderHeightSource: 'studio-model',
      sourceId: 'owner',
      sourceRef: STU_ID,
      campusStatus: 'inside',
      inCampusInventory: true,
      verificationStatus: 'unverified',
      fidelityLevel: 0,
      directoryKey: null,
      officialBlockLabel: null,
      levels: null,
      osmHeightM: null,
      renderHeightM: 12.8,
      renderMinHeightM: 0,
    });
    const place = places[0]!;
    expect(place).toMatchObject({
      kind: 'building',
      buildingId: STU_ID,
      campusZone: 'on-campus',
      aliases: ['SH'],
      wheelchair: 'unknown',
      provenance: {
        sourceId: 'owner',
        verificationStatus: 'unverified',
        notes: 'Illustrative model placed by the site owner — not verified',
      },
    });
    expect(place.levels).toBeUndefined();
    expect(place.heightM).toBeUndefined();
    expect(place.graphNodeId).toBeUndefined(); // no access node → not routable
    expect(r.studioModels).toEqual([
      expect.objectContaining({
        publicId: STU_ID,
        recordId: STU_ID,
        modelAvailable: true,
        bodyBaseM: 0,
        bodyTopM: 12.8,
      }),
    ]);
    expect(r.report.added).toEqual([STU_ID]);
    expect(r.data.manifest.sources.some((s) => s.id === 'owner')).toBe(true);
  });

  it('recounts buildings, places, kinds, categories and studio heights', () => {
    const r = merge([published()]);
    const c0 = campus.manifest.counts;
    const c = r.data.manifest.counts;
    expect(c.buildings).toBe(c0.buildings! + 1);
    expect(c.places).toBe(c0.places! + 1);
    expect(c['kind:building']).toBe(c0['kind:building']! + 1);
    expect(c['category:academic']).toBe(c0['category:academic']! + 1);
    expect(c['heightSource:studio-model']).toBe(1);
    expect(c['buildings:unnamed']).toBe(c0['buildings:unnamed']);
  });

  it('an unnamed building gets an honest label; directoryVisible: false is drawn but hidden from the directory', () => {
    const b = published({ identity: { ...published().identity!, name: null, directoryVisible: false } });
    const r = merge([b]);
    expect(r.data.places.find((p) => p.id === STU_ID)!.displayName).toBe(UNNAMED_STUDIO_BUILDING);
    expect(r.studioHiddenFromDirectory).toEqual([STU_ID]);
    expect(r.data.buildings.features.some((f) => f.properties.id === STU_ID)).toBe(true);
    expect(r.data.manifest.counts['buildings:unnamed']).toBe(
      campus.manifest.counts['buildings:unnamed']! + 1,
    );
  });

  it('verification maps onto the app statuses; surveyed buildings get fidelity 3', () => {
    const b = published({
      verification: {
        status: 'surveyed',
        surveyDate: '2026-09-30',
        note: 'Measured on site with a laser meter.',
      },
    });
    const r = merge([b]);
    expect(r.data.buildings.features.find((f) => f.properties.id === STU_ID)!.properties).toMatchObject({
      verificationStatus: 'verified',
      lastVerifiedAt: '2026-09-30',
      fidelityLevel: 3,
    });
    // The fixture is a generic-prefab model: the verified label says its shape is generic.
    expect(r.data.places.find((p) => p.id === STU_ID)!.provenance.notes).toBe(
      'Model placed by the site owner from a site survey (shape and appearance from a generic template, not the real design)',
    );
  });

  it('routable only through a validated access node, measured to the footprint', () => {
    const frame = createEnuFrame(ANCHOR);
    const nodes = campus.graph.nodes;
    const foot = new Set(campus.graph.edges.filter((e) => e.foot).flatMap((e) => [e.from, e.to]));
    const near = [...foot].sort((a, b) => haversineM(nodes[a]!, ANCHOR) - haversineM(nodes[b]!, ANCHOR))[0]!;
    const far = [...foot].find((n) => haversineM(nodes[n]!, ANCHOR) > 500)!;
    expect(Math.hypot(...frame.toLocal(nodes[near]!))).toBeLessThan(60);
    const ok = merge([published({ accessNodeId: near })]);
    expect(ok.data.places.find((p) => p.id === STU_ID)!.graphNodeId).toBe(near);
    const bad = merge([published({ accessNodeId: far })]);
    expect(bad.data.places.find((p) => p.id === STU_ID)!.graphNodeId).toBeUndefined();
    expect(bad.report.invalidAccess).toEqual([
      expect.objectContaining({ id: STU_ID, reason: 'studio-too-far' }),
    ]);
  });
});

describe('campus membership (rule 4a for studio buildings)', () => {
  it('a building now outside the boundary is dropped entirely (never a context place)', () => {
    const b = published({ footprint: footprintAt([75.69, 31.25]) });
    const r = merge([b]);
    expect(r.report.outside).toEqual([STU_ID]);
    expect(r.data.places.some((p) => p.id === STU_ID)).toBe(false);
    expect(r.data.buildings.features.some((f) => f.properties.id === STU_ID)).toBe(false);
    expect(r.studioModels).toEqual([]);
  });

  it('uncertain keeps a published owner confirmation; without one it is held for review', () => {
    // A boundary that covers only the west quarter of the 20 × 40 fixture footprint → crossing-minority.
    const f = createEnuFrame(ANCHOR);
    const sq = [
      f.toLngLat([-500, -500]),
      f.toLngLat([-5, -500]),
      f.toLngLat([-5, 500]),
      f.toLngLat([-500, 500]),
    ];
    const boundary = createBoundary({ type: 'Polygon', coordinates: [[...sq, sq[0]!]] });
    const confirmed = published({
      footprint: footprintAt(ANCHOR),
      membership: {
        campusStatus: 'crossing',
        insideFraction: 0.25,
        distanceToBoundaryM: 0,
        reasonCode: 'curated-decision',
        decision: 'curated',
        decisionSource: `owner-confirmation: studio ${STU_ID} v1`,
      },
    });
    const kept = merge([confirmed], { boundary });
    expect(kept.data.buildings.features.find((x) => x.properties.id === STU_ID)!.properties).toMatchObject({
      campusStatus: 'crossing',
      membershipDecision: 'curated',
      membershipMethod: 'curated-decision',
      membershipDecisionSource: `owner-confirmation: studio ${STU_ID} v1`,
      insideFraction: 0.25,
    });
    const auto = merge([published({ footprint: footprintAt(ANCHOR) })], { boundary });
    expect(auto.report.heldForReview).toEqual([STU_ID]);
    expect(auto.data.places.some((p) => p.id === STU_ID)).toBe(false);
  });
});

describe('model of a base building: same id, base identity, model geometry and height', () => {
  it('keeps the base id, name and place; replaces render heights only', () => {
    const r = merge([baseModel()]);
    const f = r.data.buildings.features.find((x) => x.properties.id === TARGET)!;
    const base = targetFeature();
    expect(f.properties).toMatchObject({
      name: base.properties.name,
      displayName: base.properties.displayName,
      categoryId: base.properties.categoryId,
      renderHeightM: 32,
      renderMinHeightM: 0,
      renderHeightSource: 'studio-model',
      fidelityLevel: 0,
    });
    expect(f.geometry).toEqual(base.geometry);
    expect(r.data.places).toHaveLength(campus.places.length);
    expect(r.data.buildings.features).toHaveLength(campus.buildings.features.length);
    expect(r.studioModels).toEqual([
      expect.objectContaining({ publicId: TARGET, recordId: ID2, modelAvailable: true }),
    ]);
    expect(r.report.modelled).toEqual([ID2]);
    expect(base.properties.renderHeightSource).not.toBe('studio-model'); // base object untouched
  });

  it('a hidden target hides the model; a missing target is an orphan', () => {
    expect(merge([baseModel()], { hiddenTargets: new Set([TARGET]) }).report.targetHidden).toEqual([ID2]);
    const orphan = merge([baseModel({ targetId: 'osm:way/1' })]);
    expect(orphan.report.orphan).toEqual([ID2]);
    expect(orphan.studioModels).toEqual([]);
  });

  it('a position correction replaces the geometry only while it stays on campus', () => {
    const f = targetFeature();
    const shifted = footprintAt(
      createEnuFrame([f.properties.anchorLon, f.properties.anchorLat]).toLngLat([0, 8]),
    );
    const corrected = baseModel({
      positionCorrected: true,
      model: model({ anchor: shifted.coordinates[0]![0]!, rotationDeg: 0 }),
      footprint: shifted,
    });
    const r = merge([corrected]);
    expect(r.data.buildings.features.find((x) => x.properties.id === TARGET)!.geometry).toEqual(shifted);
    expect(r.studioModels[0]!.footprint).toEqual(shifted);
    const off = baseModel({
      positionCorrected: true,
      model: model({ rotationDeg: 0 }),
      footprint: footprintAt([75.69, 31.25]),
    });
    const ignored = merge([off]);
    expect(ignored.report.correctionsIgnored).toEqual([ID2]);
    expect(ignored.data.buildings.features.find((x) => x.properties.id === TARGET)!.geometry).toEqual(
      f.geometry,
    );
    expect(ignored.studioModels[0]).toMatchObject({
      modelAvailable: false,
      footprint: { coordinates: f.geometry.coordinates },
    });
  });
});

describe('dropped and shadowed records', () => {
  it('one record per id (newest version wins) and one per target', () => {
    const v1 = published({ version: 1 });
    const v2 = published({ version: 2, identity: { ...published().identity!, name: 'Studio Hall v2' } });
    const r = merge([v1, v2]);
    expect(r.data.places.filter((p) => p.id === STU_ID)).toHaveLength(1);
    expect(r.data.places.find((p) => p.id === STU_ID)!.name).toBe('Studio Hall v2');
    expect(r.report.shadowed).toEqual([STU_ID]);
    const twoForTarget = merge([
      baseModel(),
      baseModel({ id: ID3, version: 1, publishedAt: '2026-10-25T00:00:00.000Z' }),
    ]);
    expect(twoForTarget.studioModels).toHaveLength(1);
    expect(twoForTarget.studioModels[0]!.recordId).toBe(ID3); // later publishedAt at the same version
    expect(twoForTarget.report.shadowed).toEqual([ID2]);
  });

  it('invalid records (schema or geometry) are dropped with a reason', () => {
    const bowtie: PublishedStudioBuilding['footprint'] = {
      type: 'Polygon',
      coordinates: [
        [
          [75.7031, 31.2531],
          [75.7033, 31.2535],
          [75.7033, 31.2531],
          [75.7031, 31.2535],
          [75.7031, 31.2531],
        ],
      ],
    };
    const r = merge([
      published({ footprint: bowtie }),
      { ...published({ id: ID2 }), identity: null } as PublishedStudioBuilding, // new building without identity
    ]);
    expect(r.report.invalid.map((i) => [i.id, i.reason]).sort()).toEqual([
      [STU_ID, 'geometry'],
      [ID2, 'schema'],
    ]);
    expect(r.studioModels).toEqual([]);
  });

  it('an unknown model is kept and drawn as a fallback prism (flagged unavailable)', () => {
    const r = merge([published({ model: { ...model(), modelConfigVersion: 9 } as never })]);
    expect(r.report.added).toEqual([STU_ID]);
    expect(r.report.unavailable).toEqual([STU_ID]);
    expect(r.studioModels[0]!.modelAvailable).toBe(false);
  });
});

describe('determinism', () => {
  it('the output depends only on the set of records', () => {
    const records = [
      published(),
      published({ id: ID3, footprint: footprintAt(createEnuFrame(ANCHOR).toLngLat([0, 120])) }),
      baseModel(),
      published({ version: 2 }),
    ];
    const a = merge(records);
    const b = merge([...records].reverse());
    const c = merge([records[2]!, records[0]!, records[3]!, records[1]!].map(clone));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
    expect(a.studioModels.map((m) => m.publicId)).toEqual([TARGET, STU_ID, ID3].sort());
  });

  it('FOOTPRINT fixture sanity: it is the published footprint of the default record', () => {
    expect(published().footprint).toEqual(FOOTPRINT);
  });
});
