/**
 * Builds DERIVED review contact sheets of the owner-supplied isometric artwork
 * (lpu-isometric-map-design/) into docs/isometric-art/contact-sheets/, using
 * the Playwright Chromium canvas that is already installed for e2e tests.
 *
 *   node scripts/isometric-art-contact-sheets.ts          # regenerate sheets + manifest
 *   node scripts/isometric-art-contact-sheets.ts --check  # verify (no Chromium needed)
 *
 * Rules: originals are only read, never written. Every tile is the whole
 * original, scaled uniformly (no crop, no stretch, no recolour). Each sheet is
 * stamped "DERIVED" and the manifest records the sha256 of every source, so a
 * changed original makes --check (and the unit test) fail until regenerated.
 * Label text uses the system sans-serif font, so sheet bytes can differ between
 * machines; the check therefore compares the committed sheet with its manifest
 * entry and the sources with the inventory, not a fresh render.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ART_INVENTORY_PATH,
  ART_SOURCE_DIR,
  CONTACT_SHEET_DIR,
  CONTACT_SHEET_MANIFEST,
  sha256Hex,
  validateArtInventory,
  validateContactSheets,
  type ArtAsset,
  type ArtInventory,
  type ContactSheetManifest,
} from './lib/art-inventory-check.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface SheetSpec {
  file: string;
  title: string;
  ids: string[];
  columns: number;
  scale: number;
}

const SHEETS: SheetSpec[] = [
  {
    file: 'sheet-01-master-overview.png',
    title: 'Master isometric overview',
    ids: ['iso-art-001'],
    columns: 1,
    scale: 0.5,
  },
  {
    file: 'sheet-02-block-vignettes-other-captions.png',
    title: 'Block vignettes (captions other than hostel/apartment)',
    ids: [
      'iso-art-011',
      'iso-art-015',
      'iso-art-019',
      'iso-art-023',
      'iso-art-027',
      'iso-art-035',
      'iso-art-039',
      'iso-art-043',
      'iso-art-047',
      'iso-art-051',
      'iso-art-083',
      'iso-art-087',
    ],
    columns: 4,
    scale: 0.5,
  },
  {
    file: 'sheet-03-block-vignettes-hostel-apartment-captions.png',
    title: 'Block vignettes (captions naming hostels or apartments)',
    ids: [
      'iso-art-031',
      'iso-art-055',
      'iso-art-059',
      'iso-art-063',
      'iso-art-067',
      'iso-art-071',
      'iso-art-075',
      'iso-art-079',
    ],
    columns: 4,
    scale: 0.5,
  },
  {
    file: 'sheet-04-scene-vignettes.png',
    title: 'Scene vignettes',
    ids: [
      'iso-art-091',
      'iso-art-095',
      'iso-art-099',
      'iso-art-103',
      'iso-art-107',
      'iso-art-111',
      'iso-art-115',
      'iso-art-119',
    ],
    columns: 4,
    scale: 0.5,
  },
];

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as T;
}

async function readOriginals(): Promise<Map<string, Uint8Array>> {
  const dir = join(root, ART_SOURCE_DIR);
  const out = new Map<string, Uint8Array>();
  for (const f of (await readdir(dir)).sort()) out.set(f, await readFile(join(dir, f)));
  return out;
}

async function check(inventory: ArtInventory, originals: Map<string, Uint8Array>): Promise<string[]> {
  const problems = validateArtInventory(inventory, originals);
  const manifest = await readJson<ContactSheetManifest>(CONTACT_SHEET_MANIFEST);
  const sheets = new Map<string, Uint8Array>();
  for (const s of manifest.sheets) {
    try {
      sheets.set(s.file, await readFile(join(root, CONTACT_SHEET_DIR, s.file)));
    } catch {
      // reported as missing by validateContactSheets
    }
  }
  return [...problems, ...validateContactSheets(manifest, inventory, sheets)];
}

interface TileInput {
  dataUrl: string;
  caption: string;
  width: number;
  height: number;
}

async function render(): Promise<void> {
  const inventory = await readJson<ArtInventory>(ART_INVENTORY_PATH);
  const originals = await readOriginals();
  const before = validateArtInventory(inventory, originals);
  if (before.length) throw new Error(`inventory does not match the originals:\n${before.join('\n')}`);
  const byId = new Map<string, ArtAsset>(inventory.assets.map((a) => [a.id, a]));
  const covered = new Set(SHEETS.flatMap((s) => s.ids));
  const missing = inventory.assets.filter((a) => !covered.has(a.id)).map((a) => a.id);
  if (missing.length) throw new Error(`assets not assigned to a sheet: ${missing.join(', ')}`);

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const manifest: ContactSheetManifest & Record<string, unknown> = {
    $comment:
      'DERIVED review images of the owner-supplied artwork. Downscaled previews only; never a substitute for the originals in lpu-isometric-map-design/. Regenerate with: node scripts/isometric-art-contact-sheets.ts',
    derived: true,
    generator: 'scripts/isometric-art-contact-sheets.ts (Playwright Chromium canvas)',
    inventory: ART_INVENTORY_PATH,
    sheets: [],
  };
  try {
    const page = await browser.newPage();
    await mkdir(join(root, CONTACT_SHEET_DIR), { recursive: true });
    for (const spec of SHEETS) {
      const tiles: TileInput[] = spec.ids.map((id) => {
        const a = byId.get(id);
        if (!a) throw new Error(`unknown asset ${id}`);
        const bytes = originals.get(a.file);
        if (!bytes) throw new Error(`missing original ${a.file}`);
        const dup = a.canonical ? '' : `  (byte-identical to ${a.duplicates.join(', ')})`;
        return {
          dataUrl: `data:${a.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`,
          caption: `${a.id}  ${a.file}  ${a.width}x${a.height}  sha256 ${a.sha256.slice(0, 12)}${dup}`,
          width: a.width,
          height: a.height,
        };
      });
      const dataUrl = await page.evaluate(
        async ({ tiles, columns, scale, title }) => {
          const pad = 16;
          const captionH = 22;
          const headerH = 58;
          const tileW = Math.max(...tiles.map((t) => Math.round(t.width * scale)));
          const tileH = Math.max(...tiles.map((t) => Math.round(t.height * scale)));
          const rows = Math.ceil(tiles.length / columns);
          const canvas = document.createElement('canvas');
          canvas.width = pad + columns * (tileW + pad);
          canvas.height = headerH + rows * (tileH + captionH + pad) + pad;
          const g = canvas.getContext('2d');
          if (!g) throw new Error('no 2d context');
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, canvas.width, canvas.height);
          g.fillStyle = '#b00020';
          g.font = 'bold 18px Arial, sans-serif';
          g.fillText('DERIVED CONTACT SHEET - downscaled preview, not the original artwork', pad, 24);
          g.fillStyle = '#222222';
          g.font = '15px Arial, sans-serif';
          g.fillText(
            `${title}. Each tile is the whole original scaled uniformly by ${scale}; no crop, no recolour.`,
            pad,
            46,
          );
          for (let i = 0; i < tiles.length; i++) {
            const t = tiles[i];
            if (!t) continue;
            const img = new Image();
            img.src = t.dataUrl;
            await img.decode();
            const x = pad + (i % columns) * (tileW + pad);
            const y = headerH + Math.floor(i / columns) * (tileH + captionH + pad);
            const w = Math.round(t.width * scale);
            const h = Math.round(t.height * scale);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(img, x, y, w, h);
            g.strokeStyle = '#999999';
            g.lineWidth = 1;
            g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
            g.fillStyle = '#222222';
            g.font = '12px Arial, sans-serif';
            g.fillText(t.caption, x, y + h + 15, tileW);
          }
          return canvas.toDataURL('image/png');
        },
        { tiles, columns: spec.columns, scale: spec.scale, title: spec.title },
      );
      const png = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
      await writeFile(join(root, CONTACT_SHEET_DIR, spec.file), png);
      manifest.sheets.push({
        file: spec.file,
        sha256: sha256Hex(png),
        bytes: png.length,
        sources: spec.ids.map((id) => {
          const a = byId.get(id) as ArtAsset;
          return { id, file: a.file, sha256: a.sha256 };
        }),
      });
      console.log(`wrote ${CONTACT_SHEET_DIR}/${spec.file} (${png.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(root, CONTACT_SHEET_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  // Originals must be untouched by a render.
  const after = await readOriginals();
  for (const [f, bytes] of originals) {
    const now = after.get(f);
    if (!now || sha256Hex(now) !== sha256Hex(bytes))
      throw new Error(`original ${f} changed during rendering`);
  }
  console.log(`wrote ${CONTACT_SHEET_MANIFEST}`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const problems = await check(await readJson<ArtInventory>(ART_INVENTORY_PATH), await readOriginals());
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exitCode = 1;
      return;
    }
    console.log('isometric art inventory and contact sheets: OK');
    return;
  }
  await render();
}

await main();
