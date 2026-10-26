// @vitest-environment node
/**
 * Hit-testing in source-image pixels, the hotspot view model (exact labels,
 * keyboard order, joins by verified association only) and the choice of
 * image files, on the COMMITTED manifest.
 */
import { describe, expect, it } from 'vitest';
import {
  distanceToRing,
  hitTestHotspots,
  pointInRing,
  polygonCentroid,
  prepareHotspot,
  unionBBox,
} from '../../../src/isometric-art/hotspot-geometry.ts';
import {
  hotspotsOfSubject,
  legendLabels,
  subjectsForSelection,
  subjectTitles,
} from '../../../src/isometric-art/hotspot-model.ts';
import { artImageSources, planArtImages } from '../../../src/isometric-art/image-plan.ts';
import type { ManifestAsset } from '../../../src/isometric-art/schema.ts';
import { loadManifest, modelOf } from './renderer-fixtures.ts';

const manifest = loadManifest();
const model = modelOf(manifest);
const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('geometry', () => {
  it('point in polygon, centroid and edge distance of a square', () => {
    expect(pointInRing(square, 5, 5)).toBe(true);
    expect(pointInRing(square, 11, 5)).toBe(false);
    expect(polygonCentroid(square)).toEqual({ x: 5, y: 5 });
    expect(distanceToRing(square, 5, 13)).toBeCloseTo(3, 12);
    expect(
      polygonCentroid([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toEqual({ x: 1, y: 1 });
  });

  it('prefers the smallest outline when outlines nest; a touch tolerance reaches a near miss only', () => {
    const big = prepareHotspot(
      {
        hotspotId: 'hs-a',
        subjectId: 'art:area-a',
        kind: 'scene',
        polygon: [
          [0, 0],
          [0.5, 0],
          [0.5, 0.5],
          [0, 0.5],
        ],
        labelAnchor: [0.25, 0.25],
        pin: null,
        printedLabel: null,
        confidence: 'low',
        reviewStatus: 'needs-manual-verification',
      },
      { width: 100, height: 100 },
    );
    const small = prepareHotspot(
      {
        hotspotId: 'hs-b',
        subjectId: 'art:area-b',
        kind: 'scene',
        polygon: [
          [0.1, 0.1],
          [0.2, 0.1],
          [0.2, 0.2],
          [0.1, 0.2],
        ],
        labelAnchor: [0.15, 0.15],
        pin: null,
        printedLabel: null,
        confidence: 'low',
        reviewStatus: 'traced',
      },
      { width: 100, height: 100 },
    );
    expect(hitTestHotspots([big, small], 15, 15)?.hotspotId).toBe('hs-b');
    expect(hitTestHotspots([big, small], 40, 40)?.hotspotId).toBe('hs-a');
    expect(hitTestHotspots([big, small], 53, 20)).toBeNull();
    expect(hitTestHotspots([big, small], 53, 20, 4)?.hotspotId).toBe('hs-a');
    expect(unionBBox([big, small])).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    expect(unionBBox([])).toBeNull();
  });

  it('every real hotspot is hit at its own label anchor (an interior point), in source px', () => {
    const prepared = model.hotspots.map((h) => h.geometry);
    expect(prepared).toHaveLength(manifest.hotspots.length);
    for (const h of prepared)
      expect(hitTestHotspots(prepared, h.anchor.x, h.anchor.y)?.hotspotId).toBe(h.hotspotId);
  });

  it('a click on a printed pin number selects that pin, even where a neighbouring outline runs under its disc', () => {
    const prepared = model.hotspots.map((h) => h.geometry);
    const pinned = manifest.hotspots.filter((h) => h.pin !== null);
    expect(pinned).toHaveLength(45);
    const { width, height } = manifest.coordinateSpace;
    for (const h of pinned) {
      const pin = h.pin!;
      const cx = pin.x * width;
      const cy = pin.y * height;
      // Centre and four points just inside the disc rim.
      for (const [dx, dy] of [
        [0, 0],
        [0.8, 0],
        [-0.8, 0],
        [0, 0.8],
        [0, -0.8],
      ] as const)
        expect(
          hitTestHotspots(prepared, cx + dx * pin.rx * width, cy + dy * pin.ry * height)?.hotspotId,
          `${h.hotspotId} at (${dx}, ${dy})`,
        ).toBe(h.hotspotId);
    }
    // Red-team case: the "33" disc lies inside pin 36's (needs-review) outline; it used to select 36.
    const p33 = manifest.hotspots.find((h) => h.hotspotId === 'hs-pin-33')!.pin!;
    const at33 = hitTestHotspots(prepared, p33.x * width, p33.y * height);
    expect(at33?.subjectId).toBe('art:num-33');
  });

  it('the far corners of the artwork (frame, legend, index panel) hit nothing', () => {
    const prepared = model.hotspots.map((h) => h.geometry);
    for (const [x, y] of [
      [5, 5],
      [3360, 2370],
      [300, 2100], // the printed legend
      [3000, 300], // the INFORMATION index
    ] as const)
      expect(hitTestHotspots(prepared, x, y)).toBeNull();
  });
});

describe('view model', () => {
  it('has one view per hotspot, in keyboard order: pins by printed number, then the rest', () => {
    expect(model.hotspots).toHaveLength(65);
    const pins = model.hotspots.filter((h) => h.hotspot.kind === 'pin-structure');
    const numbers = pins.map((h) => Number(h.hotspot.printedLabel));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(model.hotspots.slice(0, pins.length).every((h) => h.hotspot.kind === 'pin-structure')).toBe(true);
    expect(model.hotspots.map((h) => h.order)).toEqual(model.hotspots.map((_, i) => i));
  });

  it('accessible names quote the exact printed label (typos, punctuation) and the pin as printed', () => {
    for (const h of model.hotspots) {
      const sv = model.bySubject.get(h.subjectId)!;
      expect(h.name.length).toBeGreaterThan(0);
      if (sv.titleIsPrinted) expect(h.name.startsWith(sv.title)).toBe(true);
      if (h.hotspot.kind === 'pin-structure' && sv.titleIsPrinted)
        expect(h.name.endsWith(`, pin ${h.hotspot.printedLabel}`)).toBe(true);
    }
    // Every subject's display label appears verbatim somewhere: never corrected.
    const names = model.hotspots.map((h) => h.name).join('\n');
    for (const s of manifest.subjects)
      if (s.displayLabel && !s.displayHold && s.hotspotIds.length > 0)
        expect(names).toContain(s.displayLabel.text);
    const typo = manifest.subjects.find((s) => s.displayLabel?.text.includes('INGNEERING'));
    if (typo) expect(subjectTitles(manifest.subjects).get(typo.subjectId)).toContain('INGNEERING');
  });

  it('never names an outline from position or appearance; unlabelled ones are numbered apart', () => {
    const scenes = model.hotspots.filter((h) => h.hotspot.kind === 'scene');
    expect(new Set(scenes.map((h) => h.name)).size).toBe(scenes.length);
    for (const h of scenes) expect(h.name).toMatch(/^Unlabelled area \d+ on the illustration$/);
    const grp = model.byHotspot.get('hs-grp-48-49')!;
    expect(grp.name).toBe('Unlabelled part of the building group with pins 48 and 49');
    expect(model.byHotspot.get('hs-text-lpu-letters')!.name).toBe(
      'LPU (letters printed on the illustration)',
    );
  });

  it('a label held for owner review is never shown or used as a name', () => {
    const held = manifest.subjects.filter((s) => s.displayHold);
    expect(held.length).toBeGreaterThan(0);
    const titles = subjectTitles(manifest.subjects);
    const all = [...model.hotspots.map((h) => h.name), ...titles.values()].join('\n');
    for (const s of held) {
      expect(model.bySubject.get(s.subjectId)!.titleIsPrinted).toBe(false);
      if (s.displayLabel) expect(all).not.toContain(s.displayLabel.text);
    }
  });

  it('legend labels are the exact printed ones (PEDISTRIAN, not corrected)', () => {
    expect(legendLabels(model.master)).toEqual([
      'GARDEN OR GROUND AREA',
      'ROAD',
      'PEDISTRIAN',
      'PARKING AREA',
      'LPU SURROUNDINGS',
    ]);
  });

  it('focus rectangle is the union of the outlines, inside the artwork', () => {
    const r = model.focusRect;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(3371);
    expect(r.y + r.height).toBeLessThanOrEqual(2384);
  });
});

describe('selection joins canonical ids by VERIFIED association only', () => {
  const approx = manifest.associations.find((a) => a.status === 'approximate')!;

  it('today (no verified link): a subject id selects itself; an approximate candidate building selects nothing', () => {
    expect(model.subjectsByBuilding.size).toBe(0);
    expect(subjectsForSelection(model, approx.subjectId)).toEqual([approx.subjectId]);
    expect(subjectsForSelection(model, approx.buildingId)).toEqual([]);
    expect(subjectsForSelection(model, null)).toEqual([]);
    expect(subjectsForSelection(model, 'osm:way/1')).toEqual([]);
  });

  it('a verified owner decision makes the building id select that subject (one identity in every view)', () => {
    const verified = modelOf(manifest, [
      {
        subjectId: approx.subjectId,
        status: 'verified',
        buildingId: approx.buildingId,
        evidence: [{ kind: 'site-sign', description: 'Sign at the entrance', date: '2026-10-24' }],
        revision: 1,
        updatedAt: '2026-10-24T10:00:00Z',
      },
    ]);
    expect(subjectsForSelection(verified, approx.buildingId)).toEqual([approx.subjectId]);
    expect(verified.bySubject.get(approx.subjectId)!.association.buildingId).toBe(approx.buildingId);
    expect(hotspotsOfSubject(verified, approx.subjectId).map((h) => h.subjectId)).toEqual(
      manifest.subjects.find((s) => s.subjectId === approx.subjectId)!.hotspotIds.map(() => approx.subjectId),
    );
  });

  it('a verified link to a building missing from the data is not joined', () => {
    const missing = modelOf(
      manifest,
      [
        {
          subjectId: approx.subjectId,
          status: 'verified',
          buildingId: approx.buildingId,
          evidence: [{ kind: 'site-sign', description: 'Sign at the entrance', date: '2026-10-24' }],
          revision: 1,
          updatedAt: '2026-10-24T10:00:00Z',
        },
      ],
      () => false,
    );
    expect(subjectsForSelection(missing, approx.buildingId)).toEqual([]);
  });
});

describe('image files', () => {
  const master = model.master;
  const sources = artImageSources(master, model.space);
  const everything = { x: 0, y: 0, width: 3371, height: 2384 };

  it('reads the full image, previews and the tile pyramid from the manifest', () => {
    expect(sources.full).not.toBeNull();
    if (master.derived.length === 0) {
      expect(sources.full!.purpose).toBe('original');
      return;
    }
    expect(sources.previews.length).toBeGreaterThan(0);
    expect(sources.tiles.size).toBeGreaterThan(0);
  });

  it('first paint uses the smallest sharp-enough file; zooming in adds visible tiles only', () => {
    const low = planArtImages(sources, 0.2, everything)!;
    expect(low.detail).toEqual([]);
    if (sources.previews.length === 0) return;
    expect(low.base.purpose).toBe('preview');
    const phone = planArtImages(sources, 1, { x: 1000, y: 800, width: 400, height: 500 })!;
    expect(phone.base.purpose).toBe('preview');
    expect(phone.detail.length).toBeGreaterThan(0);
    expect(phone.detail.every((t) => t.purpose === 'tile' && t.level === 0)).toBe(true);
    expect(phone.detail.length).toBeLessThan(sources.tiles.get(0)!.length);
    // 0.55 device px per source px: the preview (0.47) is too soft, level 1 (0.5) is sharp enough.
    const mid = planArtImages(sources, 0.55, everything)!;
    expect(mid.detail.length).toBeGreaterThan(0);
    expect(mid.detail.every((t) => t.level === 1)).toBe(true);
  });

  it('without derived copies the published original is shown; a stale derived copy is never shown', () => {
    const bare: ManifestAsset = { ...master, derived: [] };
    const plan = planArtImages(artImageSources(bare, model.space), 2, everything)!;
    expect(plan.base.purpose).toBe('original');
    expect(plan.base.url).toBe(master.original!.url);
    expect(plan.detail).toEqual([]);
    const stale: ManifestAsset = {
      ...master,
      derived: master.derived.map((d) => ({ ...d, sourceSha256: '0'.repeat(64) })),
    };
    const s = artImageSources(stale, model.space);
    expect(s.previews).toEqual([]);
    expect(s.tiles.size).toBe(0);
    expect(s.full!.purpose).toBe('original');
  });

  it('nothing to show → null', () => {
    const none: ManifestAsset = { ...master, derived: [], original: null };
    expect(planArtImages(artImageSources(none, model.space), 1, everything)).toBeNull();
  });
});
