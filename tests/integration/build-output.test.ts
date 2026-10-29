// @vitest-environment node
/**
 * A REAL production build (vite.config.ts, into a temp folder, never dist/) and
 * checks on what would be published:
 *   - G-19: admin chunks (/admin, Studio, Templates, Artwork) are built and
 *     served, but are not in the service worker's precache;
 *   - the precache has no duplicate entries;
 *   - no source maps and no build-machine paths or user name in any file;
 *   - G-22: THIRD_PARTY_LICENSES.txt is generated.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAPLIBRE_MARKER } from '../../scripts/perf/bundle-budget.ts';

const root = process.cwd();
let out = '';
let files: string[] = [];
let precache: string[] = [];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [relative(out, p).split('\\').join('/')];
  });
}

const TEXT = /\.(?:js|mjs|css|html|json|geojson|webmanifest|txt|svg)$|^_headers$/;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'lpu-atlas-build-'));
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const run = spawnSync(
    process.execPath,
    [vite, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
    {
      cwd: root,
      encoding: 'utf8',
      // As `npm run build` runs it: Vitest's NODE_ENV=test would switch React to its dev JSX
      // transform, which embeds absolute source paths.
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST'))),
        NODE_ENV: 'production',
      },
    },
  );
  if (run.status !== 0) throw new Error(`vite build failed:\n${run.stdout}\n${run.stderr}`);
  files = listFiles(out);
  const sw = readFileSync(join(out, 'sw.js'), 'utf8');
  const list = /precacheAndRoute\((\[[\s\S]*?\])/.exec(sw)?.[1];
  if (!list) throw new Error('sw.js has no precache list');
  precache = (new Function(`return ${list}`)() as Array<{ url: string }>).map((e) => e.url);
}, 300_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const built = (prefix: string) => files.filter((f) => f.startsWith(`assets/${prefix}-`) && f.endsWith('.js'));

describe('production build output', () => {
  it('admin, Studio, Templates and Artwork chunks are built but not precached (G-19)', () => {
    for (const name of ['AdminApp', 'StudioSection', 'TemplatesSection', 'ArtworkSection', 'QueueSection']) {
      const chunks = built(name);
      expect(chunks, `${name} chunk built (served online)`).toHaveLength(1);
      expect(precache, name).not.toContain(chunks[0]);
    }
    // The public app is precached as before.
    expect(precache).toContain('index.html');
    for (const name of ['index', 'AppShell', 'IsometricModeStage'])
      expect(precache, name).toContain(built(name)[0]);
    // The map chunk, found by MapLibre's own code (chunk names follow the import graph;
    // scripts/perf/bundle-budget.ts classifies chunks the same way).
    const mapChunks = files.filter(
      (f) => f.endsWith('.js') && readFileSync(join(out, f), 'utf8').includes(MAPLIBRE_MARKER),
    );
    expect(mapChunks).toHaveLength(1);
    expect(precache, 'MapLibre chunk').toContain(mapChunks[0]);
    expect(precache.some((u) => /maplibre-gl-worker-.*\.mjs$/.test(u))).toBe(true);
    expect(precache).toContain('data/graph.json');
  });

  it('lists every precache entry once', () => {
    const dupes = precache.filter((u, i) => precache.indexOf(u) !== i);
    expect(dupes).toEqual([]);
    expect(precache).toContain('manifest.webmanifest');
    expect(precache).toContain('icons/icon-192.png');
  });

  it('ships no source maps and no build-machine path or user name', () => {
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
    const user = userInfo().username;
    const needles = [root, root.split('\\').join('/'), 'C:\\Users', 'C:/Users', 'C:\\\\Users'];
    const userPattern =
      user.length >= 4 ? new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
    const leaks: string[] = [];
    for (const f of files.filter((p) => TEXT.test(p.split('/').pop()!))) {
      const text = readFileSync(join(out, f), 'utf8');
      // Our code has none; MapLibre's prebuilt worker keeps its upstream bare-name reference
      // (`maplibre-gl-worker.mjs.map`, not shipped), which names no path.
      for (const m of text.matchAll(/sourceMappingURL=(\S+)/g))
        if (!f.includes('maplibre-gl-worker-') || /[\\/:]/.test(m[1]!))
          leaks.push(`${f}: sourceMappingURL=${m[1]}`);
      for (const n of needles) if (text.includes(n)) leaks.push(`${f}: ${n}`);
      if (userPattern?.test(text)) leaks.push(`${f}: user name`);
    }
    expect(leaks).toEqual([]);
  });

  it('publishes third-party licence notices generated from the lockfile (G-22)', () => {
    const file = join(out, 'THIRD_PARTY_LICENSES.txt');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const pkg of [
      'maplibre-gl',
      'react',
      'react-dom',
      'zod',
      'zustand',
      'workbox-precaching',
      'workbox-window',
    ])
      expect(text, pkg).toMatch(new RegExp(`^${pkg} \\d`, 'm'));
    expect(text).toMatch(/^Licence: BSD-3-Clause$/m);
  });
});
