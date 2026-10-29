import type { FeatureCollection } from 'geojson';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { frameCandidate } from '../../../src/components/place/artwork-format.ts';
import type { DirectoryEntry } from '../../../src/directory/index.ts';
import { unconfirmedMatchLabel, UNCONFIRMED_MATCH_LABEL } from '../../../src/isometric-art/text.ts';
import {
  applyUnconfirmedMatch,
  UNCONFIRMED_LAYER_IDS,
  UNCONFIRMED_SOURCE_ID,
  unconfirmedMatchCollection,
  unconfirmedMatchLayers,
} from '../../../src/map/unconfirmed-match.ts';
import { resetAppStore } from '../app/render-helpers.tsx';

const SQUARE = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [75.7, 31.25],
      [75.701, 31.25],
      [75.701, 31.251],
      [75.7, 31.25],
    ],
  ],
};
const BUILDINGS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: SQUARE, properties: { id: 'osm:way/1', name: null } },
    { type: 'Feature', geometry: SQUARE, properties: { id: 'osm:way/2', name: 'Other' } },
  ],
};

function fakeMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  return {
    sources,
    layers,
    getSource: vi.fn((id: string) => sources.get(id)),
    addSource: vi.fn((id: string, s: unknown) => void sources.set(id, s)),
    removeSource: vi.fn((id: string) => void sources.delete(id)),
    getLayer: vi.fn((id: string) => layers.get(id)),
    addLayer: vi.fn((l: { id: string }) => void layers.set(l.id, l)),
    removeLayer: vi.fn((id: string) => void layers.delete(id)),
  };
}

// Artwork gate leftover: map modes outline an "Unconfirmed match" candidate (dashed, labelled).
describe('unconfirmed match outline', () => {
  const overlay = { buildingId: 'osm:way/1', label: unconfirmedMatchLabel('Unnamed building E2-05') };

  it('takes the candidate footprint and labels it "Unconfirmed match: <name>"', () => {
    const fc = unconfirmedMatchCollection(BUILDINGS, overlay);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry).toEqual(SQUARE);
    expect(fc.features[0]!.properties).toEqual({
      buildingId: 'osm:way/1',
      label: `${UNCONFIRMED_MATCH_LABEL}: Unnamed building E2-05`,
    });
    expect(unconfirmedMatchCollection(BUILDINGS, null).features).toEqual([]);
    expect(unconfirmedMatchCollection(BUILDINGS, { ...overlay, buildingId: 'osm:way/404' }).features).toEqual(
      [],
    );
  });

  it('draws a dashed outline and an always-placed label; removes both when cleared', () => {
    const [line, label] = unconfirmedMatchLayers('dark');
    expect(line.paint?.['line-dasharray']).toEqual([2, 1.5]);
    expect(label.layout?.['text-field']).toEqual(['get', 'label']);
    expect(label.layout?.['text-allow-overlap']).toBe(true);

    const map = fakeMap();
    applyUnconfirmedMatch(map as never, 'light', unconfirmedMatchCollection(BUILDINGS, overlay));
    expect(map.sources.has(UNCONFIRMED_SOURCE_ID)).toBe(true);
    expect([...map.layers.keys()]).toEqual([UNCONFIRMED_LAYER_IDS.outline, UNCONFIRMED_LAYER_IDS.label]);
    applyUnconfirmedMatch(map as never, 'light', unconfirmedMatchCollection(BUILDINGS, null));
    expect(map.sources.size).toBe(0);
    expect(map.layers.size).toBe(0);
  });
});

describe('store: showUnconfirmedMatch', () => {
  beforeEach(resetAppStore);

  it('frames the candidate without selecting it, and the next selection clears the outline', () => {
    const s = useAppStore.getState();
    s.selectPlace('art:num-25', { focus: false, openDetails: false });
    s.showUnconfirmedMatch('osm:way/1', 'Unconfirmed match: X');
    const after = useAppStore.getState();
    expect(after.unconfirmedMatch).toEqual({ buildingId: 'osm:way/1', label: 'Unconfirmed match: X' });
    expect(after.selectedPlaceId).toBe('art:num-25');
    expect(after.focusRequest).toMatchObject({ kind: 'place', placeId: 'osm:way/1' });
    after.selectPlace('osm:way/2', { focus: false, openDetails: false });
    expect(useAppStore.getState().unconfirmedMatch).toBeNull();
    useAppStore.getState().showUnconfirmedMatch('osm:way/1', 'x');
    useAppStore.getState().clearSelection();
    expect(useAppStore.getState().unconfirmedMatch).toBeNull();
  });
});

describe('"Show the candidate on the map" (place details)', () => {
  beforeEach(resetAppStore);

  it('outlines the candidate as a labelled unconfirmed match, without selecting it', () => {
    useAppStore.getState().selectPlace('art:num-25', { focus: false, openDetails: false });
    frameCandidate({ id: 'osm:way/1', title: 'Block 34' } as DirectoryEntry);
    const s = useAppStore.getState();
    expect(s.unconfirmedMatch).toEqual({
      buildingId: 'osm:way/1',
      label: `${UNCONFIRMED_MATCH_LABEL}: Block 34`,
    });
    expect(s.selectedPlaceId).toBe('art:num-25');
    expect(s.focusRequest).toMatchObject({ kind: 'place', placeId: 'osm:way/1' });
  });
});
