// @vitest-environment node
/**
 * Gate 1 / Gate 5: every artwork file a fresh checkout and the production
 * build need is COMMITTABLE as-is — not git-ignored, and stored byte-for-byte
 * (no end-of-line or other filter would change it on add or checkout).
 * Uses the git CLI on the working tree; skipped only when this is not a git
 * checkout (e.g. a source tarball).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_HOTSPOTS_PATH } from '../../scripts/lib/art-hotspots-check.ts';
import { ART_INVENTORY_PATH, ART_SOURCE_DIR } from '../../scripts/lib/art-inventory-check.ts';
import {
  ART_MAPPING_DOC_PATH,
  ART_PUBLIC_DIR,
  ART_REGISTRY_PATH,
} from '../../scripts/lib/art-registry-check.ts';
import { EQUIVALENCE_REPORT_PATH } from '../../scripts/lib/isometric-art/integrity.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (args: string[], input?: string) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
const isRepo = (() => {
  try {
    return git(['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
})();

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** Every path the artwork needs in a fresh checkout (originals, curated inputs, generated outputs). */
const required = [
  ...listFiles(join(root, ART_SOURCE_DIR)),
  ...listFiles(join(root, ART_PUBLIC_DIR)),
  ...[
    ART_INVENTORY_PATH,
    ART_HOTSPOTS_PATH,
    ART_REGISTRY_PATH,
    EQUIVALENCE_REPORT_PATH,
    ART_MAPPING_DOC_PATH,
  ].map((p) => join(root, p)),
].map((f) => relative(root, f).split('\\').join('/'));

describe.skipIf(!isRepo)('artwork files are committable byte-for-byte', () => {
  it('covers the 29 originals, the 28 published copies, the derived files and the manifest', () => {
    expect(required.filter((p) => p.startsWith(`${ART_SOURCE_DIR}/`))).toHaveLength(29);
    expect(required.filter((p) => p.startsWith(`${ART_PUBLIC_DIR}/original/`))).toHaveLength(28);
    expect(required.filter((p) => p.startsWith(`${ART_PUBLIC_DIR}/derived/`)).length).toBeGreaterThan(0);
    expect(required).toContain(`${ART_PUBLIC_DIR}/manifest.json`);
  });

  it('no required path is git-ignored', () => {
    let ignored = '';
    try {
      ignored = git(['check-ignore', '--no-index', '--stdin'], required.join('\n'));
    } catch (e) {
      // Exit status 1 = none of the paths is ignored.
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(ignored.trim()).toBe('');
  });

  it('.gitattributes marks every artwork image binary explicitly (no reliance on git detection heuristics)', () => {
    const images = required.filter((p) => /\.(?:png|jpe?g|webp)$/i.test(p));
    const out = git(['check-attr', 'binary', 'text', '--stdin'], images.join('\n')).trim().split('\n');
    for (const p of images) {
      expect(out, p).toContain(`${p}: binary: set`);
      expect(out, p).toContain(`${p}: text: unset`);
    }
  });

  it('git stores every binary file unchanged (filtered blob id = raw blob id)', () => {
    const binary = required.filter((p) => /\.(?:png|jpe?g|webp)$/i.test(p));
    const filtered = git(['hash-object', '--stdin-paths'], binary.join('\n')).trim().split('\n');
    const raw = git(['hash-object', '--no-filters', '--stdin-paths'], binary.join('\n')).trim().split('\n');
    expect(filtered).toHaveLength(binary.length);
    binary.forEach((p, i) => expect(filtered[i], p).toBe(raw[i]));
  });

  it('text outputs are already normalized (LF), so a checkout reproduces them exactly', () => {
    for (const p of required.filter((x) => /\.(?:json|md)$/.test(x)))
      expect(readFileSync(join(root, p), 'utf8').includes('\r\n'), p).toBe(false);
  });
});
