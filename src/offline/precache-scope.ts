/**
 * Precache scope (G-19): the owner admin (/admin: queue, locations, overrides,
 * Building Studio, Templates, Artwork, audit, quality) is code no public
 * visitor runs, so its chunks are kept OUT of the service-worker precache.
 * They are still ordinary hashed files in dist/assets and download normally
 * when the owner opens /admin online (offline, AdminRoot shows "could not be
 * loaded … reload", never a blank page).
 *
 * Which chunks are admin-only is decided from the real Rollup/Rolldown chunk
 * graph, not from file names: every chunk reachable from the public entry
 * WITHOUT going through the lazy `src/admin/AdminApp.tsx` boundary is public
 * (and precached); everything else is admin-only. So a module shared by the
 * map and the Studio (the studio renderer) stays precached, and an admin
 * chunk can never slip in under a new name.
 *
 * Executed in Node at build time (imported by pwa-config.ts → vite.config.ts):
 * types only, no browser APIs.
 */

/** The lazy boundary in src/admin/AdminRoot.tsx: the only way from the public app into the admin. */
export const ADMIN_BOUNDARY_MODULE = 'src/admin/AdminApp.tsx';

/** The slice of a Rollup/Rolldown output chunk this module reads. */
export interface ChunkLike {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: readonly string[];
  dynamicImports: readonly string[];
  viteMetadata?: { importedCss: ReadonlySet<string>; importedAssets: ReadonlySet<string> };
}
export interface AssetLike {
  type: 'asset';
  fileName: string;
}
export type BundleLike = Record<string, ChunkLike | AssetLike>;

/** A Workbox precache manifest entry as `manifestTransforms` receive it. */
export interface PrecacheEntry {
  url: string;
  revision: string | null;
  size: number;
}

const slash = (p: string) => p.split('\\').join('/');

function isBoundary(chunk: ChunkLike, boundary: string): boolean {
  return chunk.facadeModuleId !== null && slash(chunk.facadeModuleId).endsWith(`/${boundary}`);
}

/**
 * Files (chunks and the CSS/assets only they import) reachable only through the
 * admin boundary. Throws when the boundary chunk is missing: a refactor that
 * renames or inlines it must update ADMIN_BOUNDARY_MODULE, not silently
 * precache the whole admin again.
 */
export function adminOnlyFiles(bundle: BundleLike, boundary: string = ADMIN_BOUNDARY_MODULE): Set<string> {
  const chunks = Object.values(bundle).filter((f): f is ChunkLike => f.type === 'chunk');
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const admin = chunks.find((c) => isBoundary(c, boundary));
  if (!admin) throw new Error(`precache scope: no chunk has ${boundary} as its facade module`);

  const pub = new Set<string>();
  const stack = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (pub.has(name) || name === admin.fileName) continue;
    pub.add(name);
    const c = byName.get(name);
    if (c) stack.push(...c.imports, ...c.dynamicImports);
  }

  const referenced = (cs: Iterable<ChunkLike>) => {
    const out = new Set<string>();
    for (const c of cs) {
      for (const f of c.viteMetadata?.importedCss ?? []) out.add(f);
      for (const f of c.viteMetadata?.importedAssets ?? []) out.add(f);
    }
    return out;
  };
  const publicChunks = chunks.filter((c) => pub.has(c.fileName));
  const adminChunks = chunks.filter((c) => !pub.has(c.fileName));
  const publicRefs = referenced(publicChunks);
  const result = new Set(adminChunks.map((c) => c.fileName));
  for (const f of referenced(adminChunks)) if (!publicRefs.has(f)) result.add(f);
  return result;
}

/**
 * The build-time half: a Vite plugin that records the admin-only files of the
 * bundle, and the Workbox `manifestTransforms` entry that drops them from the
 * precache. Workbox generates sw.js after the bundle is written, so the plugin
 * has always run by the time the transform is called.
 */
export function createPrecacheScope(boundary: string = ADMIN_BOUNDARY_MODULE) {
  let excluded: Set<string> | null = null;
  const plugin = {
    name: 'atlas-precache-scope',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: BundleLike) {
      excluded = adminOnlyFiles(bundle, boundary);
    },
  };
  const manifestTransform = async (entries: PrecacheEntry[]) => {
    if (!excluded) throw new Error('precache scope: the bundle was not analysed before the service worker');
    const drop = excluded;
    return { manifest: entries.filter((e) => !drop.has(e.url)), warnings: [] as string[] };
  };
  return { plugin, manifestTransform, excludedFiles: () => excluded };
}
