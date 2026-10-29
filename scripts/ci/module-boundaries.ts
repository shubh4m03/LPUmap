/**
 * The module map of src/, server/ and functions/ and the two import rules
 * (docs/ARCHITECTURE.md §Module dependency rules, G-26/G-27):
 *
 *  1. Layers: a module imports only from its own layer or a lower one, the server
 *     only from the pure layers, functions/ only from the server. Type-only imports
 *     count too: a type that points up is the same coupling as a value.
 *  2. Public entries: an import that crosses into another module names one of that
 *     module's public entry files (its `index.ts`, plus the few documented extra
 *     entries below). Never an internal file.
 *
 * The third rule, no module-level and no file-level import cycles, needs the whole
 * graph; scripts/ci/module-graph.ts checks it (tests/unit/ci/module-graph.test.ts).
 *
 * Pure (string paths only, no file access), so the ESLint rule
 * (scripts/ci/eslint-module-boundaries.ts) and the graph check share it. Node runs
 * it by type stripping: erasable syntax and `.ts` import extensions only.
 */

/** Layers from the bottom up. `server` and `functions` are the server-side deployables. */
export const LAYERS = ['leaf', 'domain', 'view', 'app', 'entry'] as const;
export type SrcLayer = (typeof LAYERS)[number];
export type Layer = SrcLayer | 'server' | 'functions';

export interface ModuleUnit {
  /** Name used in messages and in the module graph, e.g. `map`, `building-studio/ui`. */
  id: string;
  /** Repository-relative directories (or single files) that make up the unit. */
  paths: readonly string[];
  layer: Layer;
  /**
   * Public entry files, relative to the unit's first path; `'any'` = every file is
   * public (a unit without a barrel, by decision).
   */
  entries: readonly string[] | 'any';
  /** Why the unit has more than one entry, or no barrel. Shown in lint messages. */
  note?: string;
}

/**
 * Every unit. A file belongs to the unit with the longest matching path, so
 * `src/components/ui` is the design system while the rest of `src/components` is
 * the app's feature panels, and `src/building-studio/ui` is apart from its core.
 */
export const MODULE_UNITS: readonly ModuleUnit[] = [
  // L0 leaves: no imports from other units.
  { id: 'config', paths: ['src/config'], layer: 'leaf', entries: ['index.ts'] },
  {
    id: 'utils',
    paths: ['src/utils'],
    layer: 'leaf',
    entries: 'any',
    note: 'src/utils has no barrel by decision: import the specific file.',
  },
  {
    id: 'csp',
    paths: ['src/csp'],
    layer: 'leaf',
    entries: ['zod.ts'],
    note: 'Reached through the vite.config.ts alias of the bare `zod` import.',
  },
  {
    id: 'styles',
    paths: ['src/styles'],
    layer: 'leaf',
    entries: ['index.ts', 'index.css'],
    note: 'index.css is the stylesheet src/main.tsx loads.',
  },

  // L1 domain: pure, shared with scripts/ and the server.
  { id: 'data', paths: ['src/data'], layer: 'domain', entries: ['index.ts'] },
  { id: 'geo', paths: ['src/geo'], layer: 'domain', entries: ['index.ts'] },
  { id: 'distance', paths: ['src/distance'], layer: 'domain', entries: ['index.ts'] },
  { id: 'routing', paths: ['src/routing'], layer: 'domain', entries: ['index.ts'] },
  { id: 'search', paths: ['src/search'], layer: 'domain', entries: ['index.ts'] },
  { id: 'facilities', paths: ['src/facilities'], layer: 'domain', entries: ['index.ts'] },
  {
    id: 'geolocation',
    paths: ['src/geolocation'],
    layer: 'domain',
    entries: ['index.ts', 'filter.ts', 'types.ts'],
    note: 'filter.ts and types.ts are the pure entries; index.ts adds the browser watcher and the React hook.',
  },
  { id: 'navigation', paths: ['src/navigation'], layer: 'domain', entries: ['index.ts'] },
  { id: 'directory', paths: ['src/directory'], layer: 'domain', entries: ['index.ts'] },
  { id: 'community', paths: ['src/community'], layer: 'domain', entries: ['index.ts'] },
  {
    id: 'building-studio',
    paths: ['src/building-studio'],
    layer: 'domain',
    entries: ['index.ts', 'editor.ts'],
    note: 'editor.ts is the owner’s editing core (admin, Studio UI, server); index.ts is what the public map and other modules need, so the editor stays out of public chunks and the precache.',
  },
  { id: 'isometric-art', paths: ['src/isometric-art'], layer: 'domain', entries: ['index.ts'] },

  // L2 views and UI.
  {
    id: 'map',
    paths: ['src/map'],
    layer: 'view',
    entries: ['index.ts', 'providers/index.ts', 'editing/index.ts'],
    note: 'providers/ and editing/ are public sub-entries; neither loads maplibre-gl.',
  },
  {
    id: 'buildings3d',
    paths: ['src/buildings3d'],
    layer: 'view',
    entries: ['index.ts', 'map-runtime.ts'],
    note: 'index.ts is in the start-up chunk; map-runtime.ts is the map-only code (realistic 3D, optional layers, models).',
  },
  {
    id: 'isometric',
    paths: ['src/isometric'],
    layer: 'view',
    entries: ['index.ts', 'studio.ts'],
    note: 'studio.ts is apart so the overview chunk does not pull in the studio schema.',
  },
  { id: 'isometric-art/view', paths: ['src/isometric-art/view'], layer: 'view', entries: ['index.ts'] },
  { id: 'building-studio/ui', paths: ['src/building-studio/ui'], layer: 'view', entries: ['index.ts'] },
  {
    id: 'building-studio/render',
    paths: ['src/building-studio/render'],
    layer: 'view',
    entries: ['maplibre/index.ts'],
  },
  { id: 'components/ui', paths: ['src/components/ui'], layer: 'view', entries: ['index.ts'] },
  { id: 'components/icons', paths: ['src/components/icons'], layer: 'view', entries: ['index.ts'] },
  { id: 'accessibility', paths: ['src/accessibility'], layer: 'view', entries: ['index.ts'] },
  { id: 'favorites', paths: ['src/favorites'], layer: 'view', entries: ['index.ts'] },
  {
    id: 'privacy',
    paths: ['src/privacy'],
    layer: 'view',
    entries: ['index.ts', 'privacy-store.ts'],
    note: 'privacy-store.ts is the settings store alone, for start-up code that must not carry the privacy facts (shown only in Settings).',
  },
  { id: 'feedback', paths: ['src/feedback'], layer: 'view', entries: ['index.ts'] },
  { id: 'offline', paths: ['src/offline'], layer: 'view', entries: ['index.ts'] },

  // L3 the app: shell, store, services, stages and the feature panels (one owner, modules/app-shell.md).
  {
    id: 'app',
    paths: ['src/app', 'src/components'],
    layer: 'app',
    entries: ['App.tsx', 'maplibre-worker.ts', 'data/publication.ts', 'data/apply-publication.ts'],
    note:
      'src/main.tsx mounts App.tsx; the admin reuses the MapLibre worker set-up (a side-effect import) ' +
      'and the public map’s publication loading and merge, so its maps show what the public sees.',
  },

  // L4 entries.
  { id: 'main', paths: ['src/main.tsx'], layer: 'entry', entries: 'any' },
  {
    id: 'admin',
    paths: ['src/admin'],
    layer: 'entry',
    entries: ['AdminRoot.tsx', 'is-admin-path.ts'],
    note: 'Public code reaches the admin only through its lazy boundary and the path test.',
  },

  // Server side.
  {
    id: 'server',
    paths: ['server'],
    layer: 'server',
    entries: 'any',
    note: 'functions/ are thin wrappers over server/handlers.',
  },
  { id: 'functions', paths: ['functions'], layer: 'functions', entries: 'any' },
];

const rank = (l: SrcLayer): number => LAYERS.indexOf(l);

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

function matchLength(file: string, path: string): number {
  if (file === path) return path.length;
  return file.startsWith(`${path}/`) ? path.length : -1;
}

/** The unit that owns a repository-relative file, or null (tests, scripts, configs). */
export function unitOf(file: string, units: readonly ModuleUnit[] = MODULE_UNITS): ModuleUnit | null {
  const f = norm(file);
  let best: ModuleUnit | null = null;
  let bestLen = -1;
  for (const u of units)
    for (const p of u.paths) {
      const n = matchLength(f, p);
      if (n > bestLen) {
        best = u;
        bestLen = n;
      }
    }
  return best;
}

/** `file` relative to the path of `unit` that contains it. */
function withinUnit(file: string, unit: ModuleUnit): string {
  const f = norm(file);
  for (const p of unit.paths) if (matchLength(f, p) >= 0) return f === p ? '' : f.slice(p.length + 1);
  return f;
}

/** True when `file` (inside `unit`) is one of its public entries. */
export function isPublicEntry(file: string, unit: ModuleUnit): boolean {
  if (unit.entries === 'any') return true;
  if (matchLength(norm(file), unit.paths[0]!) < 0) return false;
  return unit.entries.includes(withinUnit(file, unit));
}

export type BoundaryRule = 'layer' | 'public-entry';

export interface BoundaryViolation {
  rule: BoundaryRule;
  from: string;
  to: string;
  fromUnit: string;
  toUnit: string;
  message: string;
}

function layerAllows(from: ModuleUnit, to: ModuleUnit): boolean {
  if (from.layer === 'functions') return to.layer === 'server';
  if (from.layer === 'server') return to.layer === 'leaf' || to.layer === 'domain';
  if (to.layer === 'server' || to.layer === 'functions') return false;
  return rank(to.layer as SrcLayer) <= rank(from.layer as SrcLayer);
}

const entryList = (u: ModuleUnit): string =>
  u.entries === 'any' ? 'any file' : u.entries.map((e) => `${u.paths[0]}/${e}`).join(', ');

/**
 * Checks one import between two repository-relative files (the target already
 * resolved to a file). Returns null when the import is allowed or outside the
 * module map (tests, scripts, node_modules, assets).
 */
export function checkImport(
  from: string,
  to: string,
  units: readonly ModuleUnit[] = MODULE_UNITS,
): BoundaryViolation | null {
  const fromUnit = unitOf(from, units);
  const toUnit = unitOf(to, units);
  if (!fromUnit || !toUnit || fromUnit === toUnit) return null;
  const base = { from: norm(from), to: norm(to), fromUnit: fromUnit.id, toUnit: toUnit.id };
  if (!layerAllows(fromUnit, toUnit)) {
    return {
      ...base,
      rule: 'layer',
      message:
        `${fromUnit.id} (${fromUnit.layer}) must not import ${toUnit.id} (${toUnit.layer}): ` +
        'move the shared code or type to a lower module, or inject it (docs/ARCHITECTURE.md §Module dependency rules).',
    };
  }
  if (!isPublicEntry(to, toUnit)) {
    return {
      ...base,
      rule: 'public-entry',
      message:
        `${norm(to)} is internal to ${toUnit.id}; import its public entry (${entryList(toUnit)})` +
        `${toUnit.note ? ` — ${toUnit.note}` : ''}.`,
    };
  }
  return null;
}
