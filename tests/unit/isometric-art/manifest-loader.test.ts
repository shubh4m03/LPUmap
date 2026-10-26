// @vitest-environment node
/** The client manifest loader never throws; a missing/invalid manifest yields a reason (→ map-accurate fallback). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARTWORK_UNAVAILABLE_REASON,
  artworkUrl,
  loadIsometricArtManifest,
} from '../../../src/isometric-art/manifest-loader.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const body = JSON.parse(readFileSync(join(root, 'public/isometric-art/manifest.json'), 'utf8')) as unknown;
const res = (ok: boolean, status: number, json: () => Promise<unknown>) => async () => ({ ok, status, json });

describe('loadIsometricArtManifest', () => {
  it('loads and validates the committed manifest from <base>isometric-art/manifest.json', async () => {
    const urls: string[] = [];
    const r = await loadIsometricArtManifest(async (u) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => body };
    }, '/app/');
    expect(urls).toEqual(['/app/isometric-art/manifest.json']);
    expect(r.ok && r.manifest.assets.length).toBe(29);
  });

  it('returns a reason for HTTP errors, network errors and invalid bodies', async () => {
    for (const f of [
      res(false, 404, async () => ({})),
      async () => {
        throw new TypeError('offline');
      },
      res(true, 200, async () => ({ ...(body as object), disclaimer: 'Exact map' })),
      res(true, 200, async () => {
        throw new SyntaxError('bad json');
      }),
    ])
      expect(await loadIsometricArtManifest(f, '/')).toEqual({
        ok: false,
        reason: ARTWORK_UNAVAILABLE_REASON,
      });
  });

  it('resolves manifest-relative URLs under the app base', () => {
    expect(artworkUrl('original/1-lpu-isometric-map-design-3371.jpg', '/')).toBe(
      '/isometric-art/original/1-lpu-isometric-map-design-3371.jpg',
    );
  });
});
