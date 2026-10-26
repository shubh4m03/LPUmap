/** Merge rule: curated baseline + owner decisions (src/isometric-art/associations.ts). */
import { describe, expect, it } from 'vitest';
import { mergeArtworkAssociations } from '../../../src/isometric-art/associations.ts';
import type { CuratedAssociation, PublishedArtworkAssociation } from '../../../src/isometric-art/schema.ts';

const cand = [
  { buildingId: 'osm:way/1', score: 0.75, shapeMatch: 'strong' as const, rank: 1 },
  { buildingId: 'osm:way/2', score: 0.4, shapeMatch: 'weak' as const, rank: 2 },
];
const baseline: CuratedAssociation[] = [
  {
    subjectId: 'art:num-25',
    status: 'approximate',
    buildingId: 'osm:way/1',
    evidence: [],
    candidateFootprints: cand,
    reason: 'Reviewed candidate.',
    revision: 1,
  },
  {
    subjectId: 'art:num-9',
    status: 'unresolved',
    buildingId: null,
    evidence: [],
    candidateFootprints: cand,
    reason: 'Ambiguous.',
    revision: 1,
  },
];
const evidence = [{ kind: 'site-sign' as const, description: 'Sign reads Block 25.', date: '2026-10-24' }];
const decision = (over: Partial<PublishedArtworkAssociation>): PublishedArtworkAssociation => ({
  subjectId: 'art:num-9',
  status: 'verified',
  buildingId: 'osm:way/2',
  evidence,
  revision: 3,
  updatedAt: '2026-10-24T10:00:00.000Z',
  ...over,
});
const all = new Set(['osm:way/1', 'osm:way/2']);
const exists = (id: string) => all.has(id);
const subjectIds = ['art:num-25', 'art:num-9', 'art:scene-091'];

describe('mergeArtworkAssociations', () => {
  it('uses the curated baseline, and exposes an approximate link only as an unconfirmed match', () => {
    const { bySubject, issues } = mergeArtworkAssociations({
      subjectIds,
      baseline,
      decisions: [],
      buildingExists: exists,
    });
    expect(issues).toEqual([]);
    const a = bySubject.get('art:num-25')!;
    expect(a).toMatchObject({
      status: 'approximate',
      buildingId: null,
      unconfirmedMatchId: 'osm:way/1',
      source: 'curated',
    });
    expect(bySubject.get('art:scene-091')).toMatchObject({
      status: 'unresolved',
      source: 'default',
      buildingId: null,
    });
  });

  it('an owner decision replaces the baseline whole but keeps the curated candidates', () => {
    const { bySubject } = mergeArtworkAssociations({
      subjectIds,
      baseline,
      decisions: [decision({})],
      buildingExists: exists,
    });
    const a = bySubject.get('art:num-9')!;
    expect(a).toMatchObject({
      status: 'verified',
      buildingId: 'osm:way/2',
      unconfirmedMatchId: null,
      source: 'owner',
    });
    expect(a.evidence).toEqual(evidence);
    expect(a.candidateFootprints).toEqual(cand);
    expect(a.reason).toBeNull();
  });

  it('an owner "unresolved" overrides a curated approximate link', () => {
    const { bySubject } = mergeArtworkAssociations({
      subjectIds,
      baseline,
      decisions: [
        decision({ subjectId: 'art:num-25', status: 'unresolved', buildingId: null, evidence: [] }),
      ],
      buildingExists: exists,
    });
    expect(bySubject.get('art:num-25')).toMatchObject({
      status: 'unresolved',
      unconfirmedMatchId: null,
      source: 'owner',
    });
  });

  it('reports and ignores a decision for an unknown subject', () => {
    const { bySubject, issues } = mergeArtworkAssociations({
      subjectIds,
      baseline,
      decisions: [decision({ subjectId: 'art:num-99' })],
      buildingExists: exists,
    });
    expect(bySubject.has('art:num-99')).toBe(false);
    expect(issues).toEqual([expect.objectContaining({ subjectId: 'art:num-99', code: 'orphan-decision' })]);
  });

  it('downgrades a link to a building that no longer exists, without inventing another', () => {
    const { bySubject, issues } = mergeArtworkAssociations({
      subjectIds,
      baseline,
      decisions: [decision({})],
      buildingExists: (id) => id === 'osm:way/1',
    });
    expect(bySubject.get('art:num-9')).toMatchObject({
      status: 'unresolved',
      buildingId: null,
      source: 'owner',
    });
    expect(issues.map((i) => i.code)).toEqual(['building-missing']);
  });

  it('keeps the highest revision when the same subject is decided twice', () => {
    const { bySubject, issues } = mergeArtworkAssociations({
      subjectIds,
      baseline,
      decisions: [decision({ revision: 5, buildingId: 'osm:way/1' }), decision({ revision: 4 })],
      buildingExists: exists,
    });
    expect(bySubject.get('art:num-9')).toMatchObject({ buildingId: 'osm:way/1', revision: 5 });
    expect(issues.map((i) => i.code)).toEqual(['duplicate-decision']);
  });
});
