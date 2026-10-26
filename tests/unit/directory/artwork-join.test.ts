/**
 * The illustration layer of the building directory on the committed dataset
 * and manifest (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §5): one id per
 * building, artwork-only rows never located or routable, approximate links
 * only as "Unconfirmed match", block groups exactly as the artwork prints
 * them, held labels hidden, numbers and aliases searchable.
 */
import { describe, expect, it } from 'vitest';
import { buildServices } from '../../../src/app/data/services.ts';
import {
  AREAS_GROUP_LABEL,
  artworkNumberQuery,
  NUMBERED_UNCAPTIONED_GROUP_LABEL,
  SCENES_GROUP_LABEL,
} from '../../../src/directory/index.ts';
import { artManifest, artServices, campusData, CANDIDATE_25, VERIFIED_25 } from './artwork-fixtures.ts';

describe('directory illustration layer (curated baseline: nothing verified)', () => {
  const s = artServices();
  const dir = s.buildingDirectory;
  const art = dir.artwork!;
  const m = artManifest();

  it('represents every subject by exactly one row, and adds no building records', () => {
    expect(art).not.toBeNull();
    expect(art.subjectTarget.size).toBe(m.subjects.length);
    const inventory = campusData().buildings.features.filter(
      (f) =>
        f.properties.inCampusInventory &&
        (f.properties.campusStatus === 'inside' || f.properties.campusStatus === 'crossing'),
    ).length;
    expect(dir.entries).toHaveLength(inventory);
    expect(new Set(dir.entries.map((e) => e.id)).size).toBe(inventory);
    // Nothing is verified in the baseline: every subject is an artwork-only row with its art: id.
    expect(art.entries).toHaveLength(m.subjects.length);
    for (const e of art.entries) expect(dir.byId.has(e.id)).toBe(false);
    expect(dir.entries.every((e) => e.artwork.length === 0)).toBe(true);
    expect(art.statusCounts).toEqual({ verified: 0, approximate: 19, unresolved: 63 });
  });

  it('unresolved never gets coordinates and approximate is never routable', () => {
    for (const e of art.entries) {
      expect(e.location, e.id).toBeNull();
      expect(e.routable, e.id).toBe(false);
      if (e.association.status === 'unresolved') {
        expect(e.unconfirmedMatch, e.id).toBeNull();
        expect(e.association.buildingId).toBeNull();
      }
      if (e.association.status === 'approximate') {
        // An identity is never set for an approximate link; only the unconfirmed pointer.
        expect(e.association.buildingId, e.id).toBeNull();
        expect(e.unconfirmedMatch?.label).toBe('Unconfirmed match');
      }
    }
    const approx = art.entries.filter((e) => e.association.status === 'approximate');
    expect(approx).toHaveLength(19);
  });

  it('points an approximate item at its candidate building without joining identities', () => {
    const e25 = art.byId.get('art:num-25')!;
    expect(e25.unconfirmedMatch?.buildingId).toBe(CANDIDATE_25);
    const candidate = dir.byId.get(CANDIDATE_25)!;
    expect(candidate.unconfirmedArtwork.map((p) => p.subjectId)).toEqual([
      'art:num-25',
      'art:num-26',
      'art:num-27',
      'art:num-28',
      'art:num-29',
    ]);
    expect(candidate.artwork).toEqual([]);
    // The candidate is not findable by the artwork's labels (they are not its labels).
    expect(dir.search('SCHOOL OF AGRICULTURE').map((e) => e.id)).not.toContain(CANDIDATE_25);
    expect(dir.item('art:num-25')).toMatchObject({ kind: 'artwork', id: 'art:num-25' });
  });

  it('groups by the printed block caption headings, exactly as printed, in file and caption order', () => {
    const captions = art.groups.filter((g) => g.kind === 'block-caption');
    expect(captions[0]!.heading).toBe('BLOCK-1');
    const byHeading = new Map(captions.map((g) => [g.heading, g]));
    expect(byHeading.get('BLOCK- 48, 49')!.items.map((i) => i.id)).toEqual(['art:num-48', 'art:num-49']);
    expect(byHeading.get('BLOCK- 09,10, 11,12')!.items.map((i) => i.id)).toEqual([
      'art:num-9',
      'art:num-10',
      'art:num-11',
      'art:num-12',
    ]);
    expect(byHeading.get('BLOCK-25,26:')!.items.map((i) => i.id)).toEqual(['art:num-25', 'art:num-26']);
    // Iso-art-087 prints one caption run: its headings follow the printed order.
    const run = captions.filter((g) => g.headingRef === 'iso-art-087/L1').map((g) => g.heading);
    expect(run.slice(0, 3)).toEqual(['BLOCK-25,26:', 'BLOCK-27:', 'BLOCK-28:']);
    // Every heading is printed text of the inventory label it cites.
    for (const g of captions) {
      const [asset] = g.headingRef!.split('/');
      const source = m.assets.find((a) => a.assetId === asset)!;
      const label = source.labels.find((l) => l.labelId === g.headingRef)!;
      expect(label.text.includes(g.heading!), g.heading!).toBe(true);
      expect(g.label).toBe(g.heading);
      // The vignette that prints the caption, as the unchanged published original.
      expect(g.thumbnail?.url).toBe(source.original!.url);
      expect(g.thumbnail?.assetId).toBe(asset);
    }
    const tail = art.groups.filter((g) => g.kind !== 'block-caption').map((g) => g.label);
    expect(tail).toEqual([NUMBERED_UNCAPTIONED_GROUP_LABEL, SCENES_GROUP_LABEL, AREAS_GROUP_LABEL]);
    // Every subject appears in exactly one group.
    const all = art.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(m.subjects.length);
  });

  it('keeps every printed label exactly (typos included) and corrected spellings only as aliases', () => {
    const civil = art.byId.get('art:num-56')!;
    expect(civil.title).toBe('SCHOOL OF CIVIL INGNEERING');
    expect(civil.labels.map((l) => l.text)).toContain('SCHOOL OF CIVIL INGNEERING');
    expect(civil.aliases).toEqual(['SCHOOL OF CIVIL ENGINEERING']);
    expect(art.byId.get('art:num-2')!.title).toBe('CAMPUS CAFE  & BALDEV RAJ AUDITORIUM');
    expect(dir.find('school of civil engineering')[0]!.id).toBe('art:num-56');
    expect(dir.find('INGNEERING').map((i) => i.id)).toEqual(
      expect.arrayContaining(['art:num-55', 'art:num-56']),
    );
  });

  it('finds an artwork number by "25", "Block 25", "BLOCK-25" and "block25", never as a map building', () => {
    for (const q of ['25', 'Block 25', 'BLOCK-25', 'block25', 'BLOCK- 25']) {
      const top = dir.find(q)[0]!;
      expect(top, q).toMatchObject({ kind: 'artwork', id: 'art:num-25' });
    }
    expect(dir.find('Block 09')[0]!.id).toBe('art:num-9');
    expect(dir.find('9')[0]!.id).toBe('art:num-9');
    expect(artworkNumberQuery('21A')).toBe('21a');
    expect(dir.find('21a')[0]!.id).toBe('art:num-21a');
    expect(artworkNumberQuery('school')).toBeNull();
  });

  it('never shows or searches a label held for the owner, nor the vignette that prints it', () => {
    const held = art.byId.get('art:scene-103')!;
    expect(held.labelWithheld).toBe(true);
    expect(held.labels).toEqual([]);
    expect(held.title).not.toMatch(/DILDO/i);
    expect(dir.find('DILDO PARK')).toEqual([]);
    expect(art.thumbnailOf('art:scene-103')).toBeNull();
    for (const g of art.groups) expect(g.thumbnail?.assetId).not.toBe('iso-art-103');
  });

  it('lists the overview index sections exactly, for the illustration filter', () => {
    const texts = art.sections.map((x) => x.text);
    expect(texts).toEqual(expect.arrayContaining(['EDUCATION', 'RESIDENTIAL', 'ADMINISTRATIVE']));
    expect(art.sectionOf.get('art:num-25')).toBe('EDUCATION');
    expect(art.sectionOf.get('art:scene-103')).toBeNull();
  });
});

describe('directory illustration layer with a verified owner decision', () => {
  const s = artServices([VERIFIED_25]);
  const dir = s.buildingDirectory;
  const art = dir.artwork!;

  it('joins a verified subject into its building: one entry, one id, no artwork-only duplicate', () => {
    expect(art.byId.has('art:num-25')).toBe(false);
    expect(art.entries).toHaveLength(81);
    const b = dir.byId.get(CANDIDATE_25)!;
    expect(b.artwork.map((l) => l.subjectId)).toEqual(['art:num-25']);
    expect(b.artwork[0]!.labels.map((l) => l.text)).toContain('SCHOOL OF AGRICULTURE');
    // 26–29 stay approximate pointers at the same building; 25 is no longer one.
    expect(b.unconfirmedArtwork.map((p) => p.subjectId)).toEqual([
      'art:num-26',
      'art:num-27',
      'art:num-28',
      'art:num-29',
    ]);
    expect(dir.item('art:num-25')).toMatchObject({ kind: 'building', id: CANDIDATE_25 });
    const group = art.groups.find((g) => g.heading === 'BLOCK-25,26:')!;
    expect(group.items.map((i) => [i.kind, i.id])).toEqual([
      ['building', CANDIDATE_25],
      ['artwork', 'art:num-26'],
    ]);
    expect(art.statusCounts.verified).toBe(1);
  });

  it('finds the building by the verified exact label and number', () => {
    expect(dir.find('SCHOOL OF AGRICULTURE')[0]).toMatchObject({ kind: 'building', id: CANDIDATE_25 });
    expect(dir.find('Block 25')[0]).toMatchObject({ kind: 'building', id: CANDIDATE_25 });
    expect(dir.search('25')[0]!.id).toBe(CANDIDATE_25);
  });

  it('shows a verified link to a building outside the directory as unresolved (reported, never guessed)', () => {
    const s2 = artServices([{ ...VERIFIED_25, buildingId: 'osm:way/1' }]);
    expect(s2.artwork.issues.map((i) => i.code)).toContain('building-missing');
    const e = s2.buildingDirectory.artwork!.byId.get('art:num-25')!;
    expect(e.association.status).toBe('unresolved');
    expect(e.location).toBeNull();
    expect(s2.buildingDirectory.entries.some((x) => x.artwork.length > 0)).toBe(false);
  });
});

describe('directory without the artwork', () => {
  it('lists the map buildings only and resolves no art: ids', () => {
    // What the app gets when the manifest is missing: buildServices without an artwork load.
    const plain = buildServices(campusData());
    expect(plain.buildingDirectory.artwork).toBeNull();
    expect(plain.buildingDirectory.item('art:num-25')).toBeUndefined();
    expect(plain.buildingDirectory.find('Block 25').every((i) => i.kind === 'building')).toBe(true);
    expect(plain.artwork.unavailableReason).toMatch(/could not be loaded/);
    expect(plain.artwork.manifest).toBeNull();
  });
});
