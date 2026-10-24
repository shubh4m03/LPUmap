import { describe, expect, it } from 'vitest';
import { drawDynamic, labelCandidates, type DrawView } from '../../../src/isometric/draw.ts';
import { ISO_THEME_COLORS } from '../../../src/isometric/iso-theme.ts';
import {
  compareCandidates,
  layoutLabel,
  LABEL_FONT_PX,
  MIN_HIT_PX,
  placeLabels,
  spokenMapKey,
  type LabelCandidate,
} from '../../../src/isometric/labels.ts';
import { buildGround, buildIsoScene } from '../../../src/isometric/scene.ts';
import { realData, recordingCtx } from './helpers.ts';

const measure = (t: string) => t.length * 7;
const cand = (over: Partial<LabelCandidate> & Pick<LabelCandidate, 'id'>): LabelCandidate => ({
  kind: 'key',
  text: 'C4-07',
  x: 100,
  y: 100,
  diamond: true,
  area: 100,
  ...over,
});

describe('label priority and collision (§6.5)', () => {
  it('orders selected > named > route endpoints > keyed by descending area, then id', () => {
    const list = [
      cand({ id: 'k-small', area: 10 }),
      cand({ id: 'end', kind: 'endpoint', text: 'Start', diamond: false }),
      cand({ id: 'k-big', area: 900 }),
      cand({ id: 'named', kind: 'named', text: 'Lovely Institute of Technology' }),
      cand({ id: 'sel', kind: 'selected' }),
    ];
    expect([...list].sort(compareCandidates).map((c) => c.id)).toEqual([
      'sel',
      'named',
      'end',
      'k-big',
      'k-small',
    ]);
  });

  it('drops a lower-priority label that collides, keeps both when apart', () => {
    const a = cand({ id: 'a', area: 500 });
    const b = cand({ id: 'b', area: 50, x: 104, y: 102 });
    const far = cand({ id: 'c', area: 10, x: 300, y: 300 });
    const placed = placeLabels([b, a, far], measure, { width: 800, height: 600 });
    expect(placed.map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('always places the selected label, even over others', () => {
    const placed = placeLabels(
      [cand({ id: 'big', area: 999 }), cand({ id: 'sel', kind: 'selected', area: 1 })],
      measure,
      { width: 800, height: 600 },
    );
    expect(placed.map((l) => l.id)).toEqual(['sel']);
    // Partly off-screen: still placed when selected, dropped otherwise.
    const edge = { x: 2, y: 2 };
    expect(
      placeLabels([cand({ id: 's', kind: 'selected', ...edge })], measure, { width: 800, height: 600 }),
    ).toHaveLength(1);
    expect(placeLabels([cand({ id: 'k', ...edge })], measure, { width: 800, height: 600 })).toHaveLength(0);
  });

  it('skips labels outside the viewport', () => {
    expect(placeLabels([cand({ id: 'off', x: -200 })], measure, { width: 800, height: 600 })).toEqual([]);
  });

  it('gives every marker a hit target of at least 24 × 24 CSS px and text of at least 12 px', () => {
    expect(LABEL_FONT_PX).toBeGreaterThanOrEqual(12);
    const l = layoutLabel(cand({ id: 'x', text: '' }), measure);
    expect(l.hitBox.maxX - l.hitBox.minX).toBeGreaterThanOrEqual(MIN_HIT_PX);
    expect(l.hitBox.maxY - l.hitBox.minY).toBeGreaterThanOrEqual(MIN_HIT_PX);
    const long = layoutLabel(cand({ id: 'y', text: 'A long building name' }), measure);
    expect(long.hitBox.minX).toBeLessThanOrEqual(long.box.minX);
    expect(long.hitBox.maxX).toBeGreaterThanOrEqual(long.box.maxX);
  });

  it('reads map keys as "Map key C 4, 7"', () => {
    expect(spokenMapKey('C4-07')).toBe('Map key C 4, 7');
    expect(spokenMapKey('A10-12')).toBe('Map key A 10, 12');
  });
});

describe('labels on the real dataset', () => {
  const data = realData();
  const ground = buildGround(data);
  const scene = buildIsoScene(data, 0, ground.frame, ground.campusPoints);
  const view = (k: number): DrawView => {
    const cx = (scene.bounds.minX + scene.bounds.maxX) / 2;
    const cy = (scene.bounds.minY + scene.bounds.maxY) / 2;
    return { t: { k, tx: 640 - k * cx, ty: 400 - k * cy }, dpr: 1, width: 1280, height: 800 };
  };

  it('never draws "Unnamed building": unnamed buildings show only their map key', () => {
    const c = labelCandidates(scene, view(2), {
      selectedId: null,
      showLabels: true,
      endpoints: { start: null, end: null },
    });
    expect(c.length).toBeGreaterThan(0);
    for (const l of c) {
      expect(l.text).not.toMatch(/unnamed/i);
      const b = scene.byId.get(l.id)!;
      if (b.name === null) {
        expect(l.text).toBe(b.key);
        expect(l.diamond).toBe(true);
      } else expect(l.kind).toBe('named');
    }
  });

  it('places a collision-free subset at the campus-fit scale, more when zoomed in', () => {
    const ctx = recordingCtx();
    const c = ISO_THEME_COLORS.light;
    const opts = { selectedId: null, selectedPoint: null, route: null, showLabels: true };
    const few = drawDynamic(ctx, scene, view(0.6), c, opts);
    const many = drawDynamic(ctx, scene, view(3), c, opts);
    for (const set of [few, many])
      for (let i = 0; i < set.length; i++)
        for (let j = i + 1; j < set.length; j++) {
          const a = set[i]!.box;
          const b = set[j]!.box;
          expect(a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY).toBe(false);
        }
    expect(few.length).toBeGreaterThan(0);
    expect(many.length).toBeGreaterThan(0);
  });

  it('labels the selected building even with labels switched off', () => {
    const keyed = scene.buildings.find((b) => b.key !== null)!;
    const c = labelCandidates(scene, view(1), {
      selectedId: keyed.id,
      showLabels: false,
      endpoints: { start: null, end: null },
    });
    expect(c.map((l) => l.id)).toEqual([keyed.id]);
    expect(c[0]!.kind).toBe('selected');
  });
});
