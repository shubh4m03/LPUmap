// @vitest-environment node
/**
 * Gate 1 / Gate 5 on a REAL production build: point ART_DIST_DIR at the
 * output of `vite build` (CI and `npm run build` run the same check as
 * `npm run art:check-dist`). Opt-in because `npm test` runs before any build
 * exists; a stale local dist/ must not fail an unrelated test run.
 *
 *   ART_DIST_DIR=dist npx vitest run tests/integration/isometric-art-dist.test.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../scripts/lib/art-inventory-check.ts';
import { ART_MANIFEST_PATH } from '../../scripts/lib/art-registry-check.ts';
import { checkDist } from '../../scripts/lib/isometric-art/integrity.ts';
import { isometricArtManifestSchema } from '../../src/isometric-art/schema.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const distDir = process.env.ART_DIST_DIR ? resolve(root, process.env.ART_DIST_DIR) : null;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

describe.skipIf(!distDir)('production build contains the artwork', () => {
  it('every published file is in the build byte-identical; precache is light; the view is bundled', () => {
    const dir = distDir!;
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
    const manifestBytes = new Uint8Array(readFileSync(join(root, ART_MANIFEST_PATH)));
    const manifest = isometricArtManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
    const problems = checkDist(manifest, manifestBytes, {
      read: (p) => (existsSync(join(dir, p)) ? new Uint8Array(readFileSync(join(dir, p))) : null),
      list: () => listFiles(dir).map((f) => relative(dir, f).split('\\').join('/')),
      sha256: sha256Hex,
    });
    expect(problems).toEqual([]);
  });
});
