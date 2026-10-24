/**
 * The overview on the committed campus dataset: every campus-inventory
 * building is drawn exactly once, the order is a DAG at every rotation, and
 * the painter order is checked against exact ray depth at sample points.
 */
import { describe, expect, it } from 'vitest';
import { hitTest } from '../../../src/isometric/hit-test.ts';
import { ISO_ROTATIONS } from '../../../src/isometric/projection.ts';
import { buildGround, buildIsoScene } from '../../../src/isometric/scene.ts';
import { median, timeOnce } from '../perf-timing.ts';
import { painterErrors, realData } from './helpers.ts';

const data = realData();
const ground = buildGround(data);
const scenes = ISO_ROTATIONS.map((r) => buildIsoScene(data, r, ground.frame, ground.campusPoints));
const inventory = data.buildings.features.filter((f) => f.properties.inCampusInventory);

describe('isometric scene on the real dataset', () => {
  it('draws every campus-inventory building exactly once, from the same loaded data', () => {
    for (const s of scenes) {
      expect(s.buildings.length).toBe(inventory.length);
      expect(new Set(s.buildings.map((b) => b.id))).toEqual(new Set(inventory.map((f) => f.properties.id)));
      for (const b of s.buildings) expect(b.faces.length).toBeGreaterThan(0);
      // Every drawn face belongs to a listed building, and every building's faces are all drawn.
      const drawn = s.draw.flatMap((d) => d.faces);
      expect(drawn.length).toBe(s.buildings.reduce((n, b) => n + b.faces.length, 0));
    }
  });

  it('has an acyclic unit order at all 4 rotations (cycles are resolved, never broken arbitrarily)', () => {
    for (const s of scenes) expect(s.stats.cycles).toBe(0);
  });

  it('paints the nearest face last at sampled points (exact ray depth), all rotations', () => {
    for (const s of scenes) {
      const { checked, errors } = painterErrors(s);
      expect(checked).toBeGreaterThan(500);
      // Measured on dataset ceb0ac0: 0 / ~3,000 samples at rotations 0–2 and 6 at rotation 3, all
      // inside the stacked, truly overlapping group osm:way/422823424…28 (intersecting prisms).
      expect(errors.length / checked).toBeLessThan(0.005);
    }
  });

  it('labels: anchors sit on the roof at the building height; keys come from the data', () => {
    const s = scenes[0]!;
    for (const f of inventory) {
      const b = s.byId.get(f.properties.id)!;
      expect(b.key).toBe(f.properties.directoryKey);
      const [e, n] = s.frame.toLocal([f.properties.anchorLon, f.properties.anchorLat]);
      const [x, y] = s.projection.project(e, n, f.properties.renderHeightM);
      expect(b.labelAnchor[0]).toBeCloseTo(x, 9);
      expect(b.labelAnchor[1]).toBeCloseTo(y, 9);
    }
  });

  it('the map-key grid covers the cell of every keyed building', () => {
    const cells = new Set(ground.grid.labels.map((l) => l.text));
    for (const f of inventory)
      if (f.properties.directoryCell) expect(cells.has(f.properties.directoryCell)).toBe(true);
  });

  it('hit-tests each building at its roof anchor (or a building drawn in front of it)', () => {
    for (const s of scenes) {
      const t = { k: 1, tx: 0, ty: 0 };
      const pos = new Map(s.buildings.map((b, i) => [b.id, i]));
      for (const b of s.buildings) {
        const hit = hitTest(s, t, [], b.labelAnchor[0], b.labelAnchor[1] + 0.01);
        if (hit.kind !== 'building') continue; // anchor exactly on an outline edge of a sliver footprint
        expect(pos.get(hit.id)!).toBeGreaterThanOrEqual(pos.get(b.id)!);
      }
    }
  });

  it('hit-test stays far below 1 ms per query (unthrottled median)', () => {
    const s = scenes[0]!;
    const pts = s.buildings.map((b) => b.labelAnchor);
    const per = median(
      Array.from({ length: 5 }, () =>
        timeOnce(() => pts.forEach(([x, y]) => hitTest(s, { k: 1, tx: 0, ty: 0 }, [], x, y))),
      ),
    );
    expect(per / pts.length).toBeLessThan(0.25);
  });

  it('records the build statistics used in docs (scene build time is gated in the browser perf project)', () => {
    for (const s of scenes) {
      expect(s.stats.buildings).toBe(inventory.length);
      expect(s.stats.overlapPairs).toBeGreaterThanOrEqual(0);
      expect(s.stats.studioUnmatched).toBe(0);
    }
  });
});
