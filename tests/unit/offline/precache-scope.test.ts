import { describe, expect, it } from 'vitest';
import {
  adminOnlyFiles,
  createPrecacheScope,
  type BundleLike,
  type ChunkLike,
} from '../../../src/offline/precache-scope.ts';

function chunk(
  fileName: string,
  over: Partial<Omit<ChunkLike, 'viteMetadata'>> & { css?: string[]; assets?: string[] } = {},
): ChunkLike {
  const { css = [], assets = [], ...rest } = over;
  return {
    type: 'chunk',
    fileName,
    isEntry: false,
    facadeModuleId: null,
    imports: [],
    dynamicImports: [],
    ...rest,
    viteMetadata: { importedCss: new Set(css), importedAssets: new Set(assets) },
  };
}

/**
 * The shape of the real graph: the public entry imports AdminRoot, whose lazy import is the
 * AdminApp chunk; the admin lazily loads sections; the Studio section shares the studio renderer
 * with the public map, which must stay precached.
 */
function bundle(): BundleLike {
  const files = [
    chunk('assets/index.js', {
      isEntry: true,
      facadeModuleId: 'C:\\repo\\index.html',
      imports: ['assets/jsx.js'],
      dynamicImports: ['assets/AppShell.js', 'assets/AdminApp.js'],
      css: ['assets/index.css'],
    }),
    chunk('assets/jsx.js'),
    chunk('assets/AppShell.js', { dynamicImports: ['assets/MapView.js'] }),
    chunk('assets/MapView.js', {
      dynamicImports: ['assets/studio-runtime.js'],
      assets: ['assets/worker.mjs'],
    }),
    chunk('assets/studio-runtime.js'),
    chunk('assets/AdminApp.js', {
      facadeModuleId: 'C:\\repo\\src\\admin\\AdminApp.tsx',
      imports: ['assets/jsx.js', 'assets/admin-ui.js'],
      dynamicImports: ['assets/StudioSection.js', 'assets/ArtworkSection.js', 'assets/TemplatesSection.js'],
      css: ['assets/index.css', 'assets/admin.css'],
    }),
    chunk('assets/admin-ui.js'),
    chunk('assets/StudioSection.js', { imports: ['assets/studio-runtime.js', 'assets/admin-ui.js'] }),
    chunk('assets/ArtworkSection.js', { imports: ['assets/admin-ui.js'] }),
    chunk('assets/TemplatesSection.js', { assets: ['assets/worker.mjs', 'assets/admin-only.png'] }),
    { type: 'asset' as const, fileName: 'assets/index.css' },
  ];
  return Object.fromEntries(files.map((f) => [f.fileName, f]));
}

describe('precache scope (G-19)', () => {
  it('keeps exactly the chunks reachable only through the admin boundary out of the precache', () => {
    expect([...adminOnlyFiles(bundle())].sort()).toEqual([
      'assets/AdminApp.js',
      'assets/ArtworkSection.js',
      'assets/StudioSection.js',
      'assets/TemplatesSection.js',
      'assets/admin-only.png',
      'assets/admin-ui.js',
      'assets/admin.css',
    ]);
  });

  it('refuses a bundle without the admin boundary instead of precaching everything silently', () => {
    const b = bundle();
    delete b['assets/AdminApp.js'];
    expect(() => adminOnlyFiles(b)).toThrow(/AdminApp\.tsx/);
  });

  it('the manifest transform drops admin files and keeps the rest in order', async () => {
    const scope = createPrecacheScope();
    const entries = ['index.html', 'assets/index.js', 'assets/AdminApp.js', 'assets/MapView.js'].map(
      (url) => ({
        url,
        revision: null,
        size: 1,
      }),
    );
    await expect(scope.manifestTransform(entries)).rejects.toThrow(/not analysed/);
    scope.plugin.generateBundle(undefined, bundle());
    const { manifest } = await scope.manifestTransform(entries);
    expect(manifest.map((e) => e.url)).toEqual(['index.html', 'assets/index.js', 'assets/MapView.js']);
  });
});
