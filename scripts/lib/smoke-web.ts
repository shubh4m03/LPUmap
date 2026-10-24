/**
 * Pure checks for the built web shell (index.html, web manifest, service
 * worker, secrets). No file system access: callers pass contents and an
 * `exists(path)` predicate, so every rule is unit-testable without dist/.
 * Paths handed to `exists` are relative to the build root (dist/).
 */

/** Vite content-hashed asset name, e.g. assets/index-D7HcG2C-.js. */
export const HASHED_ASSET_RE = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css)$/;

/**
 * Credential-looking patterns that must never ship. Deliberately broad: a
 * false positive is investigated by a human, a false negative leaks a key.
 * The api-key rule needs a string literal after the name: an identifier or a
 * type annotation (`apiKey: string`, `VITE_ARCGIS_API_KEY:void 0` in a build
 * without the optional imagery key) cannot hold a secret, but any embedded
 * value (`apiKey: "…"`, `API_KEY = '…'`) is still flagged.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /AKIA[0-9A-Z]{16}/,
  /sk_live_[0-9A-Za-z]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /api[_-]?key\s*[:=]\s*["'`]/i,
];

const BINARY_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif|ico|pbf|woff2?|ttf|otf)$/i;

/** True for files whose bytes should be scanned as text. */
export function isTextFile(path: string): boolean {
  return !BINARY_EXT_RE.test(path);
}

/** Every src/href attribute value in an HTML document, in order. */
export function extractHtmlRefs(html: string): string[] {
  const refs: string[] = [];
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = m[1] ?? m[2];
    if (value !== undefined && value !== '') refs.push(value);
  }
  return refs;
}

const isExternal = (ref: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref) || /^(?:data|blob):/i.test(ref);

/** Maps a root-relative or relative URL to a dist-relative file path (no query/hash). */
export function toDistPath(ref: string): string {
  const clean = ref.split(/[?#]/, 1)[0] ?? '';
  return decodeURIComponent(clean.replace(/^\.?\//, ''));
}

/** Problems with dist/index.html: missing/unhashed bundles, dangling or external refs. */
export function checkIndexHtml(html: string, exists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const refs = extractHtmlRefs(html);
  let scripts = 0;
  let styles = 0;
  for (const ref of refs) {
    if (isExternal(ref)) {
      problems.push(`index.html references an external URL (${ref}); the CSP allows only 'self'.`);
      continue;
    }
    const path = toDistPath(ref);
    if (path === '') continue;
    if (!exists(path)) problems.push(`index.html references ${ref}, but dist/${path} does not exist.`);
    if (path.startsWith('assets/')) {
      if (!HASHED_ASSET_RE.test(path)) {
        problems.push(`index.html references unhashed bundle ${ref}.`);
      } else if (/\.m?js$/.test(path)) {
        scripts += 1;
      } else if (path.endsWith('.css')) {
        styles += 1;
      }
    }
  }
  if (scripts === 0) problems.push('index.html references no hashed JavaScript bundle under assets/.');
  if (styles === 0) problems.push('index.html references no hashed stylesheet under assets/.');
  if (!refs.some((r) => toDistPath(r) === 'manifest.webmanifest')) {
    problems.push('index.html does not link manifest.webmanifest.');
  }
  return problems;
}

/** Source-map references visible in HTML (sourceMappingURL comments or links to .map files). */
export function findSourceMapReferences(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/sourceMappingURL\s*=\s*(\S+)/g)) found.add(m[0]);
  for (const ref of extractHtmlRefs(html)) if (/\.map(?:[?#]|$)/i.test(ref)) found.add(ref);
  return [...found];
}

const DISPLAY_MODES = new Set(['fullscreen', 'standalone', 'minimal-ui', 'browser']);

interface ManifestIcon {
  src?: unknown;
  sizes?: unknown;
}

/** Problems with a parsed manifest.webmanifest; icon files are resolved against dist/. */
export function checkWebManifest(manifest: unknown, exists: (path: string) => boolean): string[] {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return ['manifest.webmanifest is not a JSON object.'];
  }
  const m = manifest as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof m.name !== 'string' || m.name.trim() === '') problems.push('manifest.webmanifest has no name.');
  if (typeof m.start_url !== 'string' || m.start_url === '') {
    problems.push('manifest.webmanifest has no start_url.');
  }
  if (typeof m.display !== 'string' || !DISPLAY_MODES.has(m.display)) {
    problems.push(
      `manifest.webmanifest display is ${JSON.stringify(m.display)}; expected an installable mode.`,
    );
  }
  const icons: ManifestIcon[] = Array.isArray(m.icons) ? (m.icons as ManifestIcon[]) : [];
  if (icons.length === 0) problems.push('manifest.webmanifest lists no icons.');
  const sizes = new Set<string>();
  for (const icon of icons) {
    if (typeof icon.src !== 'string' || icon.src === '') {
      problems.push('manifest.webmanifest has an icon without src.');
      continue;
    }
    if (isExternal(icon.src)) {
      problems.push(`manifest icon ${icon.src} is external; icons must ship with the app.`);
      continue;
    }
    const path = toDistPath(icon.src);
    if (!exists(path)) problems.push(`manifest icon ${icon.src} does not exist at dist/${path}.`);
    if (typeof icon.sizes === 'string') for (const s of icon.sizes.split(/\s+/)) sizes.add(s);
  }
  for (const required of ['192x192', '512x512']) {
    if (icons.length > 0 && !sizes.has(required)) {
      problems.push(`manifest.webmanifest has no ${required} icon (required for installability).`);
    }
  }
  return problems;
}

/** URLs listed in the Workbox precache manifest of a generated sw.js. */
export function parsePrecacheUrls(sw: string): string[] {
  const start = sw.indexOf('precacheAndRoute(');
  if (start < 0) return [];
  const end = sw.indexOf(']', start);
  const body = sw.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/url:\s*["']([^"']+)["']/g)].map((m) => m[1] ?? '').filter((u) => u !== '');
}

/** Secret-pattern hits in one file's text, as readable messages. */
export function findSecrets(path: string, text: string): string[] {
  const hits: string[] = [];
  for (const re of SECRET_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(`${path} matches secret pattern ${String(re)} near "${m[0].slice(0, 40)}".`);
  }
  return hits;
}

/** Human-readable byte count (KiB/MiB, one decimal). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
