/**
 * The server reaches the shared data modules through their public entries
 * (src/data/index.ts, src/isometric-art/index.ts), which include the browser
 * loaders. Those read Vite's `import.meta.env` and treat it as absent outside
 * Vite (src/data/loader.ts `defaultDataBaseUrl`, src/isometric-art/manifest-loader.ts).
 * The server typecheck has no Vite types, so this types it as what it is
 * there: possibly absent. Server code never relies on it.
 */
interface ImportMeta {
  readonly env?: Readonly<Record<string, unknown>>;
}
