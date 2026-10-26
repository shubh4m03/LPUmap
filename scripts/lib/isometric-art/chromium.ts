/**
 * Chromium-canvas work of the isometric-art pipeline (dev only; never needed
 * by a production build or by `npm run art:check`): making derived web copies
 * and measuring their visual equivalence with the original.
 *
 * Everything runs in the installed Playwright Chromium (no new dependency).
 * Decoding goes through <img> + drawImage, i.e. Chromium's colour-managed
 * path: the CMYK master (embedded U.S. Web Coated SWOP v2 profile) is
 * converted to the canvas's sRGB exactly as the browser displays it.
 *
 * Rules enforced here (docs/LPU_ISOMETRIC_ASSET_INTEGRATION.md §0, §2):
 *   - every output is the WHOLE original scaled uniformly to the size that
 *     `expectedDerived` names (tiles are an exact partition of one such
 *     scaled level), so normalized hotspot coordinates stay valid;
 *   - no recolouring beyond the colour-managed conversion to sRGB;
 *   - the canvas is software-rendered (`--disable-gpu`, willReadFrequently),
 *     which makes a rerun on the same machine byte-identical.
 *
 * The functions passed to page.evaluate are self-contained (they are
 * serialized into the page), so they repeat a few small helpers.
 */
import type { Browser, Page } from '@playwright/test';
import { COMPARE_WIDTH } from './integrity.ts';

export interface ImageSource {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

/** One output to render: the source drawn at `levelWidth`×`levelHeight`, cropped to (x, y, width, height). */
export interface RenderJob {
  url: string;
  levelWidth: number;
  levelHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mime: 'image/jpeg' | 'image/webp' | 'image/png';
  quality: number;
}

export interface RenderedFile {
  url: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Pixel comparison of two RGB(A) images of the same size (alpha compared as a fourth channel). */
export interface PixelMetrics {
  width: number;
  height: number;
  /** Mean absolute difference per channel, 0–255. */
  meanAbs: number;
  /** Largest absolute difference of any channel of any pixel, 0–255. */
  maxAbs: number;
  /** Peak signal-to-noise ratio in dB over the colour channels (99 when identical). */
  psnr: number;
  /** Fraction of pixels whose largest channel difference exceeds 16. */
  fracOver16: number;
}

/** A group of derived files that together form one image (a single file, or every tile of one level). */
export interface EquivalenceGroup {
  label: string;
  width: number;
  height: number;
  parts: { bytes: Uint8Array; mime: string; x: number; y: number }[];
}

export interface EquivalenceResult {
  label: string;
  /** The group composed at its own size vs the original drawn at that size. */
  native: PixelMetrics;
  /** The group and the full-size original, both downscaled in Chromium to COMPARE_WIDTH px wide. */
  downscaled: PixelMetrics;
}

export async function launchArtChromium(): Promise<{ browser: Browser; page: Page; version: string }> {
  const { chromium } = await import('@playwright/test');
  // Software raster only: GPU canvases are not reproducible across runs or machines.
  const browser = await chromium.launch({ args: ['--disable-gpu', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><title>art</title>');
  return { browser, page, version: browser.version() };
}

const toB64 = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** Renders every job from one source. Output order = job order. */
export async function renderDerived(
  page: Page,
  source: ImageSource,
  jobs: readonly RenderJob[],
): Promise<RenderedFile[]> {
  const out = await page.evaluate(
    async ({ src, mime, w, h, jobs: list }) => {
      const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const blobToB64 = async (b: Blob) => {
        const buf = new Uint8Array(await b.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      };
      const opaque = mime === 'image/jpeg';
      const canvas = (cw: number, ch: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d', { willReadFrequently: true, alpha: !opaque, colorSpace: 'srgb' });
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        return { c, ctx };
      };
      const url = URL.createObjectURL(new Blob([b64ToBytes(src)], { type: mime }));
      const img = new Image();
      img.src = url;
      await img.decode();
      if (img.naturalWidth !== w || img.naturalHeight !== h)
        throw new Error(`decoded ${img.naturalWidth}x${img.naturalHeight}, expected ${w}x${h}`);
      // Decoded once (colour-managed to sRGB) into a canvas at the source's own size.
      const { c: full, ctx: fullCtx } = canvas(w, h);
      fullCtx.drawImage(img, 0, 0);
      // One scaled copy of the WHOLE source per level size (uniform scale; never a crop of the source).
      const levels = new Map<string, HTMLCanvasElement>([[`${w}x${h}`, full]]);
      const level = (lw: number, lh: number) => {
        const key = `${lw}x${lh}`;
        let l = levels.get(key);
        if (!l) {
          const { c, ctx } = canvas(lw, lh);
          ctx.drawImage(full, 0, 0, w, h, 0, 0, lw, lh);
          levels.set(key, c);
          l = c;
        }
        return l;
      };
      const results: { url: string; b64: string; width: number; height: number }[] = [];
      for (const j of list) {
        const lv = level(j.levelWidth, j.levelHeight);
        const { c, ctx } = canvas(j.width, j.height);
        // Exact pixel copy of the tile rectangle (no scaling at this step).
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(lv, j.x, j.y, j.width, j.height, 0, 0, j.width, j.height);
        const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, j.mime, j.quality));
        if (!blob || blob.type !== j.mime) throw new Error(`${j.url}: encoder produced ${blob?.type}`);
        results.push({ url: j.url, b64: await blobToB64(blob), width: c.width, height: c.height });
      }
      URL.revokeObjectURL(url);
      return results;
    },
    { src: toB64(source.bytes), mime: source.mime, w: source.width, h: source.height, jobs: [...jobs] },
  );
  return out.map((r) => ({ url: r.url, bytes: fromB64(r.b64), width: r.width, height: r.height }));
}

/**
 * Perturbations used as negative controls: each must FAIL the thresholds, so a
 * passing derived copy is known to be within a tolerance that does catch these.
 */
export const NEGATIVE_CONTROLS = ['shift-2px', 'recolour-swap-rb', 'crop-2pct-stretched'] as const;
export type NegativeControl = (typeof NEGATIVE_CONTROLS)[number];

/**
 * Compares each group against the source, in Chromium. With `controls`, also
 * measures the given perturbations of the source (encoded like `controlMime`
 * at `controlQuality`) against the source at full size.
 */
export async function measureEquivalence(
  page: Page,
  source: ImageSource,
  groups: readonly EquivalenceGroup[],
  controls: { kinds: readonly NegativeControl[]; mime: string; quality: number } | null = null,
): Promise<{ results: EquivalenceResult[]; controls: EquivalenceResult[] }> {
  return page.evaluate(
    async ({ src, mime, w, h, groups: list, compareWidth, ctl }) => {
      const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const canvas = (cw: number, ch: number) => {
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        return { c, ctx };
      };
      const decode = async (bytes: Uint8Array<ArrayBuffer>, type: string) => {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        const img = new Image();
        img.src = url;
        await img.decode();
        URL.revokeObjectURL(url);
        return img;
      };
      const metrics = (a: ImageData, b: ImageData) => {
        if (a.width !== b.width || a.height !== b.height) throw new Error('size mismatch');
        const n = a.width * a.height;
        let sumAbs = 0;
        let sumSq = 0;
        let maxAbs = 0;
        let over = 0;
        for (let i = 0; i < n; i++) {
          let px = 0;
          for (let ch = 0; ch < 4; ch++) {
            const d = Math.abs(a.data[i * 4 + ch]! - b.data[i * 4 + ch]!);
            sumAbs += d;
            if (ch < 3) sumSq += d * d;
            if (d > px) px = d;
          }
          if (px > maxAbs) maxAbs = px;
          if (px > 16) over++;
        }
        const mse = sumSq / (n * 3);
        const r4 = (x: number) => Math.round(x * 10000) / 10000;
        return {
          width: a.width,
          height: a.height,
          meanAbs: r4(sumAbs / (n * 4)),
          maxAbs,
          psnr: mse === 0 ? 99 : r4(10 * Math.log10((255 * 255) / mse)),
          fracOver16: r4(over / n),
        };
      };
      // The original, decoded once into an sRGB canvas at its own size; every comparison
      // resamples from canvases on both sides, so only content differences are measured.
      const { c: original, ctx: originalCtx } = canvas(w, h);
      originalCtx.drawImage(await decode(b64ToBytes(src), mime), 0, 0);
      const ch = Math.round((h * compareWidth) / w);
      const pixels = (from: CanvasImageSource, fw: number, fh: number, tw: number, th: number) => {
        const { ctx } = canvas(tw, th);
        ctx.drawImage(from, 0, 0, fw, fh, 0, 0, tw, th);
        return ctx.getImageData(0, 0, tw, th);
      };
      const compare = (label: string, composed: HTMLCanvasElement) => {
        const gw = composed.width;
        const gh = composed.height;
        return {
          label,
          native: metrics(pixels(composed, gw, gh, gw, gh), pixels(original, w, h, gw, gh)),
          downscaled: metrics(
            pixels(composed, gw, gh, compareWidth, ch),
            pixels(original, w, h, compareWidth, ch),
          ),
        };
      };
      const results = [];
      for (const g of list) {
        const { c, ctx } = canvas(g.width, g.height);
        ctx.imageSmoothingEnabled = false;
        for (const p of g.parts) ctx.drawImage(await decode(b64ToBytes(p.b64), p.mime), p.x, p.y);
        results.push(compare(g.label, c));
      }
      const controls = [];
      if (ctl) {
        for (const kind of ctl.kinds) {
          const { c, ctx } = canvas(w, h);
          if (kind === 'shift-2px') {
            ctx.drawImage(original, 2, 2);
          } else if (kind === 'crop-2pct-stretched') {
            ctx.drawImage(original, w * 0.01, h * 0.01, w * 0.98, h * 0.98, 0, 0, w, h);
          } else {
            ctx.drawImage(original, 0, 0);
            const d = ctx.getImageData(0, 0, w, h);
            for (let i = 0; i < d.data.length; i += 4) {
              const r = d.data[i]!;
              d.data[i] = d.data[i + 2]!;
              d.data[i + 2] = r;
            }
            ctx.putImageData(d, 0, 0);
          }
          const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, ctl.mime, ctl.quality));
          if (!blob) throw new Error('control encode failed');
          const { c: back, ctx: bctx } = canvas(w, h);
          bctx.drawImage(await decode(new Uint8Array(await blob.arrayBuffer()), ctl.mime), 0, 0);
          controls.push(compare(`control:${kind}`, back));
        }
      }
      return { results, controls };
    },
    {
      src: toB64(source.bytes),
      mime: source.mime,
      w: source.width,
      h: source.height,
      groups: groups.map((g) => ({
        label: g.label,
        width: g.width,
        height: g.height,
        parts: g.parts.map((p) => ({ b64: toB64(p.bytes), mime: p.mime, x: p.x, y: p.y })),
      })),
      compareWidth: COMPARE_WIDTH,
      ctl: controls ? { kinds: [...controls.kinds], mime: controls.mime, quality: controls.quality } : null,
    },
  );
}
