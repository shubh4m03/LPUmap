// @vitest-environment node
/**
 * Unit coverage for the pure helpers behind scripts/smoke.ts. The dist-dependent
 * run itself is `npm run smoke` (CI runs it after `vite build`); these tests use
 * inline fixtures and the synthetic routing graphs, never real LPU data.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_SCHEMA_VERSION, graphFileSchema } from '../../src/data/schema.ts';
import type { GraphFile, Manifest, Place } from '../../src/data/schema.ts';
import {
  checkDataFiles,
  checkGraphInvariants,
  checkPlaceInvariants,
  checkSchemaVersion,
  pickSearchProbe,
  runRouteProbe,
  runSearchProbe,
  sha256Hex,
} from '../../scripts/lib/smoke-data.ts';
import {
  checkIndexHtml,
  checkWebManifest,
  extractHtmlRefs,
  findSecrets,
  findSourceMapReferences,
  formatBytes,
  isTextFile,
  parsePrecacheUrls,
  toDistPath,
} from '../../scripts/lib/smoke-web.ts';

const graphFixture = (name: string): GraphFile =>
  graphFileSchema.parse(
    JSON.parse(readFileSync(new URL(`../fixtures/graphs/${name}`, import.meta.url), 'utf8')),
  );

function place(id: string, name: string | null, extra: Partial<Place> = {}): Place {
  return {
    id,
    name,
    displayName: name ?? 'Unnamed building',
    aliases: [],
    categoryId: 'academic',
    kind: 'building',
    location: null,
    campusZone: 'on-campus',
    wheelchair: 'unknown',
    provenance: { sourceId: 'test', verificationStatus: 'unverified' },
    ...extra,
  };
}

const GOOD_HTML = `<!doctype html><html><head>
  <link rel="icon" href="/favicon.svg" />
  <script type="module" crossorigin src="/assets/index-D7HcG2C-.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-CJmO_W9w.css">
  <link rel="manifest" href="/manifest.webmanifest"></head><body></body></html>`;
const GOOD_FILES = new Set([
  'favicon.svg',
  'assets/index-D7HcG2C-.js',
  'assets/index-CJmO_W9w.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
]);
const has = (p: string) => GOOD_FILES.has(p);

describe('smoke-web: index.html', () => {
  it('extracts src/href values with either quote style', () => {
    expect(extractHtmlRefs(`<a href='/x'></a><img src="/y.png">`)).toEqual(['/x', '/y.png']);
  });

  it('maps root-relative refs to dist paths, dropping query and hash', () => {
    expect(toDistPath('/assets/a-12345678.js?v=1#x')).toBe('assets/a-12345678.js');
    expect(toDistPath('./fonts/Noto%20Sans/0-255.pbf')).toBe('fonts/Noto Sans/0-255.pbf');
  });

  it('accepts a shell whose hashed bundles and manifest exist', () => {
    expect(checkIndexHtml(GOOD_HTML, has)).toEqual([]);
  });

  it('reports dangling, unhashed and external references', () => {
    const html = GOOD_HTML.replace('/assets/index-D7HcG2C-.js', '/assets/main.js').replace(
      '/favicon.svg',
      'https://cdn.example.com/f.svg',
    );
    const problems = checkIndexHtml(html, has);
    expect(problems.some((p) => p.includes('dist/assets/main.js does not exist'))).toBe(true);
    expect(problems.some((p) => p.includes('unhashed bundle /assets/main.js'))).toBe(true);
    expect(problems.some((p) => p.includes('external URL'))).toBe(true);
    expect(problems.some((p) => p.includes('no hashed JavaScript bundle'))).toBe(true);
  });

  it('reports a missing manifest link and missing stylesheet', () => {
    const html = `<script src="/assets/index-D7HcG2C-.js"></script>`;
    expect(checkIndexHtml(html, has)).toEqual([
      'index.html references no hashed stylesheet under assets/.',
      'index.html does not link manifest.webmanifest.',
    ]);
  });

  it('finds source-map references in HTML', () => {
    expect(findSourceMapReferences(GOOD_HTML)).toEqual([]);
    const html = `<script>//# sourceMappingURL=a.js.map</script><link href="/b.css.map">`;
    expect(findSourceMapReferences(html)).toEqual(['sourceMappingURL=a.js.map</script><link', '/b.css.map']);
  });
});

describe('smoke-web: web manifest', () => {
  const good = {
    name: 'Example',
    start_url: '.',
    display: 'standalone',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192' },
      { src: 'icons/icon-512.png', sizes: '512x512' },
    ],
  };

  it('accepts an installable manifest whose icons exist', () => {
    expect(checkWebManifest(good, has)).toEqual([]);
  });

  it('reports missing fields, bad display and missing icon files', () => {
    const problems = checkWebManifest(
      {
        ...good,
        name: ' ',
        start_url: undefined,
        display: 'tab',
        icons: [{ src: 'icons/gone.png', sizes: '48x48' }],
      },
      has,
    );
    expect(problems).toEqual([
      'manifest.webmanifest has no name.',
      'manifest.webmanifest has no start_url.',
      'manifest.webmanifest display is "tab"; expected an installable mode.',
      'manifest icon icons/gone.png does not exist at dist/icons/gone.png.',
      'manifest.webmanifest has no 192x192 icon (required for installability).',
      'manifest.webmanifest has no 512x512 icon (required for installability).',
    ]);
  });

  it('rejects non-objects and empty icon lists', () => {
    expect(checkWebManifest([], has)).toEqual(['manifest.webmanifest is not a JSON object.']);
    expect(checkWebManifest({ ...good, icons: [] }, has)).toEqual(['manifest.webmanifest lists no icons.']);
  });
});

describe('smoke-web: service worker, secrets, formatting', () => {
  it('parses the Workbox precache list', () => {
    const sw = `e.precacheAndRoute([{url:"index.html",revision:"a"},{url:"fonts/Noto Sans Bold/0-255.pbf",revision:"b"},{url:"assets/x-12345678.js",revision:null}],{});e.registerRoute(new e.NavigationRoute({url:"zzz"}))`;
    expect(parsePrecacheUrls(sw)).toEqual([
      'index.html',
      'fonts/Noto Sans Bold/0-255.pbf',
      'assets/x-12345678.js',
    ]);
    expect(parsePrecacheUrls('self.addEventListener("fetch",()=>{})')).toEqual([]);
  });

  it('flags credential-looking strings and ignores clean text', () => {
    expect(findSecrets('a.js', 'const routing = { apiVersion: 2 };')).toEqual([]);
    // Names without a literal value cannot hold a secret (the optional imagery key's env name in a
    // build without it, a TypeScript parameter in a source map).
    expect(findSecrets('a.js', 'Lt({VITE_ARCGIS_API_KEY:void 0,VITE_EOX_BACKDROP:void 0})')).toEqual([]);
    expect(findSecrets('a.js.map', 'function f(apiKey: string | null) {}')).toEqual([]);
    expect(findSecrets('a.js', 'return{arcgisApiKey:n}')).toEqual([]);
    for (const text of [
      'k="AKIAABCDEFGHIJKLMNOP"',
      'sk_live_abc123',
      '-----BEGIN RSA PRIVATE KEY-----',
      'API_KEY = "x"',
      '{apiKey: "x"}',
      "{api_key:'x'}",
      'VITE_ARCGIS_API_KEY:`AAPTxyz`',
    ]) {
      expect(findSecrets('a.js', text)).toHaveLength(1);
    }
  });

  it('classifies binary files and formats sizes', () => {
    expect(isTextFile('icons/icon-192.png')).toBe(false);
    expect(isTextFile('fonts/Noto Sans Bold/0-255.pbf')).toBe(false);
    expect(isTextFile('assets/index-D7HcG2C-.js.map')).toBe(true);
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KiB');
    expect(formatBytes(3.75 * 1024 * 1024)).toBe('3.8 MiB');
  });
});

describe('smoke-data: manifest integrity', () => {
  const body = new TextEncoder().encode('{"schemaVersion":1,"places":[]}');
  const manifest = {
    files: { places: { path: 'places.json', bytes: body.byteLength, sha256: sha256Hex(body) } },
  } as unknown as Manifest;

  it('checks the schema version against the app constant', () => {
    expect(checkSchemaVersion(DATA_SCHEMA_VERSION)).toEqual([]);
    expect(checkSchemaVersion(DATA_SCHEMA_VERSION + 1)[0]).toContain(`app expects ${DATA_SCHEMA_VERSION}`);
  });

  it('accepts files whose size and sha256 match', () => {
    expect(checkDataFiles(manifest, () => body)).toEqual([]);
  });

  it('reports missing and tampered files', () => {
    expect(checkDataFiles(manifest, () => null)).toEqual(['data/places.json (places) is missing.']);
    const tampered = new TextEncoder().encode('{"schemaVersion":1,"places":[1]}');
    const problems = checkDataFiles(manifest, () => tampered);
    expect(problems).toHaveLength(2);
    expect(problems[1]).toContain('does not match manifest');
    expect(checkDataFiles({ files: {} } as unknown as Manifest, () => null)).toEqual([
      'data manifest lists no files.',
    ]);
  });
});

describe('smoke-data: invariants and probes', () => {
  it('reports duplicate place ids and a dataset without names', () => {
    expect(checkPlaceInvariants([place('a', 'Alpha'), place('b', null)])).toEqual([]);
    expect(checkPlaceInvariants([place('a', null), place('a', null)])).toEqual([
      'duplicate place ids: a.',
      'places.json has no named place.',
    ]);
    expect(checkPlaceInvariants([])).toContain('places.json contains no places.');
  });

  it('reports edges and places that reference missing graph nodes', () => {
    const graph = graphFixture('synthetic-diamond.json');
    expect(checkGraphInvariants(graph, [place('a', 'A', { graphNodeId: 3 })])).toEqual([]);
    const broken: GraphFile = { ...graph, edges: [...graph.edges, { ...graph.edges[0]!, id: 99, to: 40 }] };
    const problems = checkGraphInvariants(broken, [place('a', 'A', { graphNodeId: 7 })]);
    expect(problems[0]).toContain('1 graph edge(s) reference missing nodes');
    expect(problems[1]).toContain('1 place(s) reference a graph node that does not exist (e.g. a)');
    const dupe: GraphFile = { ...graph, edges: [...graph.edges, graph.edges[0]!] };
    expect(checkGraphInvariants(dupe, [])).toEqual(['graph.json has duplicate edge ids.']);
  });

  it('picks the lowest-id place whose name is unique', () => {
    const places = [place('c', 'Gamma'), place('a', 'Twin'), place('b', 'twin'), place('d', null)];
    expect(pickSearchProbe(places)?.id).toBe('c');
    expect(pickSearchProbe([place('a', null)])).toBeNull();
  });

  it('finds the probe place with the real search index', () => {
    const outcome = runSearchProbe([
      place('p1', 'Synthetic Test Hall'),
      place('p2', 'Another Fixture Block'),
    ]);
    expect(outcome.problems).toEqual([]);
    expect(outcome.note).toContain('"Synthetic Test Hall" → p1 at rank 1');
    expect(runSearchProbe([place('p1', null)]).problems).toHaveLength(1);
  });

  it('routes between fixture places on a connected graph', () => {
    const graph = graphFixture('synthetic-diamond.json');
    const places = graph.nodes.map((loc, i) =>
      place(`n${i}`, `Node ${i}`, { location: loc, graphNodeId: i }),
    );
    const outcome = runRouteProbe(graph, places);
    expect(outcome.problems).toEqual([]);
    expect(outcome.note).toMatch(/^Node 0 → Node 3: \d+ m, \d+ points \(attempt 1\)$/);
  });

  it('fails readably when no pair is routable', () => {
    const graph = graphFixture('synthetic-diamond.json');
    expect(runRouteProbe(graph, [place('a', 'A')]).problems).toEqual([
      'fewer than two routable places (location + graph node).',
    ]);
    const loc = graph.nodes[0]!;
    const same = [
      place('a', 'A', { location: loc, graphNodeId: 0 }),
      place('b', 'B', { location: loc, graphNodeId: 0 }),
    ];
    expect(runRouteProbe(graph, same).problems[0]).toMatch(
      /no walking route found in 1 attempts .*same-point ×1/,
    );
  });
});
