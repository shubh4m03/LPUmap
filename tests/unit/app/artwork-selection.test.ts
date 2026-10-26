/**
 * Selection sync by stable ids between the illustration, the map modes and the
 * directory (src/app/artwork-selection.ts), the `art:` deep links and the
 * publication's artwork decisions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { selectDirectoryItem, unconfirmedMatchFor } from '../../../src/app/artwork-selection.ts';
import { buildArtwork, loadArtwork } from '../../../src/app/data/artwork.ts';
import { parsePublication } from '../../../src/app/data/publication.ts';
import { ARTWORK_ID_RE, isArtworkId, isPlaceIdLike, parsePlaceParam } from '../../../src/app/deep-link.ts';
import { useAppStore } from '../../../src/app/store/index.ts';
import { EMPTY_PUBLICATION } from '../../../src/community/schema.ts';
import { ART_SUBJECT_ID_RE, ARTWORK_UNAVAILABLE_REASON } from '../../../src/isometric-art/index.ts';
import { artManifest, artServices, CANDIDATE_25, VERIFIED_25 } from '../directory/artwork-fixtures.ts';
import { resetAppStore } from './render-helpers.tsx';

afterEach(resetAppStore);

describe('selecting a directory row', () => {
  it('an approximate item selects its own art: id; its candidate is never selected', () => {
    const s = artServices();
    selectDirectoryItem(s.buildingDirectory.item('art:num-25')!);
    const st = useAppStore.getState();
    expect(st.selectedPlaceId).toBe('art:num-25');
    expect(st.activePanel).toBe('details');
    // The focus request names the art: id: the illustration frames it; no map mode has a position for it.
    expect(st.focusRequest).toMatchObject({ kind: 'place', placeId: 'art:num-25' });
    expect(s.getPlace('art:num-25')).toBeUndefined();
    expect(unconfirmedMatchFor(s.buildingDirectory, 'art:num-25')).toMatchObject({
      subjectId: 'art:num-25',
      buildingId: CANDIDATE_25,
    });
  });

  it('a verified item resolves to its building id (the same entry and footprint in every mode)', () => {
    const s = artServices([VERIFIED_25]);
    const item = s.buildingDirectory.item('art:num-25')!;
    expect(item).toMatchObject({ kind: 'building', id: CANDIDATE_25 });
    selectDirectoryItem(item);
    const st = useAppStore.getState();
    expect(st.selectedPlaceId).toBe(CANDIDATE_25);
    expect(st.focusRequest).toMatchObject({ kind: 'place', placeId: CANDIDATE_25 });
    expect(unconfirmedMatchFor(s.buildingDirectory, CANDIDATE_25)).toBeNull();
  });

  it('list mode never requests a camera move', () => {
    const s = artServices([VERIFIED_25]);
    useAppStore.setState({ listMode: true });
    selectDirectoryItem(s.buildingDirectory.item(CANDIDATE_25)!);
    selectDirectoryItem(s.buildingDirectory.item('art:num-26')!);
    expect(useAppStore.getState().focusRequest).toBeNull();
  });
});

describe('art: deep links', () => {
  it('accepts every manifest subject id and agrees with the artwork contract grammar', () => {
    expect(ARTWORK_ID_RE.source).toBe(ART_SUBJECT_ID_RE.source);
    for (const subj of artManifest().subjects) {
      expect(isArtworkId(subj.subjectId), subj.subjectId).toBe(true);
      expect(parsePlaceParam(`?place=${encodeURIComponent(subj.subjectId)}`)).toBe(subj.subjectId);
    }
  });

  it('rejects malformed artwork ids', () => {
    for (const bad of [
      'art:',
      'art:num-',
      'art:NUM-25',
      'art:num-25 ',
      'art:block-25',
      `art:num-${'a'.repeat(70)}`,
    ])
      expect(isPlaceIdLike(bad), bad).toBe(false);
  });
});

describe('artwork load and owner decisions', () => {
  it('a missing manifest never fails: the reason is kept and nothing is merged', async () => {
    const failed = await loadArtwork(() =>
      Promise.resolve({ ok: false, reason: ARTWORK_UNAVAILABLE_REASON }),
    );
    expect(failed).toEqual({ manifest: null, unavailableReason: ARTWORK_UNAVAILABLE_REASON });
    const thrown = await loadArtwork(() => Promise.reject(new Error('boom')));
    expect(thrown.manifest).toBeNull();
    const built = buildArtwork(failed, [VERIFIED_25], new Set([CANDIDATE_25]));
    expect(built.directory).toBeNull();
    expect(built.associations.size).toBe(0);
  });

  it('an orphan decision is reported and ignored', () => {
    const built = buildArtwork(
      { manifest: artManifest(), unavailableReason: null },
      [{ ...VERIFIED_25, subjectId: 'art:num-999' }],
      // Every curated candidate is a current building here, so only the orphan is reported.
      new Set(artManifest().associations.flatMap((x) => (x.buildingId ? [x.buildingId] : []))),
    );
    expect(built.issues.map((i) => i.code)).toEqual(['orphan-decision']);
    expect(built.associations.get('art:num-25')!.status).toBe('approximate');
    expect(built.subjectOfHotspot('hs-pin-25')).toBe('art:num-25');
  });

  it('a malformed artwork decision is dropped without blanking the rest of the publication', () => {
    const body = {
      ...EMPTY_PUBLICATION,
      schemaVersion: 3,
      artworkAssociations: [
        VERIFIED_25,
        // Verified without evidence: violates the contract, so this one row is dropped.
        { ...VERIFIED_25, subjectId: 'art:num-26', evidence: [] },
      ],
    };
    const pub = parsePublication(body);
    expect(pub?.artworkAssociations?.map((a) => a.subjectId)).toEqual(['art:num-25']);
  });
});
