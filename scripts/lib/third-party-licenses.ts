/**
 * Third-party licence notices (G-22), generated from package-lock.json at build
 * time with no extra dependency.
 *
 * What ships to a visitor is:
 *   - every npm package whose code Vite bundled into dist/assets (read from
 *     the real bundle's module ids, so nothing is guessed),
 *   - the Vite/Rolldown runtime helpers the bundler injects (virtual modules),
 *   - the Workbox runtime that vite-plugin-pwa (generateSW) compiles into
 *     dist/workbox-*.js for the service worker (precaching, routing,
 *     StaleWhileRevalidate, expiration with its `idb` store, cacheable response),
 *   - Tailwind CSS, whose generated preflight/utility CSS is in the stylesheet.
 * Name, version and licence come from the lockfile; the licence TEXT comes from
 * the installed package's own LICENSE file (never written by us).
 *
 * The allow-list check runs on the whole production closure of the lockfile
 * plus everything shipped (`tests/unit/licenses`, part of `npm test` in CI) and
 * again in the build, which fails on a shipped package outside the list.
 *
 * Node only (imported by vite.config.ts and tests): erasable syntax, `.ts` imports.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Published file name in dist/. */
export const THIRD_PARTY_LICENSES_FILE = 'THIRD_PARTY_LICENSES.txt';

/** SPDX ids allowed for shipped and production packages (all permissive). */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
]);

/** Shipped without being imported by app code (see the module comment). */
export const SERVICE_WORKER_RUNTIME_PACKAGES = [
  'workbox-core',
  'workbox-precaching',
  'workbox-routing',
  'workbox-strategies',
  'workbox-expiration',
  'workbox-cacheable-response',
  'idb',
] as const;
export const GENERATED_CSS_PACKAGES = ['tailwindcss'] as const;

/** Virtual helper modules the bundler injects, by the package that provides them. */
const VIRTUAL_HELPERS: ReadonlyArray<[RegExp, string]> = [
  [/^\0?vite\//, 'vite'],
  [/^\0?rolldown\//, 'rolldown'],
];

export interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
  resolved?: string;
}
export interface Lockfile {
  lockfileVersion: number;
  packages: Record<string, LockPackage>;
}

export interface NoticePackage {
  name: string;
  version: string;
  license: string;
}

export function readLockfile(root: string): Lockfile {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as Lockfile;
  if (lock.lockfileVersion < 2 || !lock.packages)
    throw new Error('package-lock.json v2+ with "packages" required');
  return lock;
}

/** Package name from a lockfile key such as `node_modules/a/node_modules/@b/c`. */
export function packageNameOfKey(key: string): string | null {
  const i = key.lastIndexOf('node_modules/');
  return i < 0 ? null : key.slice(i + 'node_modules/'.length);
}

/** The npm package a bundled module id belongs to (or the provider of a virtual helper). */
export function packageOfModuleId(id: string): string | null {
  const p = id.split('\\').join('/');
  const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p);
  if (m) return m[1]!;
  for (const [re, name] of VIRTUAL_HELPERS) if (re.test(p)) return name;
  return null;
}

/** The hoisted (top-level) lockfile entry of a package. */
function entryOf(lock: Lockfile, name: string): LockPackage | undefined {
  return lock.packages[`node_modules/${name}`];
}

/** Every package (name@version) that is not dev-only in the lockfile. */
export function productionPackages(lock: Lockfile): NoticePackage[] {
  const out = new Map<string, NoticePackage>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const name = packageNameOfKey(key);
    if (!name || entry.dev) continue;
    const version = entry.version ?? 'unknown';
    out.set(`${name}@${version}`, { name, version, license: entry.license ?? 'UNKNOWN' });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Shipped packages with their lockfile metadata. Throws for a package the lockfile does not know. */
export function shippedPackages(lock: Lockfile, bundledModuleIds: Iterable<string>): NoticePackage[] {
  const names = new Set<string>([...SERVICE_WORKER_RUNTIME_PACKAGES, ...GENERATED_CSS_PACKAGES]);
  for (const id of bundledModuleIds) {
    const name = packageOfModuleId(id);
    if (name) names.add(name);
  }
  return [...names].sort().map((name) => {
    const entry = entryOf(lock, name);
    if (!entry?.version)
      throw new Error(`third-party licences: ${name} is shipped but not in package-lock.json`);
    return { name, version: entry.version, license: entry.license ?? 'UNKNOWN' };
  });
}

/**
 * True when an SPDX expression is satisfiable from the allow-list:
 * `A OR B` needs one allowed side, `A AND B` needs both. Parentheses are
 * flattened (enough for the simple expressions npm records).
 */
export function licenseAllowed(expression: string, allowed: ReadonlySet<string> = ALLOWED_LICENSES): boolean {
  const expr = expression.replace(/[()]/g, ' ').trim();
  if (!expr) return false;
  return expr.split(/\s+OR\s+/).some((alt) =>
    alt
      .split(/\s+AND\s+/)
      .map((id) => id.trim())
      .every((id) => allowed.has(id)),
  );
}

export function disallowed(pkgs: readonly NoticePackage[]): NoticePackage[] {
  return pkgs.filter((p) => !licenseAllowed(p.license));
}

/** The package's own licence file text, minus the notices of the package's own (unshipped) build tools. */
export function licenseText(root: string, name: string): string | null {
  const dir = join(root, 'node_modules', name);
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!file) return null;
  const text = readFileSync(join(dir, file), 'utf8');
  // Vite's LICENSE.md appends the licences of the dependencies bundled into Vite's own Node
  // code; none of that code ships in our build, only the package's own licence applies.
  const cut = text.search(/^#\s*Licenses of bundled dependencies/m);
  return (cut > 0 ? text.slice(0, cut) : text).trim();
}

/** The notices file: one section per shipped package with its full licence text. */
export function renderNotices(
  pkgs: readonly NoticePackage[],
  readText: (name: string) => string | null,
): string {
  const rule = '='.repeat(78);
  const head = [
    'LPU Campus Atlas: third-party software notices',
    '',
    'This web app includes the following open-source packages. Name, version and',
    'licence are taken from package-lock.json; each licence text is copied from the',
    'installed package. Generated at build time; do not edit.',
    '',
  ];
  const body = pkgs.flatMap((p) => {
    const text = readText(p.name);
    return [
      rule,
      `${p.name} ${p.version}`,
      `Licence: ${p.license}`,
      rule,
      '',
      text ?? `(The package does not include a licence file; its package metadata declares ${p.license}.)`,
      '',
    ];
  });
  return [...head, ...body].join('\n');
}

/** Vite plugin: emits THIRD_PARTY_LICENSES.txt and fails the build on a disallowed licence. */
export function thirdPartyLicensesPlugin(root: string) {
  return {
    name: 'atlas-third-party-licenses',
    apply: 'build' as const,
    generateBundle(
      this: { emitFile(f: { type: 'asset'; fileName: string; source: string }): string },
      _options: unknown,
      bundle: Record<string, { type: string; moduleIds?: readonly string[] }>,
    ) {
      const ids = Object.values(bundle).flatMap((f) => (f.type === 'chunk' ? (f.moduleIds ?? []) : []));
      const pkgs = shippedPackages(readLockfile(root), ids);
      const bad = disallowed(pkgs);
      if (bad.length > 0)
        throw new Error(
          `third-party licences outside the allow-list: ${bad.map((p) => `${p.name}@${p.version} (${p.license})`).join(', ')}`,
        );
      this.emitFile({
        type: 'asset',
        fileName: THIRD_PARTY_LICENSES_FILE,
        source: renderNotices(pkgs, (name) => licenseText(root, name)),
      });
    },
  };
}
