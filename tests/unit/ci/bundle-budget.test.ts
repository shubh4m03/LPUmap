// @vitest-environment node
/**
 * Bundle-size budgets (scripts/perf/bundle-budget.ts, docs/PERFORMANCE.md
 * §Bundle budgets) on a synthetic dist/: chunks are classified by their source
 * maps or, without maps (the published build), by code markers, and every
 * budget and isolation rule is enforced.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeBundle,
  ARTWORK_MARKER,
  BUNDLE_BUDGETS,
  checkBundle,
  ISOMETRIC_MARKER,
  MAPLIBRE_MARKER,
  normalizeSource,
  type BundleBudgets,
  type BundleInput,
} from '../../../scripts/perf/bundle-budget.ts';

const root = join(__dirname, '../../..');

const enc = (s: string) => new TextEncoder().encode(s);
/** Incompressible-ish text of `n` bytes, so gzip size tracks raw size. */
function noise(n: number, seed = 1): string {
  let x = seed;
  let s = '';
  while (s.length < n) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += String.fromCharCode(33 + (x % 90));
  }
  return s;
}

interface FakeFile {
  body: string;
  sources?: string[];
}

function dist(
  files: Record<string, FakeFile>,
  opts: { preloads?: string[]; precache?: string[] } = {},
): BundleInput {
  const store = new Map<string, Uint8Array>();
  for (const [name, f] of Object.entries(files)) {
    store.set(name, enc(f.body));
    if (f.sources) store.set(`${name}.map`, enc(JSON.stringify({ version: 3, sources: f.sources })));
  }
  const html = [
    '<script type="module" crossorigin src="/assets/index-A.js"></script>',
    ...(opts.preloads ?? []).map((p) => `<link rel="modulepreload" crossorigin href="/${p}">`),
    '<link rel="stylesheet" crossorigin href="/assets/index-A.css">',
  ].join('\n');
  return {
    indexHtml: html,
    assetFiles: [...store.keys()].filter((k) => k.startsWith('assets/')),
    read: (f) => store.get(f) ?? null,
    precacheUrls: opts.precache ?? ['index.html', 'assets/index-A.js'],
    size: (f) => store.get(f)?.length ?? (f === 'index.html' ? 1000 : null),
  };
}

const good = (): Record<string, FakeFile> => ({
  'assets/index-A.js': {
    body: noise(20_000),
    sources: ['../../src/main.tsx', '../../src/admin/AdminRoot.tsx'],
  },
  'assets/index-A.css': { body: noise(5_000) },
  'assets/MapView-B.js': {
    body: noise(50_000, 2),
    sources: ['../../node_modules/maplibre-gl/dist/maplibre-gl.js'],
  },
  'assets/studio-C.js': { body: noise(10_000, 3), sources: ['../../src/isometric/draw.ts'] },
  'assets/Stage-D.js': {
    body: noise(5_000, 4),
    sources: ['../../src/isometric-art/IllustratedOverview.tsx'],
  },
  'assets/AdminApp-E.js': { body: 'X-CSRF-Token /api/admin', sources: ['../../src/admin/AdminApp.tsx'] },
});

describe('analyzeBundle', () => {
  it('finds the entry, preloads and stylesheets, and classifies chunks by source map', () => {
    const r = analyzeBundle(dist(good(), { preloads: ['assets/studio-C.js'] }));
    expect(r.entry).toBe('assets/index-A.js');
    expect(r.preloads).toEqual(['assets/studio-C.js']);
    expect(r.stylesheets).toEqual(['assets/index-A.css']);
    expect(r.chunks.find((c) => c.file === 'assets/MapView-B.js')?.sources).toEqual([
      'node_modules/maplibre-gl/dist/maplibre-gl.js',
    ]);
    const entry = r.chunks.find((c) => c.file === 'assets/index-A.js')!;
    const iso = r.chunks.find((c) => c.file === 'assets/studio-C.js')!;
    expect(r.startupJsGzipBytes).toBe(entry.gzipBytes + iso.gzipBytes);
    expect(r.precacheFiles).toBe(2);
  });

  it('normalises source paths from any depth or platform', () => {
    expect(normalizeSource('../../../../x/lpu-campus-atlas/src/isometric/draw.ts')).toBe(
      'src/isometric/draw.ts',
    );
    expect(normalizeSource('C:\\repo\\node_modules\\maplibre-gl\\dist\\a.js')).toBe(
      'node_modules/maplibre-gl/dist/a.js',
    );
  });
});

describe('checkBundle', () => {
  const check = (
    files: Record<string, FakeFile>,
    budgets: BundleBudgets = BUNDLE_BUDGETS,
    precache?: string[],
  ) => {
    const input = dist(files, precache ? { precache } : {});
    return checkBundle(analyzeBundle(input), input.read, budgets);
  };

  it('passes a build within every budget', () => {
    expect(check(good())).toEqual([]);
  });

  it('fails a chunk, entry, CSS or overview chunk over its budget', () => {
    expect(check(good(), { ...BUNDLE_BUDGETS, maxChunkRawBytes: 40_000 })).toEqual([
      expect.stringMatching(/MapView-B\.js is .* raw, over/),
    ]);
    expect(
      check(good(), { ...BUNDLE_BUDGETS, entryGzipBytes: 1_000, startupJsGzipBytes: 1_000_000 }),
    ).toEqual([expect.stringMatching(/^Entry .* gzip, over/)]);
    expect(check(good(), { ...BUNDLE_BUDGETS, startupCssGzipBytes: 100 })).toEqual([
      expect.stringMatching(/Start-up CSS/),
    ]);
    expect(check(good(), { ...BUNDLE_BUDGETS, isometricChunkGzipBytes: 1_000 })).toEqual([
      expect.stringMatching(/Isometric overview chunk assets\/studio-C\.js/),
    ]);
  });

  it('fails when MapLibre or admin code reaches the entry, or MapLibre reaches the overview', () => {
    const files = good();
    files['assets/index-A.js'] = {
      body: `${noise(1000)} Moderation queue`,
      sources: [
        '../../src/main.tsx',
        '../../node_modules/maplibre-gl/dist/maplibre-gl.js',
        '../../src/admin/AdminApp.tsx',
      ],
    };
    files['assets/Stage-D.js'] = {
      body: noise(100),
      sources: ['../../src/isometric-art/x.ts', '../../node_modules/maplibre-gl/dist/maplibre-gl.js'],
    };
    const problems = check(files);
    expect(problems).toContainEqual(
      expect.stringMatching(/contains maplibre-gl; MapLibre must stay a lazy chunk/),
    );
    expect(problems).toContainEqual(
      expect.stringMatching(/contains admin modules: src\/admin\/AdminApp\.tsx/),
    );
    expect(problems).toContainEqual(expect.stringMatching(/admin string "Moderation queue"/));
    expect(problems).toContainEqual(
      expect.stringMatching(/Overview chunk assets\/Stage-D\.js contains maplibre-gl/),
    );
  });

  it('fails without an isometric chunk, without a MapLibre chunk, or over the precache budget', () => {
    const files = good();
    delete files['assets/studio-C.js'];
    delete files['assets/MapView-B.js'];
    const problems = check(files, { ...BUNDLE_BUDGETS, precacheBytes: 50 });
    expect(problems).toContainEqual(expect.stringMatching(/No chunk holds the isometric overview/));
    expect(problems).toContainEqual(expect.stringMatching(/No chunk contains MapLibre/));
    expect(problems).toContainEqual(expect.stringMatching(/^Precache is .* over/));
  });
});

describe('builds without source maps (the published build)', () => {
  const noMaps = (): Record<string, FakeFile> => ({
    'assets/index-A.js': { body: noise(20_000) },
    'assets/index-A.css': { body: noise(5_000) },
    'assets/MapView-B.js': { body: `${noise(50_000, 2)}"${MAPLIBRE_MARKER}"` },
    'assets/studio-C.js': { body: `${noise(10_000, 3)}window.${ISOMETRIC_MARKER}=x` },
    'assets/Stage-D.js': { body: `${noise(5_000, 4)}window.${ARTWORK_MARKER}=y` },
  });
  const check = (files: Record<string, FakeFile>, budgets: BundleBudgets = BUNDLE_BUDGETS) => {
    const input = dist(files);
    return checkBundle(analyzeBundle(input), input.read, budgets);
  };

  it('classifies by code markers and passes within budget', () => {
    expect(check(noMaps())).toEqual([]);
    expect(check(noMaps(), { ...BUNDLE_BUDGETS, isometricChunkGzipBytes: 1_000 })).toEqual([
      expect.stringMatching(/Isometric overview chunk assets\/studio-C\.js/),
    ]);
  });

  it('still catches MapLibre in the entry or in an overview chunk', () => {
    const files = noMaps();
    files['assets/index-A.js'] = { body: `${noise(100)}${MAPLIBRE_MARKER}` };
    files['assets/Stage-D.js'] = { body: `${ARTWORK_MARKER} ${MAPLIBRE_MARKER}` };
    const problems = check(files);
    expect(problems).toContainEqual(expect.stringMatching(/^Entry .* contains maplibre-gl/));
    expect(problems).toContainEqual(
      expect.stringMatching(/Overview chunk assets\/Stage-D\.js contains maplibre-gl/),
    );
  });

  it('the markers exist in the real code: MapLibre, the overview hook and the artwork hook', () => {
    const maplibre = readFileSync(join(root, 'node_modules/maplibre-gl/dist/maplibre-gl.mjs'), 'utf8');
    expect(maplibre).toContain(MAPLIBRE_MARKER);
    expect(readFileSync(join(root, 'src/isometric/test-hooks.ts'), 'utf8')).toContain(
      `window.${ISOMETRIC_MARKER}`,
    );
    const art = readdirSync(join(root, 'src/isometric-art'), { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(join(root, 'src/isometric-art', f), 'utf8'));
    expect(art.some((t) => t.includes(ARTWORK_MARKER))).toBe(true);
  });
});
