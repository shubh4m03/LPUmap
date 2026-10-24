/**
 * validateStudioDraft (S6, docs/BUILDING_STUDIO_DESIGN.md §6): every code in
 * §6.2 with a passing and a failing fixture, the thresholds, exact overlap
 * on concave / rotated / touching / contained footprints, Google source
 * rejection, publishability, and the real dataset.
 */
import { describe, expect, it } from 'vitest';
import { createEnuFrame, deriveFootprint } from '../../../src/building-studio/footprint.ts';
import {
  STUDIO_VALIDATION,
  VALIDATION_CODE_LIST,
  VALIDATION_CODES,
  validationResultSchema,
  type ModelConfigV1,
  type PublishedStudioBuilding,
  type StudioDraft,
  type ValidationCode,
  type ValidationResult,
} from '../../../src/building-studio/schema.ts';
import {
  membershipForPublish,
  publishable,
  studioFootprintFor,
  validateStudioDraft,
  type StudioValidationContext,
} from '../../../src/building-studio/validate.ts';
import { PROHIBITED_SOURCE_MESSAGE } from '../../../src/building-studio/text.ts';
import type { BuildingsFile, GraphFile, LngLat, Place } from '../../../src/data/schema.ts';
import { classifyFootprint, createBoundary } from '../../../src/geo/boundary.ts';
import { ANCHOR, STU_ID, draft, identity, model, published, template } from './fixtures.ts';
import { realContext, realData } from './real-data.ts';

// ---------------------------------------------------------------------------
// Synthetic world in local metres around ANCHOR
// ---------------------------------------------------------------------------

const F = createEnuFrame(ANCHOR);
const at = (x: number, y: number): LngLat => F.toLngLat([x, y]);
const ring = (pts: [number, number][]): LngLat[] => [
  ...pts.map(([x, y]) => at(x, y)),
  at(pts[0]![0], pts[0]![1]),
];
const rectRing = (cx: number, cy: number, w: number, l: number) =>
  ring([
    [cx - w / 2, cy - l / 2],
    [cx + w / 2, cy - l / 2],
    [cx + w / 2, cy + l / 2],
    [cx - w / 2, cy + l / 2],
  ]);

/** Campus: a 600 × 600 m square around ANCHOR (x, y ∈ [−300, 300]). */
const boundary = createBoundary({ type: 'Polygon', coordinates: [rectRing(0, 0, 600, 600)] });

const feature = (id: string, coordinates: LngLat[][], name: string | null = null) =>
  ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates },
    properties: { id, name, displayName: name ?? 'Unnamed building', directoryKey: null },
  }) as unknown as BuildingsFile['features'][number];

const BASE_A = 'osm:way/101'; // 20 × 40 at (100, 0)
const BASE_L = 'osm:way/102'; // L-shape around (−100, 150), notch at its north-east
const buildings = {
  features: [
    feature(BASE_A, [rectRing(100, 0, 20, 40)], 'Block A'),
    feature(BASE_L, [
      ring([
        [-130, 120],
        [-70, 120],
        [-70, 150],
        [-100, 150],
        [-100, 180],
        [-130, 180],
      ]),
    ]),
  ],
};

const place = (id: string, kind: Place['kind'], x: number, y: number): Place => ({
  id,
  name: null,
  displayName: id,
  aliases: [],
  categoryId: 'building',
  kind,
  location: at(x, y),
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  provenance: { sourceId: 'osm', verificationStatus: 'imported' },
});

const edge = (id: number, from: number, to: number, foot = true): GraphFile['edges'][number] => ({
  id,
  from,
  to,
  lengthM: 1,
  highway: foot ? 'footway' : 'service',
  foot,
  bicycle: 'ride',
  steps: false,
  wheelchair: 'unknown',
  onewayBicycle: false,
  onewayFoot: false,
  indoor: false,
  surface: null,
  name: null,
  source: 'osm',
  osmWayId: null,
});

// Nodes: 0 (0, 25) and 1 (50, 25) — a footway 5 m north of a 20 × 40 model at the origin;
// 2 (0, 55) and 3 (50, 55) — a footway 35 m away; 4 (200, 0) far; 5 (0, -25) / 6 (20, -25) a service road.
const graph = {
  nodes: [at(0, 25), at(50, 25), at(0, 55), at(50, 55), at(200, 0), at(0, -25), at(20, -25)],
  edges: [edge(10, 0, 1), edge(11, 2, 3), edge(12, 4, 3), edge(13, 5, 6, false)],
};

function ctx(over: Partial<StudioValidationContext> = {}): StudioValidationContext {
  return {
    base: {
      buildings,
      places: [
        place('osm:node/1', 'entrance', 0, 22),
        place('osm:node/2', 'entrance', 0, 60),
        place('osm:node/3', 'facility', 0, 21),
      ],
      graph,
      boundary,
      reviewSections: [
        {
          id: 'south-gap',
          title: 'South gap',
          status: 'open',
          reason: 'test',
          evidence: ['test'],
          bufferM: 10,
          geometry: { type: 'LineString', coordinates: [at(-50, -300), at(50, -300)] },
        },
      ],
      curatedDecisions: [],
    },
    published: [],
    template: null,
    recordId: null,
    targetId: null,
    today: '2026-10-24',
    ...over,
  };
}

/** A 20 × 40 box at local (x, y). */
const boxAt = (x: number, y: number, over: Partial<ModelConfigV1> = {}) =>
  model({ anchor: at(x, y), rotationDeg: 0, ...over });

const codes = (r: ValidationResult) => r.issues.map((i) => i.code);
const has = (r: ValidationResult, code: ValidationCode) => r.issues.filter((i) => i.code === code);
const run = (d: StudioDraft, c: Partial<StudioValidationContext> = {}) => {
  const r = validateStudioDraft(d, ctx(c));
  expect(validationResultSchema.parse(r)).toEqual(r);
  return r;
};

// ---------------------------------------------------------------------------

describe('a clean new building', () => {
  it('passes with only info items (no errors, no warnings)', () => {
    const r = run(draft({ model: boxAt(0, 0) }));
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
    expect(r.publishable).toBe(true);
    expect(r.requiredAcknowledgements).toEqual([]);
    expect(new Set(codes(r))).toEqual(new Set(['nearby-path', 'nearby-entrance', 'not-routable']));
  });

  it('every issue carries the fixed severity of its code and issues are ordered by code, then path', () => {
    const r = run(
      draft({
        identity: null,
        model: boxAt(295, 0, { heightM: 300, geometryGuide: { detectionId: 'det:microsoft-ml:0123abcd' } }),
        positionCorrection: { reason: 'not applicable here at all' },
      }),
    );
    for (const i of r.issues) expect(i.severity).toBe(VALIDATION_CODES[i.code]);
    const order = r.issues.map((i) => VALIDATION_CODE_LIST.indexOf(i.code));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('errors (block publishing; a draft may still be saved)', () => {
  it('geometry-invalid: impossible shape parameters', () => {
    const stepped = boxAt(0, 0, {
      generatorId: 'stepped',
      roof: { shape: 'stepped', colour: '#999999', material: 'concrete' },
      shape: { kind: 'stepped', tiers: 4, setbackM: 5 },
    });
    expect(codes(run(draft({ model: stepped })))).toContain('geometry-invalid');
    const ok = { ...stepped, shape: { kind: 'stepped' as const, tiers: 2, setbackM: 3 } };
    expect(codes(run(draft({ model: ok })))).not.toContain('geometry-invalid');
  });

  it('dimension-out-of-range: every publish range, with numbers in data', () => {
    const r = run(draft({ model: boxAt(0, 0, { heightM: 200, floorHeightM: 9, floors: 4 }) }));
    const dims = has(r, 'dimension-out-of-range');
    expect(dims.map((i) => i.path).sort()).toEqual(['model.floorHeightM', 'model.heightM']);
    expect(dims.find((i) => i.path === 'model.heightM')!.data).toEqual({
      field: 'heightM',
      value: 200,
      min: 2.4,
      max: 150,
    });
    const pitch = run(
      draft({
        model: boxAt(0, 0, { roof: { shape: 'gable', pitchDeg: 60, colour: '#884433', material: 'tile' } }),
      }),
    );
    expect(has(pitch, 'dimension-out-of-range').map((i) => i.path)).toEqual(['model.roof.pitchDeg']);
    expect(has(run(draft({ model: boxAt(0, 0) })), 'dimension-out-of-range')).toEqual([]);
  });

  it('outside-max-bounds and outside-campus', () => {
    const west = APP_WEST();
    const r = run(draft({ model: model({ anchor: [west, ANCHOR[1]], rotationDeg: 0 }) }));
    expect(codes(r)).toEqual(expect.arrayContaining(['outside-max-bounds', 'outside-campus']));
    const outside = run(draft({ model: boxAt(400, 0) }));
    expect(codes(outside)).toContain('outside-campus');
    expect(codes(outside)).not.toContain('outside-max-bounds');
    expect(has(outside, 'outside-campus')[0]!.message).toMatch(/0 % inside.*owner decision 2/);
  });

  it('unknown-category and identity-required', () => {
    const bad = run(draft({ identity: identity({ categoryId: 'other' }), model: boxAt(0, 0) }));
    expect(has(bad, 'unknown-category')).toHaveLength(1);
    expect(codes(run(draft({ identity: null, model: boxAt(0, 0) })))).toContain('identity-required');
    expect(codes(run(draft({ model: boxAt(0, 0) })))).not.toContain('identity-required');
  });

  it('not-applicable: wrong fields for the record kind', () => {
    const newWithCorrection = run(
      draft({ model: boxAt(0, 0), positionCorrection: { reason: 'wrong place on the map' } }),
    );
    expect(has(newWithCorrection, 'not-applicable').map((i) => i.path)).toEqual(['positionCorrection']);
    const prism = boxAt(0, 0, { generatorId: 'footprint-prism', shape: { kind: 'footprint-prism' } });
    expect(has(run(draft({ model: prism })), 'not-applicable').map((i) => i.path)).toEqual([
      'model.generatorId',
    ]);
    const base = run(draft({ model: boxAt(100, 0), accessNodeId: 0 }), { targetId: BASE_A });
    expect(
      has(base, 'not-applicable')
        .map((i) => i.path)
        .sort(),
    ).toEqual(['accessNodeId', 'identity']);
    const corrected = run(
      draft({
        identity: null,
        model: { ...prism, anchor: at(100, 0) },
        positionCorrection: { reason: 'wrong place on the map' },
      }),
      { targetId: BASE_A },
    );
    expect(has(corrected, 'not-applicable').map((i) => i.path)).toEqual(['model.generatorId']);
    expect(
      has(
        run(draft({ identity: null, model: { ...prism, anchor: at(100, 0) } }), { targetId: BASE_A }),
        'not-applicable',
      ),
    ).toEqual([]);
  });

  it('verification-evidence: incomplete, future-dated and Google sources', () => {
    const incomplete = run(
      draft({
        model: boxAt(0, 0),
        verification: { status: 'source-backed', citation: { url: '', title: '', accessedOn: '' }, note: '' },
      }),
    );
    expect(has(incomplete, 'verification-evidence')[0]!.message).toBe(
      'Source-backed needs a citation URL, title, access date and a note.',
    );
    const surveyed = run(
      draft({ model: boxAt(0, 0), verification: { status: 'surveyed', surveyDate: '', note: 'short' } }),
    );
    expect(has(surveyed, 'verification-evidence')[0]!.message).toBe(
      'Surveyed needs a survey date and a note.',
    );
    const future = run(
      draft({
        model: boxAt(0, 0),
        verification: { status: 'surveyed', surveyDate: '2026-10-25', note: 'Measured on site with a tape.' },
      }),
    );
    expect(has(future, 'verification-evidence').map((i) => i.message)).toEqual([
      '2026-10-25 is in the future.',
    ]);
    const complete = run(
      draft({
        model: boxAt(0, 0),
        verification: {
          status: 'source-backed',
          citation: {
            url: 'https://sites.research.google/open-buildings/',
            title: 'Open Buildings dataset page',
            accessedOn: '2026-10-01',
          },
          note: 'Outline compared with the Open Buildings polygon.',
        },
      }),
    );
    expect(has(complete, 'verification-evidence')).toEqual([]);
    for (const url of [
      'https://www.google.com/maps/place/x',
      'https://maps.app.goo.gl/abc',
      'https://earth.google.com/web/',
    ])
      expect(
        has(
          run(
            draft({
              model: boxAt(0, 0),
              verification: {
                status: 'source-backed',
                citation: { url, title: 'A map', accessedOn: '2026-10-01' },
                note: 'Taken from the map view.',
              },
            }),
          ),
          'verification-evidence',
        ).map((i) => i.message),
        url,
      ).toContain(PROHIBITED_SOURCE_MESSAGE);
  });

  it('unsupported-model: never reinterprets an unknown generator version', () => {
    const r = run(draft({ model: { ...boxAt(0, 0), generatorVersion: 9 } }));
    expect(has(r, 'unsupported-model')[0]!.message).toBe(
      'This model needs generator box v9, which this version of the app does not have.',
    );
    expect(r.publishable).toBe(false);
  });

  it('access-node-invalid: missing, not walkable, too far (measured to the footprint)', () => {
    const msg = (id: number) =>
      has(run(draft({ model: boxAt(0, 0), accessNodeId: id })), 'access-node-invalid');
    expect(msg(99)[0]!.data).toMatchObject({ reason: 'missing-node' });
    expect(msg(5)[0]!.data).toMatchObject({ reason: 'not-walkable' });
    expect(msg(4)[0]!.data).toMatchObject({ reason: 'too-far' }); // 190 m from the footprint edge
    expect(msg(0)).toEqual([]); // 5 m from the footprint
    // Distance is to the footprint, not the anchor: node 1 is 41 m from the anchor but within the limit.
    expect(msg(1)).toEqual([]);
    expect(codes(run(draft({ model: boxAt(0, 0), accessNodeId: 0 })))).not.toContain('not-routable');
  });

  it('base-target-missing and base-fit-mismatch', () => {
    const prism = model({
      anchor: at(100, 0),
      rotationDeg: 0,
      generatorId: 'footprint-prism',
      shape: { kind: 'footprint-prism' },
    });
    expect(codes(run(draft({ identity: null, model: prism }), { targetId: 'osm:way/999' }))).toContain(
      'base-target-missing',
    );
    const fitted = run(draft({ identity: null, model: boxAt(100, 0) }), { targetId: BASE_A });
    expect(has(fitted, 'base-fit-mismatch')).toEqual([]);
    const off = run(draft({ identity: null, model: boxAt(108, 0) }), { targetId: BASE_A });
    expect(has(off, 'base-fit-mismatch')[0]!.data).toMatchObject({ min: STUDIO_VALIDATION.baseFitMinIoU });
    // The target itself is never an overlap or duplicate of its own model.
    expect(codes(fitted)).not.toContain('possible-duplicate');
  });
});

describe('warnings (each needs an acknowledgement with a reason)', () => {
  it('boundary-crossing (majority inside) and boundary-uncertain (minority, review section)', () => {
    const crossing = run(draft({ model: boxAt(295, 0) })); // 15 of 20 m inside
    expect(has(crossing, 'boundary-crossing')[0]!.data).toMatchObject({ insideFraction: 0.75 });
    const minority = run(draft({ model: boxAt(305, 0) })); // 5 of 20 m inside
    expect(has(minority, 'boundary-uncertain')[0]!.data).toMatchObject({
      membershipReason: 'crossing-minority',
    });
    const review = run(draft({ model: boxAt(0, -270) })); // 10 m from the open review section
    expect(has(review, 'boundary-uncertain')[0]!.data).toMatchObject({
      membershipReason: 'review-section',
      reviewSectionId: 'south-gap',
    });
    expect(codes(run(draft({ model: boxAt(0, -250) })))).not.toContain('boundary-uncertain');
  });

  it('overlap-base-building: thresholds ≥ 1 m² AND ≥ 5 % of the smaller footprint', () => {
    const quarter = run(draft({ model: boxAt(115, 0) })); // 5 × 40 = 200 m² of 800
    expect(has(quarter, 'overlap-base-building')[0]!.data).toEqual({
      id: BASE_A,
      overlapM2: 200,
      fraction: 0.25,
    });
    expect(has(quarter, 'overlap-base-building')[0]!.message).toBe(
      'Overlaps osm:way/101 (Block A) by 200 m² (25 % of the smaller footprint).',
    );
    expect(codes(run(draft({ model: boxAt(119.99, 0) })))).not.toContain('overlap-base-building'); // 0.4 m²
    expect(codes(run(draft({ model: boxAt(120, 0) })))).not.toContain('overlap-base-building'); // touching
    // 0.9 × 40 = 36 m² is ≥ 1 m² but only 4.5 % of the smaller (800 m²) footprint; 1.1 m → 5.5 % counts.
    expect(codes(run(draft({ model: boxAt(119.1, 0) })))).not.toContain('overlap-base-building');
    expect(codes(run(draft({ model: boxAt(118.9, 0) })))).toContain('overlap-base-building');
  });

  it('exact overlap for contained, rotated and concave cases', () => {
    const contained = run(draft({ model: boxAt(100, 0, { widthM: 5, lengthM: 5 }) }));
    expect(has(contained, 'overlap-base-building')[0]!.data).toMatchObject({ overlapM2: 25, fraction: 1 });
    const rotated = run(draft({ model: boxAt(100, 0, { widthM: 10, lengthM: 10, rotationDeg: 45 }) }));
    expect(has(rotated, 'overlap-base-building')[0]!.data).toMatchObject({ overlapM2: 100 });
    // In the notch of the L: the bounding boxes overlap but the footprints do not.
    const notch = run(draft({ model: boxAt(-85, 165, { widthM: 20, lengthM: 20 }) }));
    expect(codes(notch)).not.toContain('overlap-base-building');
    // Half in the notch, half over the L's arm: exactly 10 × 20 = 200 m² (concave clip, not a hull).
    const half = run(draft({ model: boxAt(-100, 165, { widthM: 20, lengthM: 20 }) }));
    expect(has(half, 'overlap-base-building')[0]!.data).toMatchObject({ overlapM2: 200 });
  });

  it('possible-duplicate (IoU ≥ 0.5) replaces the overlap warning for that building', () => {
    const r = run(draft({ model: boxAt(102, 0) })); // IoU 720 / 880
    expect(has(r, 'possible-duplicate')[0]!.data).toMatchObject({ id: BASE_A, iou: 0.8182 });
    expect(codes(r)).not.toContain('overlap-base-building');
  });

  it('overlap-studio-building / duplicates of published studio buildings; the record itself is excluded', () => {
    const other = published({
      id: 'stu:bbbbbbbbbbbbbbbbbbbbbbbb',
      footprint: { type: 'Polygon', coordinates: [rectRing(-100, 0, 20, 40)] },
    });
    const r = run(draft({ model: boxAt(-115, 0) }), { published: [other] });
    expect(has(r, 'overlap-studio-building')[0]!.data).toMatchObject({ id: other.id, overlapM2: 200 });
    expect(codes(run(draft({ model: boxAt(-100, 0) }), { published: [other] }))).toContain(
      'possible-duplicate',
    );
    expect(
      codes(run(draft({ model: boxAt(-100, 0) }), { published: [other], recordId: other.id })),
    ).not.toContain('possible-duplicate');
    // A published model of a base building (not corrected) is checked through its base footprint only.
    const baseModel: PublishedStudioBuilding = { ...other, id: STU_ID, targetId: BASE_A, identity: null };
    expect(
      has(run(draft({ model: boxAt(102, 0) }), { published: [baseModel] }), 'possible-duplicate'),
    ).toHaveLength(1);
  });

  it('height-floors-conflict uses max(1 m, 0.5 × floor height)', () => {
    expect(
      has(run(draft({ model: boxAt(0, 0, { heightM: 16 }) })), 'height-floors-conflict')[0]!.message,
    ).toBe('4 floors × 3.2 m = 12.8 m, but the body height is 16 m.');
    expect(codes(run(draft({ model: boxAt(0, 0, { heightM: 14.4 }) })))).not.toContain(
      'height-floors-conflict',
    );
  });

  it('outside-template-range only against the referenced template version; never clamped', () => {
    const t = template();
    const m = boxAt(0, 0, {
      widthM: 90,
      roof: { shape: 'gable', pitchDeg: 30, colour: '#884433', material: 'tile' },
    });
    const r = run(draft({ model: m }), { template: t });
    expect(
      has(r, 'outside-template-range')
        .map((i) => i.path)
        .sort(),
    ).toEqual(['model.roof.shape', 'model.widthM']);
    expect(r.issues.find((i) => i.path === 'model.widthM')!.message).toBe(
      "widthM 90 is outside the template's guidance 10–80.",
    );
    expect(codes(run(draft({ model: m }), { template: { ...t, version: 2 } }))).not.toContain(
      'outside-template-range',
    );
  });

  it('base-footprint-replaced with a position correction (and no fit check)', () => {
    const r = run(
      draft({
        identity: null,
        model: boxAt(140, 0),
        positionCorrection: { reason: 'The mapped outline is 30 m off.' },
      }),
      { targetId: BASE_A },
    );
    expect(has(r, 'base-footprint-replaced')[0]!.message).toMatch(/replaces osm:way\/101's mapped footprint/);
    expect(codes(r)).not.toContain('base-fit-mismatch');
  });
});

describe('info (never a connection)', () => {
  it('nearby paths (foot only, ≤ 30 m) and entrances (≤ 30 m)', () => {
    const r = run(draft({ model: boxAt(0, 0) }));
    expect(has(r, 'nearby-path').map((i) => i.data.edgeId)).toEqual([10]);
    expect(has(r, 'nearby-path')[0]!.message).toBe(
      'Path segment 10 is 5 m away — for review, not a connection.',
    );
    expect(has(r, 'nearby-entrance').map((i) => i.data.id)).toEqual(['osm:node/1']);
    expect(r.issues.every((i) => i.code !== 'nearby-path' || i.severity === 'info')).toBe(true);
  });

  it('geometry-guide and not-routable', () => {
    const r = run(
      draft({ model: boxAt(0, 0, { geometryGuide: { detectionId: 'det:microsoft-ml:0123abcd' } }) }),
    );
    expect(has(r, 'geometry-guide')[0]!.message).toMatch(/stays unverified until confirmed/);
    expect(has(r, 'not-routable')).toHaveLength(1);
  });
});

describe('publishable, membership and footprint helpers', () => {
  it('errors block; every warning code needs an acknowledgement; others are ignored', () => {
    const r = run(draft({ model: boxAt(295, 0, { heightM: 16 }) }));
    expect(r.requiredAcknowledgements).toEqual(['boundary-crossing', 'height-floors-conflict']);
    const ackA = { code: 'boundary-crossing' as const, reason: 'Owner checked the fence line.' };
    expect(publishable(r, [ackA])).toMatchObject({
      ok: false,
      missingAcknowledgements: ['height-floors-conflict'],
    });
    const all = publishable(r, [
      ackA,
      { code: 'height-floors-conflict', reason: 'Tall ground floor.' },
      { code: 'possible-duplicate', reason: 'Not present.' },
    ]);
    expect(all.ok).toBe(true);
    expect(all.relevantAcknowledgements.map((a) => a.code)).toEqual([
      'boundary-crossing',
      'height-floors-conflict',
    ]);
    const err = run(draft({ identity: null, model: boxAt(0, 0) }));
    expect(publishable(err, []).ok).toBe(false);
  });

  it('membershipForPublish follows §6.4', () => {
    const fp = (x: number) => {
      const r = deriveFootprint(boxAt(x, 0));
      if (!r.ok) throw new Error(r.message);
      return r.footprint;
    };
    const cls = (x: number) => classifyFootprint({ id: STU_ID, geometry: fp(x) }, boundary, [], []);
    expect(membershipForPublish(cls(0), { id: STU_ID, version: 1 })).toMatchObject({
      campusStatus: 'inside',
      decision: 'auto',
      decisionSource: null,
    });
    expect(membershipForPublish(cls(295), { id: STU_ID, version: 1 })).toMatchObject({
      campusStatus: 'crossing',
      decision: 'auto',
    });
    expect(membershipForPublish(cls(305), { id: STU_ID, version: 3 })).toEqual(
      expect.objectContaining({
        campusStatus: 'crossing',
        decision: 'curated',
        reasonCode: 'curated-decision',
        decisionSource: `owner-confirmation: studio ${STU_ID} v3`,
      }),
    );
    expect(membershipForPublish(cls(400), { id: STU_ID, version: 1 })).toBeNull();
  });

  it('studioFootprintFor: derived for generated models, the base footprint for footprint-prism', () => {
    const prism = model({
      anchor: at(100, 0),
      rotationDeg: 0,
      generatorId: 'footprint-prism',
      shape: { kind: 'footprint-prism' },
    });
    const r = studioFootprintFor({ model: prism }, BASE_A, buildings);
    expect(r.ok && r.footprint.coordinates).toEqual(buildings.features[0]!.geometry.coordinates);
    expect(studioFootprintFor({ model: prism }, null, buildings)).toMatchObject({
      ok: false,
      reason: 'missing-base-footprint',
    });
  });

  it('is deterministic and never mutates the draft', () => {
    const d = draft({ model: boxAt(115, 0, { heightM: 16 }) });
    const copy = structuredClone(d);
    expect(run(d)).toEqual(run(copy));
    expect(d).toEqual(copy);
  });
});

describe('real dataset (public/data)', () => {
  it('the campus centre fixture validates without errors or warnings', () => {
    const r = validateStudioDraft(draft(), realContext());
    expect(r.errorCount).toBe(0);
    expect(r.warningCount).toBe(0);
  });

  it('a model of a real building: footprint-prism fits exactly; a box on top of it as a new building is flagged', () => {
    const { base } = realData();
    const target = base.buildings.features.find((f) => f.properties.id === 'osm:way/422823421')!;
    const anchor: LngLat = [target.properties.anchorLon, target.properties.anchorLat];
    const prism = model({
      anchor,
      rotationDeg: 0,
      generatorId: 'footprint-prism',
      shape: { kind: 'footprint-prism' },
    });
    const asModel = validateStudioDraft(
      draft({ identity: null, model: prism }),
      realContext({ targetId: target.properties.id }),
    );
    expect(asModel.errorCount).toBe(0);
    expect(codes(asModel)).not.toContain('possible-duplicate');
    const onTop = validateStudioDraft(
      draft({ model: model({ anchor, rotationDeg: 0, widthM: 60, lengthM: 30 }) }),
      realContext(),
    );
    expect(codes(onTop).some((c) => c === 'overlap-base-building' || c === 'possible-duplicate')).toBe(true);
  });

  it('every real footprint modelled as footprint-prism publishes without errors (inventory buildings)', () => {
    const { base } = realData();
    let n = 0;
    for (const f of base.buildings.features) {
      if (!f.properties.inCampusInventory || f.properties.areaM2 === null || f.properties.areaM2 < 1)
        continue;
      const prism = model({
        anchor: [f.properties.anchorLon, f.properties.anchorLat],
        rotationDeg: 0,
        generatorId: 'footprint-prism',
        shape: { kind: 'footprint-prism' },
      });
      const r = validateStudioDraft(
        draft({ identity: null, model: prism }),
        realContext({ targetId: f.properties.id }),
      );
      expect(
        r.issues.filter((i) => i.severity === 'error').map((i) => i.message),
        f.properties.id,
      ).toEqual([]);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });
});

function APP_WEST(): number {
  return 75.685 + 0.0001; // just inside APP_CONFIG.map.maxBounds west edge: a 20 m wide box sticks out
}
