// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_INVENTORY_PATH, type ArtInventory } from '../../../scripts/lib/art-inventory-check.ts';
import {
  ART_HOTSPOTS_PATH,
  isSimplePolygon,
  pointInPolygon,
  polygonsOverlap,
  validateArtHotspots,
  type ArtHotspot,
  type ArtHotspots,
} from '../../../scripts/lib/art-hotspots-check.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const doc = JSON.parse(readFileSync(join(root, ART_HOTSPOTS_PATH), 'utf8')) as ArtHotspots;
const inventory = JSON.parse(readFileSync(join(root, ART_INVENTORY_PATH), 'utf8')) as ArtInventory;
const master = new Uint8Array(readFileSync(join(root, doc.source.path)));
const clone = (): ArtHotspots => structuredClone(doc);
const byId = (d: ArtHotspots, id: string): ArtHotspot => {
  const h = d.hotspots.find((x) => x.hotspotId === id);
  if (!h) throw new Error(`no ${id}`);
  return h;
};
const W = doc.source.sourceWidth;
const H = doc.source.sourceHeight;

describe('master overview hotspots', () => {
  it('passes every integrity check against the inventory and the original master bytes', () => {
    expect(validateArtHotspots(doc, inventory, master)).toEqual([]);
  });

  it('records the master in normalized source coordinates with its size and sha256', () => {
    expect(doc.source).toMatchObject({ assetId: 'iso-art-001', sourceWidth: 3371, sourceHeight: 2384 });
    expect(doc.source.sha256).toBe('41997f42cea0f99e62c5b6b23406afdb3cd8e4bcb4635fa1c264c91127044a25');
    for (const h of doc.hotspots)
      for (const [x, y] of h.polygon) expect(x >= 0 && x <= 1 && y >= 0 && y <= 1).toBe(true);
  });

  it('has one pin-structure hotspot per printed overview pin, labelled exactly as printed', () => {
    const pins = doc.hotspots.filter((h) => h.kind === 'pin-structure');
    expect(pins).toHaveLength(45);
    const labels = pins.map((h) => h.artworkLabel?.text).sort((a, b) => Number(a) - Number(b));
    expect(labels).toEqual(
      ['1', '2', '3', '4', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '18', '20', '21']
        .concat(['25', '26', '27', '28', '29', '30', '32', '33', '34', '35', '36', '37', '38'])
        .concat(['41', '42', '43', '44', '45', '47', '48', '49', '50', '51', '53', '54', '56', '57', '58']),
    );
    // Numbers that appear only in vignettes or the index are never invented as overview pins.
    for (const absent of ['5', '16', '19', '22', '23', '31', '52', '55'])
      expect(pins.some((h) => h.artworkLabel?.text === absent)).toBe(false);
    expect(doc.overviewIndexNumbersWithoutOverviewPin).toEqual(['19', '31', '21A', '21B', '52']);
  });

  it('places each printed disc inside or next to its outline', () => {
    for (const h of doc.hotspots.filter((x) => x.kind === 'pin-structure')) {
      const pin = h.pin;
      if (!pin) throw new Error(h.hotspotId);
      const poly = h.polygon.map(([x, y]) => [x * W, y * H] as [number, number]);
      const centre: [number, number] = [pin.x * W, pin.y * H];
      const near = poly.some(([x, y]) => Math.hypot(x - centre[0], y - centre[1]) < 60);
      expect(pointInPolygon(centre, poly) || near, h.hotspotId).toBe(true);
    }
  });

  it('keeps unlabelled scenes and unassigned parts free of invented names and flags them for review', () => {
    const others = doc.hotspots.filter((h) => h.kind !== 'pin-structure' && h.kind !== 'printed-text');
    expect(others.length).toBeGreaterThan(0);
    for (const h of others) {
      expect(h.artworkLabel).toBeNull();
      expect(h.reviewStatus).toBe('needs-manual-verification');
    }
    expect(byId(doc, 'hs-text-lpu-letters').artworkLabel?.text).toBe('LPU');
    expect(byId(doc, 'hs-scene-pavilion').vignettePinNumbers).toEqual(['16']);
  });

  it('keeps index/vignette conflicts side by side instead of resolving them', () => {
    const p37 = byId(doc, 'hs-pin-37');
    expect(p37.links.indexRows.map((r) => r.labelAsPrinted)).toEqual(['RESEARCH']);
    expect(p37.links.vignettes.map((v) => v.assetId)).toContain('iso-art-087');
    expect(byId(doc, 'hs-pin-58').links.indexRows.map((r) => r.labelAsPrinted)).toEqual(['', 'PROJECT LAB']);
    expect(byId(doc, 'hs-pin-14').links.indexRows).toEqual([]);
  });

  it('detects a self-intersecting polygon', () => {
    const bad = clone();
    const poly = byId(bad, 'hs-pin-47').polygon;
    const [a, b] = [poly[0], poly[1]];
    if (!a || !b) throw new Error('short polygon');
    poly[0] = b;
    poly[1] = a;
    expect(validateArtHotspots(bad, inventory, master).join('\n')).toMatch(
      /hs-pin-47: polygon is not simple/,
    );
  });

  it('detects a coordinate outside the image', () => {
    const bad = clone();
    byId(bad, 'hs-pin-1').polygon[0] = [1.2, 0.5];
    expect(validateArtHotspots(bad, inventory, master).join('\n')).toMatch(/hs-pin-1: coordinate outside/);
  });

  it('detects overlapping hit areas', () => {
    const bad = clone();
    byId(bad, 'hs-pin-41').polygon = structuredClone(byId(bad, 'hs-pin-42').polygon);
    expect(validateArtHotspots(bad, inventory, master).join('\n')).toMatch(/hs-pin-41 overlaps hs-pin-42/);
  });

  it('detects a missing pin hotspot and an unlinked index row', () => {
    const bad = clone();
    bad.hotspots = bad.hotspots.filter((h) => h.hotspotId !== 'hs-pin-13');
    const text = validateArtHotspots(bad, inventory, master).join('\n');
    expect(text).toMatch(/overview pin 13: 0 pin-structure hotspots/);
    expect(text).toMatch(/number 13: no hotspot links it/);
  });

  it('detects a changed master image', () => {
    const tampered = new Uint8Array(master);
    tampered[tampered.length - 10] = (tampered[tampered.length - 10] ?? 0) ^ 0xff;
    expect(validateArtHotspots(doc, inventory, tampered).join('\n')).toMatch(
      /does not match the master image/,
    );
  });

  it('detects an invented label on an unlabelled scene', () => {
    const bad = clone();
    byId(bad, 'hs-scene-oval-ground').artworkLabel = { text: '52', source: 'overview-pin', exact: true };
    expect(validateArtHotspots(bad, inventory, master).join('\n')).toMatch(/must not carry an artwork label/);
  });

  it('geometry helpers handle simple, crossing and nested shapes', () => {
    const sq: [number, number][] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    expect(isSimplePolygon(sq)).toBe(true);
    expect(
      isSimplePolygon([
        [0, 0],
        [2, 2],
        [2, 0],
        [0, 2],
      ]),
    ).toBe(false);
    const inner: [number, number][] = [
      [0.5, 0.5],
      [1, 0.5],
      [1, 1],
    ];
    expect(polygonsOverlap(sq, inner)).toBe(true);
    const far: [number, number][] = [
      [3, 3],
      [4, 3],
      [4, 4],
    ];
    expect(polygonsOverlap(sq, far)).toBe(false);
  });
});
