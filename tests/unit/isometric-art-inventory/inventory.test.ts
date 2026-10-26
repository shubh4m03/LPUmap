// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ART_INVENTORY_PATH,
  ART_SOURCE_DIR,
  CONTACT_SHEET_DIR,
  CONTACT_SHEET_MANIFEST,
  imageSize,
  validateArtInventory,
  validateContactSheets,
  type ArtInventory,
  type ContactSheetManifest,
} from '../../../scripts/lib/art-inventory-check.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const inventory = JSON.parse(readFileSync(join(root, ART_INVENTORY_PATH), 'utf8')) as ArtInventory;
const manifest = JSON.parse(readFileSync(join(root, CONTACT_SHEET_MANIFEST), 'utf8')) as ContactSheetManifest;
const originals = new Map<string, Uint8Array>(
  readdirSync(join(root, ART_SOURCE_DIR)).map((f) => [f, readFileSync(join(root, ART_SOURCE_DIR, f))]),
);
const sheets = new Map<string, Uint8Array>(
  manifest.sheets.map((s) => [s.file, readFileSync(join(root, CONTACT_SHEET_DIR, s.file))]),
);
const clone = (): ArtInventory => structuredClone(inventory);
const asset = (inv: ArtInventory, id: string) => {
  const a = inv.assets.find((x) => x.id === id);
  if (!a) throw new Error(`no ${id}`);
  return a;
};

describe('isometric artwork inventory', () => {
  it('lists every original with matching sha256, size and dimensions', () => {
    expect(originals.size).toBe(29);
    expect(validateArtInventory(inventory, originals)).toEqual([]);
  });

  it('records the master overview and the one duplicate pair', () => {
    const master = asset(inventory, 'iso-art-001');
    expect(master.role).toBe('master-overview');
    expect([master.width, master.height]).toEqual([3371, 2384]);
    expect(asset(inventory, 'iso-art-111').duplicates).toEqual(['iso-art-115']);
    expect(asset(inventory, 'iso-art-115').canonical).toBe(false);
    expect(inventory.assets.filter((a) => a.duplicates.length > 0)).toHaveLength(2);
  });

  it('keeps the 45 verified overview pins in normalized source coordinates', () => {
    const master = asset(inventory, 'iso-art-001');
    expect(master.pins).toHaveLength(45);
    expect(new Set(master.pins.map((p) => p.label)).size).toBe(45);
    const labels = new Set(master.pins.map((p) => p.label));
    for (const absent of ['5', '16', '19', '22', '23', '31', '52', '55'])
      expect(labels.has(absent)).toBe(false);
  });

  it('keeps conflicting sources side by side instead of resolving them', () => {
    const master = asset(inventory, 'iso-art-001') as unknown as {
      informationIndex: { sections: { rows: { labelAsPrinted: string; artworkNumbers: string[] }[] }[] };
    };
    const rows = master.informationIndex.sections.flatMap((s) => s.rows);
    expect(rows.find((r) => r.artworkNumbers.includes('37'))?.labelAsPrinted).toBe('RESEARCH');
    const vignette = asset(inventory, 'iso-art-087');
    expect(vignette.captionMapping?.find((m) => m.numbers.includes('37'))?.caption).toBe('CENTRAL LIBRARY');
  });

  it('detects a changed original', () => {
    const tampered = new Map(originals);
    const bytes = new Uint8Array(tampered.get('11-lpu-isometric-map-design-961.png') ?? []);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 0xff;
    tampered.set('11-lpu-isometric-map-design-961.png', bytes);
    expect(validateArtInventory(inventory, tampered).join('\n')).toMatch(/iso-art-011: sha256 mismatch/);
  });

  it('detects a missing or unlisted original', () => {
    const fewer = new Map(originals);
    fewer.delete('1-lpu-isometric-map-design-3371.jpg');
    expect(validateArtInventory(inventory, fewer).join('\n')).toMatch(/not in lpu-isometric-map-design/);
    const more = new Map(originals).set('200-extra.png', new Uint8Array([1, 2, 3]));
    expect(validateArtInventory(inventory, more).join('\n')).toMatch(
      /200-extra.png is missing from the inventory/,
    );
  });

  it('rejects a silently corrected label', () => {
    const inv = clone();
    const label = asset(inv, 'iso-art-083').labels.find((l) => l.text.includes('MECHANICAL'));
    if (!label) throw new Error('label');
    label.lines = label.lines.map((l) => l.replace('INGNEERING', 'ENGINEERING'));
    label.text = label.lines.join(' ');
    const caption = asset(inv, 'iso-art-083').captionMapping?.[0];
    if (caption?.caption) caption.caption = caption.caption.replace('INGNEERING', 'ENGINEERING');
    expect(validateArtInventory(inv, originals).join('\n')).toMatch(/SCHOOL OF MECHANICAL INGNEERING/);
  });

  it('rejects pins whose normalized coordinates drift from the pixels', () => {
    const inv = clone();
    const pin = asset(inv, 'iso-art-087').pins[0];
    if (!pin) throw new Error('pin');
    pin.nx += 0.01;
    expect(validateArtInventory(inv, originals).join('\n')).toMatch(/normalized coordinates do not match/);
  });

  it('never treats an artwork number as an official block number', () => {
    const inv = clone();
    const n = inv.artworkNumbers[0];
    if (!n) throw new Error('number');
    n.isOfficialBlockNumber = true;
    expect(validateArtInventory(inv, originals).join('\n')).toMatch(/marked as an official block number/);
    const inv2 = clone() as ArtInventory & { assets: Record<string, unknown>[] };
    (inv2.assets[1] as Record<string, unknown>).officialBlockNumber = '1';
    expect(validateArtInventory(inv2, originals).join('\n')).toMatch(/must not carry "officialBlockNumber"/);
  });

  it('requires every uncertain label to be flagged for manual review', () => {
    const inv = clone();
    inv.needsManualVerification = inv.needsManualVerification.filter((n) => n.ref !== 'iso-art-111/L2');
    expect(validateArtInventory(inv, originals).join('\n')).toMatch(/iso-art-111\/L2: not high confidence/);
  });

  it('reads PNG and JPEG dimensions from headers', () => {
    expect(imageSize(originals.get('1-lpu-isometric-map-design-3371.jpg') ?? new Uint8Array())).toEqual({
      width: 3371,
      height: 2384,
    });
    expect(imageSize(originals.get('119-lpu-isometric-map-design-961.png') ?? new Uint8Array())).toEqual({
      width: 961,
      height: 541,
    });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('derived contact sheets', () => {
  it('are committed, match their manifest and cover every original', () => {
    expect(validateContactSheets(manifest, inventory, sheets)).toEqual([]);
  });

  it('go stale when a source original changes', () => {
    const inv = clone();
    asset(inv, 'iso-art-087').sha256 = '0'.repeat(64);
    expect(validateContactSheets(manifest, inv, sheets).join('\n')).toMatch(/source iso-art-087 changed/);
  });

  it('detect a hand-edited or missing sheet', () => {
    const edited = new Map(sheets);
    const first = manifest.sheets[0];
    if (!first) throw new Error('sheet');
    edited.set(first.file, new Uint8Array([0]));
    expect(validateContactSheets(manifest, inventory, edited).join('\n')).toMatch(
      /sha256 differs from manifest/,
    );
    edited.delete(first.file);
    expect(validateContactSheets(manifest, inventory, edited).join('\n')).toMatch(/is missing/);
  });
});
