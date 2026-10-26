/** Directory contract for artwork subjects (src/isometric-art/directory.ts). */
import { describe, expect, it } from 'vitest';
import { mergeArtworkAssociations } from '../../../src/isometric-art/associations.ts';
import {
  ARTWORK_NOT_ROUTABLE_NOTE,
  artworkNumberQuery,
  createArtworkDirectory,
} from '../../../src/isometric-art/directory.ts';
import {
  ARTWORK_NUMBER_NOTE,
  UNCONFIRMED_MATCH_LABEL,
  type ArtSubject,
  type CuratedAssociation,
} from '../../../src/isometric-art/schema.ts';

const s = (over: Partial<ArtSubject>): ArtSubject => ({
  subjectId: 'art:num-55',
  kind: 'numbered',
  artworkNumber: '55',
  displayLabel: { ref: 'iso-art-083/L2', text: 'SCHOOL OF MECHANICAL INGNEERING' },
  visibleBlockLabel: { ref: 'iso-art-083/L1', text: 'BLOCK- 55' },
  otherLabels: [{ ref: 'iso-art-001/L23', text: 'MECHANICAL' }],
  artworkCategory: { ref: 'iso-art-001/L2', text: 'EDUCATION' },
  hotspotIds: [],
  vignetteAssetIds: ['iso-art-083'],
  relations: [],
  aliases: ['SCHOOL OF MECHANICAL ENGINEERING'],
  displayHold: null,
  needsManualVerification: [],
  notes: '',
  ...over,
});

const subjects: ArtSubject[] = [
  s({}),
  s({
    subjectId: 'art:num-37',
    artworkNumber: '37',
    displayLabel: { ref: 'iso-art-087/L1', text: 'CENTRAL LIBRARY', span: true },
    visibleBlockLabel: { ref: 'iso-art-087/L1', text: 'BLOCK-37:', span: true },
    otherLabels: [{ ref: 'iso-art-001/L21', text: 'RESEARCH' }],
    aliases: [],
    hotspotIds: ['hs-pin-37'],
  }),
  s({
    subjectId: 'art:num-25',
    artworkNumber: '25',
    displayLabel: { ref: 'iso-art-087/L1', text: 'SCHOOL OF AGRICULTURE', span: true },
    visibleBlockLabel: { ref: 'iso-art-087/L1', text: 'BLOCK-25,26:', span: true },
    otherLabels: [],
    aliases: [],
    hotspotIds: ['hs-pin-25'],
  }),
  s({
    subjectId: 'art:num-20',
    artworkNumber: '20',
    displayLabel: null,
    visibleBlockLabel: null,
    otherLabels: [],
    artworkCategory: null,
    aliases: [],
  }),
  s({
    subjectId: 'art:scene-103',
    kind: 'scene',
    artworkNumber: null,
    displayLabel: { ref: 'iso-art-103/L1', text: 'DILDO PARK' },
    visibleBlockLabel: null,
    otherLabels: [],
    artworkCategory: null,
    aliases: [],
    displayHold: { reason: 'Owner decision pending.' },
  }),
  s({
    subjectId: 'art:area-scene-courts',
    kind: 'area',
    artworkNumber: null,
    displayLabel: null,
    visibleBlockLabel: null,
    otherLabels: [],
    artworkCategory: null,
    aliases: [],
    hotspotIds: ['hs-scene-courts'],
  }),
];

const assoc = (
  subjectId: string,
  status: CuratedAssociation['status'],
  buildingId: string | null,
): CuratedAssociation => ({
  subjectId,
  status,
  buildingId,
  evidence:
    status === 'verified'
      ? [{ kind: 'official-document', description: 'Campus plan.', date: '2026-10-24' }]
      : [],
  candidateFootprints: buildingId ? [{ buildingId, score: 0.75, shapeMatch: 'strong', rank: 1 }] : [],
  reason: 'Test.',
  revision: 1,
});

const merged = mergeArtworkAssociations({
  subjectIds: subjects.map((x) => x.subjectId),
  baseline: [
    assoc('art:num-37', 'verified', 'osm:way/422556249'),
    assoc('art:num-25', 'approximate', 'osm:way/422823421'),
  ],
  decisions: [],
  buildingExists: () => true,
});
const dir = createArtworkDirectory(subjects, merged.bySubject);

describe('createArtworkDirectory', () => {
  it('joins a verified subject to the existing building entry instead of adding a second entry', () => {
    expect(dir.entries.map((e) => e.id)).not.toContain('art:num-37');
    const joins = dir.joinsByBuilding.get('osm:way/422556249');
    expect(joins?.map((j) => j.subjectId)).toEqual(['art:num-37']);
    expect(joins?.[0]?.labels.map((l) => l.text)).toEqual([
      'CENTRAL LIBRARY',
      'BLOCK-37:',
      'RESEARCH',
      'EDUCATION',
    ]);
  });

  it('artwork-only entries keep art: ids, exact titles, no coordinates and are never routable', () => {
    for (const e of dir.entries) {
      expect(e.id.startsWith('art:')).toBe(true);
      expect(e.routable).toBe(false);
      expect(e.routableNote).toBe(ARTWORK_NOT_ROUTABLE_NOTE);
      expect(e.location).toBeNull();
    }
    const e55 = dir.bySubject.get('art:num-55');
    expect(e55 && 'title' in e55 ? e55.title : null).toBe('SCHOOL OF MECHANICAL INGNEERING');
    expect(e55 && 'artworkNumberNote' in e55 ? e55.artworkNumberNote : null).toBe(ARTWORK_NUMBER_NOTE);
  });

  it('shows an approximate link only as an unconfirmed match pointer', () => {
    const e = dir.entries.find((x) => x.id === 'art:num-25')!;
    expect(e.unconfirmedMatch).toEqual({ buildingId: 'osm:way/422823421', label: UNCONFIRMED_MATCH_LABEL });
    expect(dir.joinsByBuilding.has('osm:way/422823421')).toBe(false);
    expect(e.association.buildingId).toBeNull();
  });

  it('never invents a name: no label → a neutral title from the printed number, or "unlabelled"', () => {
    expect(dir.entries.find((x) => x.id === 'art:num-20')?.title).toBe('Illustration pin 20');
    expect(dir.entries.find((x) => x.id === 'art:area-scene-courts')?.title).toBe(
      'Unlabelled area on the illustration',
    );
  });

  it('withholds a held label from titles, labels and search', () => {
    const e = dir.entries.find((x) => x.id === 'art:scene-103')!;
    expect(e.labelWithheld).toBe(true);
    expect(e.labels).toEqual([]);
    expect(e.title).not.toMatch(/DILDO/);
    expect(dir.search('dildo')).toEqual([]);
  });

  it('finds entries by exact printed label and by alias; exact matches rank first; joins resolve to the building id', () => {
    expect(dir.search('SCHOOL OF MECHANICAL INGNEERING')[0]).toMatchObject({
      kind: 'artwork',
      id: 'art:num-55',
      rank: 0,
    });
    expect(dir.search('mechanical engineering')[0]).toMatchObject({ id: 'art:num-55' });
    // The printed number ranks first in any written form (the artwork's own numbering).
    for (const q of ['25', '025', 'Block 25', 'BLOCK-25', 'block25'])
      expect(dir.search(q)[0], q).toMatchObject({ id: 'art:num-25', rank: 0 });
    expect(artworkNumberQuery('BLOCK- 09')).toBe('9');
    expect(artworkNumberQuery('21A')).toBe('21a');
    expect(artworkNumberQuery('school')).toBeNull();
    // Every query word contained (any order) still finds the item, ranked last.
    expect(dir.search('ingneering mechanical')[0]).toMatchObject({ id: 'art:num-55', rank: 2 });
    expect(dir.search('central library')).toEqual([
      expect.objectContaining({ kind: 'building', id: 'osm:way/422556249', rank: 0 }),
    ]);
    expect(dir.search('   ')).toEqual([]);
  });
});
