import { describe, expect, it } from 'vitest';
import { PROHIBITED_SOURCE_MESSAGE } from '../../../src/building-studio/text.ts';
import {
  APPEARANCE_PRESETS,
  applyPreset,
  categoryLabel,
  defaultIdentity,
  draftSchemaIssues,
  heightFloorsConflict,
  issuesAt,
  nearestWalkableNode,
  walkableNodesNearFootprint,
  normalizeColour,
  outsidePublishRange,
  parseAliases,
  placementDraft,
  prohibitedSourceProblem,
  publishRangeText,
  roofOptions,
  STUDIO_CATEGORY_OPTIONS,
  withRoofShape,
  withVerificationStatus,
  withWindowPattern,
} from '../../../src/building-studio/ui/fields.ts';
import { deriveFootprint, createEnuFrame } from '../../../src/building-studio/geometry.ts';
import { COLOUR_RE, facadeSchema, roofSchema } from '../../../src/building-studio/schema.ts';
import { ANCHOR, draft, identity, model } from '../building-studio/fixtures.ts';

describe('draft field problems (what the server would refuse with 400)', () => {
  it('a valid draft has none; a 1-character name and a Google Maps citation are reported with paths', () => {
    expect(draftSchemaIssues(draft())).toEqual([]);
    const bad = draft({
      identity: identity({ name: 'A' }),
      verification: {
        status: 'source-backed',
        citation: { url: 'https://www.google.com/maps/place/x', title: 'Map', accessedOn: '' },
        note: 'seen on the map',
      },
    });
    const issues = draftSchemaIssues(bad);
    expect(issuesAt(issues, 'identity.name')).toHaveLength(1);
    expect(issuesAt(issues, 'verification.citation.url')[0]?.message).toBe(PROHIBITED_SOURCE_MESSAGE);
  });
});

describe('Google sources are refused with the reason (S6)', () => {
  it('URL fields and free text', () => {
    expect(prohibitedSourceProblem('https://maps.app.goo.gl/abc', 'url')).toBe(PROHIBITED_SOURCE_MESSAGE);
    expect(prohibitedSourceProblem('earth.google.com/web', 'url')).toBe(PROHIBITED_SOURCE_MESSAGE);
    expect(prohibitedSourceProblem('see https://www.google.com/maps/@31.25,75.70', 'text')).toBe(
      PROHIBITED_SOURCE_MESSAGE,
    );
    expect(prohibitedSourceProblem('Not taken from Google Maps', 'text')).toBeNull();
    expect(prohibitedSourceProblem('https://sites.research.google/open-buildings/', 'url')).toBeNull();
    expect(prohibitedSourceProblem('  ', 'url')).toBeNull();
  });
});

describe('identity', () => {
  it('a new building starts unnamed with the suggested category (unknown → "Use not recorded")', () => {
    expect(defaultIdentity('hostel')).toMatchObject({
      name: null,
      categoryId: 'hostel',
      directoryVisible: true,
    });
    expect(defaultIdentity('nonsense').categoryId).toBe('building');
    expect(categoryLabel('building')).toBe('Use not recorded');
    expect(STUDIO_CATEGORY_OPTIONS.some((o) => o.id === 'other')).toBe(false);
    expect(parseAliases(' Block A ,, Old wing ')).toEqual(['Block A', 'Old wing']);
  });

  it('placementDraft: a new building gets an identity; a base-building model never does', () => {
    const ref = { templateId: 'academic-block', templateVersion: 1, variantId: 'plain' };
    expect(
      placementDraft({ templateRef: ref, model: model(), targetId: null }, 'academic').identity?.categoryId,
    ).toBe('academic');
    expect(
      placementDraft({ templateRef: ref, model: model(), targetId: 'osm:way/1' }, 'academic').identity,
    ).toBeNull();
  });
});

describe('dimensions', () => {
  it('height/floors conflict uses the validator tolerance max(1 m, half a floor)', () => {
    expect(heightFloorsConflict({ floors: 4, floorHeightM: 3.2, heightM: 12.8 })).toBeNull();
    expect(heightFloorsConflict({ floors: 4, floorHeightM: 3.2, heightM: 14.3 })).toBeNull();
    const c = heightFloorsConflict({ floors: 4, floorHeightM: 3.2, heightM: 20 });
    expect(c?.expectedM).toBe(12.8);
    expect(c?.message).toContain('4 floors × 3.2 m = 12.8 m');
  });

  it('publish ranges are flagged, not clamped', () => {
    expect(outsidePublishRange('widthM', 1)).toBe(true);
    expect(outsidePublishRange('widthM', 20)).toBe(false);
    expect(publishRangeText('floors')).toBe('1–40');
    expect(publishRangeText('heightM')).toBe('2.4–150 m');
  });
});

describe('roof and façade', () => {
  it('only the generator roofs are offered; pitch is added/removed with the shape', () => {
    expect(roofOptions({ generatorId: 'l-shape' })).toEqual(['flat']);
    expect(roofOptions({ generatorId: 'box' })).toContain('hip');
    const gable = withRoofShape(model().roof, 'gable');
    expect(gable.pitchDeg).toBe(25);
    expect(roofSchema.safeParse(gable).success).toBe(true);
    const flat = withRoofShape(gable, 'flat');
    expect('pitchDeg' in flat).toBe(false);
    expect(roofSchema.safeParse(flat).success).toBe(true);
  });

  it('window pattern keeps density 0 exactly for "none"', () => {
    const none = withWindowPattern(model().facade, 'none');
    expect(none.windowDensity).toBe(0);
    expect(facadeSchema.safeParse(none).success).toBe(true);
    const back = withWindowPattern(none, 'grid');
    expect(back.windowDensity).toBeGreaterThan(0);
    expect(facadeSchema.safeParse(back).success).toBe(true);
  });

  it('presets are valid colours and change appearance only', () => {
    for (const p of APPEARANCE_PRESETS) {
      expect(p.facade.wallColour).toMatch(COLOUR_RE);
      expect(p.roof.colour).toMatch(COLOUR_RE);
      const m = applyPreset(model(), p);
      expect(m.widthM).toBe(model().widthM);
      expect(m.facade.wallColour).toBe(p.facade.wallColour);
    }
    expect(normalizeColour('#A0B1C2')).toBe('#a0b1c2');
    expect(normalizeColour('red')).toBeNull();
  });
});

describe('verification', () => {
  it('switching status keeps the note and starts empty evidence (never invented)', () => {
    const sb = withVerificationStatus({ status: 'unverified' }, 'source-backed');
    expect(sb).toEqual({
      status: 'source-backed',
      citation: { url: '', title: '', accessedOn: '' },
      note: '',
    });
    const sv = withVerificationStatus({ ...sb, note: 'measured on site' } as typeof sb, 'surveyed');
    expect(sv).toEqual({ status: 'surveyed', surveyDate: '', note: 'measured on site' });
    expect(withVerificationStatus(sv, 'unverified')).toEqual({ status: 'unverified' });
  });
});

describe('access point suggestion (S7: offered, never applied by itself)', () => {
  it('finds the nearest walkable node within the limit, measured to the footprint', () => {
    const fp = deriveFootprint(model({ rotationDeg: 0, widthM: 20, lengthM: 20 }));
    if (!fp.ok) throw new Error('fp');
    const f = createEnuFrame(ANCHOR);
    const graph = {
      nodes: [f.toLngLat([0, 30]), f.toLngLat([0, 14]), f.toLngLat([0, 12])],
      edges: [
        {
          id: 0,
          from: 0,
          to: 1,
          lengthM: 16,
          highway: 'footway',
          foot: true,
          bicycle: 'no',
          steps: false,
          wheelchair: 'unknown',
          onewayBicycle: false,
          onewayFoot: false,
        },
        {
          id: 1,
          from: 2,
          to: 2,
          lengthM: 1,
          highway: 'service',
          foot: false,
          bicycle: 'no',
          steps: false,
          wheelchair: 'unknown',
          onewayBicycle: false,
          onewayFoot: false,
        },
      ],
    } as never;
    const s = nearestWalkableNode(graph, fp.footprint.coordinates, 25);
    // Node 2 is nearer but not walkable; node 1 is 4 m from the north edge.
    expect(s).toEqual({ nodeId: 1, distanceM: 4 });
    expect(nearestWalkableNode(graph, fp.footprint.coordinates, 3)).toBeNull();
    // Every candidate (for choosing on the map): walkable only, within the limit, nearest first.
    const all = walkableNodesNearFootprint(graph, fp.footprint.coordinates, 25);
    expect(all.map((c) => [c.nodeId, c.distanceM])).toEqual([
      [1, 4],
      [0, 20],
    ]);
    expect(all[0]!.position).toEqual(f.toLngLat([0, 14]));
    expect(walkableNodesNearFootprint(graph, fp.footprint.coordinates, 10).map((c) => c.nodeId)).toEqual([1]);
  });
});
