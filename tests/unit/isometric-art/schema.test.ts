/** Frozen artwork contracts (src/isometric-art/schema.ts): exact labels, ids, association rules, derived specs. */
import { describe, expect, it } from 'vitest';
import {
  areaSubjectId,
  artSubjectSchema,
  artworkAssociationWriteSchema,
  curatedAssociationSchema,
  derivedSpecSchema,
  exactTextSchema,
  isArtworkBuildingId,
  labelQuoteSchema,
  numberSubjectId,
  publishedArtworkAssociationSchema,
  sceneSubjectId,
} from '../../../src/isometric-art/schema.ts';

const evidence = {
  kind: 'owner-statement' as const,
  description: 'Owner confirmed on site that this is the drawn building.',
  date: '2026-10-24',
};

const subject = (over: Record<string, unknown> = {}) => ({
  subjectId: 'art:num-25',
  kind: 'numbered',
  artworkNumber: '25',
  displayLabel: { ref: 'iso-art-087/L1', text: 'SCHOOL OF AGRICULTURE', span: true },
  visibleBlockLabel: { ref: 'iso-art-087/L1', text: 'BLOCK-25,26:', span: true },
  otherLabels: [],
  artworkCategory: null,
  hotspotIds: ['hs-pin-25'],
  vignetteAssetIds: ['iso-art-087'],
  relations: [],
  aliases: [],
  displayHold: null,
  needsManualVerification: [],
  notes: '',
  ...over,
});

describe('exact printed text', () => {
  it('keeps typos, capitals, punctuation and internal double spaces unchanged', () => {
    for (const t of [
      'SCHOOL OF CIVIL INGNEERING',
      'CAMPUS CAFE  & BALDEV RAJ AUDITORIUM',
      'GIRLS HOSTAL 5, 6.',
      'BLOCK- 09,10, 11,12',
    ])
      expect(exactTextSchema.parse(t)).toBe(t);
  });

  it('rejects text that a parser would have to trim or that carries control characters', () => {
    expect(exactTextSchema.safeParse(' LAW').success).toBe(false);
    expect(exactTextSchema.safeParse('LAW ').success).toBe(false);
    expect(exactTextSchema.safeParse('LA\nW').success).toBe(false);
    expect(exactTextSchema.safeParse('').success).toBe(false);
  });

  it('refuses bidi controls and unpaired surrogates like the shared text rule, keeps real scripts', () => {
    const bad = [
      'LAW‮',
      '⁦LAW⁩',
      'LA‪W',
      `LAW${String.fromCharCode(0xd800)}`,
      `${String.fromCharCode(0xdc00)}LAW`,
      'LA\tW',
      'LA\u0085W',
    ];
    for (const s of bad) expect(exactTextSchema.safeParse(s).success, JSON.stringify(s)).toBe(false);
    for (const s of ['LAW 😀', 'लॉ', 'क्‍ष', 'قانون‏'])
      expect(exactTextSchema.safeParse(s).success, JSON.stringify(s)).toBe(true);
  });

  it('label quotes need a known reference form and are strict', () => {
    expect(labelQuoteSchema.safeParse({ ref: 'iso-art-087/L1', text: 'LAW' }).success).toBe(true);
    expect(labelQuoteSchema.safeParse({ ref: 'iso-art-119/pin:58', text: '58' }).success).toBe(true);
    expect(labelQuoteSchema.safeParse({ ref: 'hotspot:hs-text-lpu-letters', text: 'LPU' }).success).toBe(
      true,
    );
    expect(labelQuoteSchema.safeParse({ ref: 'iso-art-87/L1', text: 'LAW' }).success).toBe(false);
    expect(labelQuoteSchema.safeParse({ ref: 'iso-art-087/L1', text: 'LAW', official: true }).success).toBe(
      false,
    );
    expect(labelQuoteSchema.safeParse({ ref: 'iso-art-087/L1', text: 'LAW', span: false }).success).toBe(
      false,
    );
  });
});

describe('ids', () => {
  it('derives stable subject ids', () => {
    expect(numberSubjectId('21A')).toBe('art:num-21a');
    expect(sceneSubjectId('iso-art-091')).toBe('art:scene-091');
    expect(areaSubjectId('hs-scene-pavilion')).toBe('art:area-scene-pavilion');
  });

  it('accepts base and studio building ids only', () => {
    expect(isArtworkBuildingId('osm:way/422823421')).toBe(true);
    expect(isArtworkBuildingId('osm:relation/7099162')).toBe(true);
    expect(isArtworkBuildingId('cur:main-gate')).toBe(true);
    expect(isArtworkBuildingId(`stu:${'a'.repeat(26)}`)).toBe(true);
    expect(isArtworkBuildingId('osm:node/1')).toBe(false);
    expect(isArtworkBuildingId('art:num-25')).toBe(false);
    expect(isArtworkBuildingId('Block 25')).toBe(false);
  });

  it('a numbered subject id must match its artwork number and kind prefix', () => {
    expect(artSubjectSchema.safeParse(subject()).success).toBe(true);
    expect(artSubjectSchema.safeParse(subject({ subjectId: 'art:num-26' })).success).toBe(false);
    expect(artSubjectSchema.safeParse(subject({ artworkNumber: null })).success).toBe(false);
    expect(artSubjectSchema.safeParse(subject({ kind: 'scene' })).success).toBe(false);
    expect(artSubjectSchema.safeParse(subject({ officialBlockNumber: '25' })).success).toBe(false);
  });
});

describe('associations', () => {
  const base = {
    subjectId: 'art:num-25',
    evidence: [],
    candidateFootprints: [],
    reason: 'Test.',
    revision: 1,
  };

  it('unresolved has no building; verified and approximate have exactly one', () => {
    expect(
      curatedAssociationSchema.safeParse({ ...base, status: 'unresolved', buildingId: null }).success,
    ).toBe(true);
    expect(
      curatedAssociationSchema.safeParse({ ...base, status: 'unresolved', buildingId: 'osm:way/1' }).success,
    ).toBe(false);
    expect(
      curatedAssociationSchema.safeParse({ ...base, status: 'approximate', buildingId: null }).success,
    ).toBe(false);
    expect(
      curatedAssociationSchema.safeParse({ ...base, status: 'approximate', buildingId: 'osm:way/1' }).success,
    ).toBe(true);
  });

  it('verified needs evidence (kind, description, date)', () => {
    const v = { ...base, status: 'verified', buildingId: 'osm:way/1' };
    expect(curatedAssociationSchema.safeParse(v).success).toBe(false);
    expect(curatedAssociationSchema.safeParse({ ...v, evidence: [evidence] }).success).toBe(true);
    expect(
      curatedAssociationSchema.safeParse({ ...v, evidence: [{ ...evidence, kind: 'appearance' }] }).success,
    ).toBe(false);
    expect(
      curatedAssociationSchema.safeParse({ ...v, evidence: [{ ...evidence, date: '24/10/2026' }] }).success,
    ).toBe(false);
    expect(
      curatedAssociationSchema.safeParse({ ...v, evidence: [{ ...evidence, url: 'javascript:alert(1)' }] })
        .success,
    ).toBe(false);
  });

  it('the admin write body is strict and needs expectedRevision', () => {
    const body = {
      expectedRevision: null,
      status: 'verified',
      buildingId: 'osm:way/1',
      evidence: [evidence],
    };
    expect(artworkAssociationWriteSchema.safeParse(body).success).toBe(true);
    expect(artworkAssociationWriteSchema.safeParse({ ...body, actor: 'mallory' }).success).toBe(false);
    const { expectedRevision: _omit, ...noRevision } = body;
    expect(artworkAssociationWriteSchema.safeParse(noRevision).success).toBe(false);
    expect(artworkAssociationWriteSchema.safeParse({ ...body, evidence: [] }).success).toBe(false);
  });

  it('the published shape never carries the private note or actors', () => {
    const parsed = publishedArtworkAssociationSchema.parse({
      subjectId: 'art:num-25',
      status: 'approximate',
      buildingId: 'osm:way/422823421',
      evidence: [],
      revision: 2,
      updatedAt: '2026-10-24T10:00:00.000Z',
      note: 'private',
      updatedBy: 'owner',
    });
    expect(parsed).not.toHaveProperty('note');
    expect(parsed).not.toHaveProperty('updatedBy');
  });
});

describe('derived specs', () => {
  it('accepts the three purposes and rejects anything that is not a whole, uniform copy', () => {
    expect(
      derivedSpecSchema.safeParse({ purpose: 'web-full', format: 'image/webp', quality: 0.9 }).success,
    ).toBe(true);
    expect(
      derivedSpecSchema.safeParse({ purpose: 'preview', format: 'image/jpeg', quality: 0.85, maxWidth: 1600 })
        .success,
    ).toBe(true);
    expect(
      derivedSpecSchema.safeParse({
        purpose: 'tiles',
        format: 'image/webp',
        quality: 0.9,
        tileSize: 512,
        levels: 3,
      }).success,
    ).toBe(true);
    expect(derivedSpecSchema.safeParse({ purpose: 'crop', format: 'image/webp', quality: 0.9 }).success).toBe(
      false,
    );
    expect(
      derivedSpecSchema.safeParse({
        purpose: 'preview',
        format: 'image/webp',
        quality: 0.9,
        maxWidth: 1600,
        height: 900,
      }).success,
    ).toBe(false);
  });
});
