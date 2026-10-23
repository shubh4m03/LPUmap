/**
 * Rasterises public/favicon.svg into the PNG icons referenced by the web app
 * manifest (src/offline/pwa-config.ts), using the Playwright Chromium that is
 * already installed for end-to-end tests.
 *
 *   node scripts/generate-icons.ts
 *
 * - icon-192/512: the SVG as drawn (rounded square, transparent corners).
 * - maskable-512 and apple-touch-icon-180: full-bleed background with the
 *   mark scaled into the maskable safe zone (a centred circle of 80% diameter),
 *   because launchers and iOS apply their own mask/rounding.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { APP_CONFIG } from '../src/config/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'public', 'favicon.svg');
const outDir = join(root, 'public', 'icons');

interface IconSpec {
  file: string;
  size: number;
  /** Share of the canvas the SVG occupies; < 1 adds padding on a solid background. */
  scale: number;
  fullBleed: boolean;
}

const ICONS: IconSpec[] = [
  { file: 'icon-192.png', size: 192, scale: 1, fullBleed: false },
  { file: 'icon-512.png', size: 512, scale: 1, fullBleed: false },
  // The pin spans ~70% of the SVG; at 0.7 it spans ~49% of the icon, inside the 80% safe circle.
  { file: 'maskable-512.png', size: 512, scale: 0.7, fullBleed: true },
  { file: 'apple-touch-icon-180.png', size: 180, scale: 0.82, fullBleed: true },
];

function pageHtml(svgDataUrl: string, spec: IconSpec): string {
  const background = spec.fullBleed ? APP_CONFIG.brand.backgroundColor : 'transparent';
  const inner = Math.round(spec.size * spec.scale);
  return `<!doctype html><html><head><style>
    html, body { margin: 0; padding: 0; background: ${background}; }
    .frame { width: ${spec.size}px; height: ${spec.size}px; display: grid; place-items: center; background: ${background}; }
    img { width: ${inner}px; height: ${inner}px; display: block; }
  </style></head><body><div class="frame"><img src="${svgDataUrl}" alt=""></div></body></html>`;
}

async function main(): Promise<void> {
  const svg = await readFile(svgPath, 'utf8');
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const spec of ICONS) {
      const page = await browser.newPage({
        viewport: { width: spec.size, height: spec.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(pageHtml(svgDataUrl, spec));
      await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
      const png = await page.locator('.frame').screenshot({ omitBackground: !spec.fullBleed, type: 'png' });
      await writeFile(join(outDir, spec.file), png);
      await page.close();
      console.log(`wrote public/icons/${spec.file} (${spec.size}×${spec.size}, ${png.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
