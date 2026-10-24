/**
 * Guards around third-party imagery: the CSP allows exactly the provider
 * origins (and nothing else changes), the service worker never precaches or
 * runtime-caches them, no key is committed, and the privacy text is true for
 * each configuration.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRECACHE_GLOBS, pwaOptions } from '../../../src/offline/pwa-config.ts';
import { parseProviderEnv } from '../../../src/map/providers/config.ts';
import { createProviderRegistry, IMAGERY_ORIGINS } from '../../../src/map/providers/registry.ts';
import { imageryPrivacyFact, privacyFacts } from '../../../src/privacy/privacy-facts.ts';

const root = process.cwd();

function csp(): Map<string, string[]> {
  const headers = readFileSync(join(root, 'public', '_headers'), 'utf8');
  const line = /Content-Security-Policy: (.+)/.exec(headers)?.[1] ?? '';
  return new Map(
    line
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...values]) => [name!, values]),
  );
}

describe('CSP (public/_headers)', () => {
  it('connect-src is self plus exactly the imagery provider origins', () => {
    expect(csp().get('connect-src')).toEqual(["'self'", ...IMAGERY_ORIGINS]);
    expect(IMAGERY_ORIGINS).toEqual(['https://ibasemaps-api.arcgis.com', 'https://tiles.maps.eox.at']);
  });

  it('every other directive is unchanged (no third-party script, image, style, font or frame source)', () => {
    const p = csp();
    expect(p.get('default-src')).toEqual(["'self'"]);
    expect(p.get('script-src')).toEqual(["'self'"]);
    // MapLibre fetches raster tiles (refreshExpiredTiles defaults to true), so img-src needs no host.
    expect(p.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(p.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(p.get('font-src')).toEqual(["'self'"]);
    expect(p.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(p.get('frame-ancestors')).toEqual(["'none'"]);
    expect(p.get('object-src')).toEqual(["'none'"]);
    for (const [name, values] of p)
      if (name !== 'connect-src')
        for (const v of values) expect(v, `${name} ${v}`).not.toMatch(/arcgis|eox|google/);
  });

  it('the app never disables refreshExpiredTiles (which would move tiles to <img> and img-src)', () => {
    const src = readFileSync(join(root, 'src', 'map', 'MapView.tsx'), 'utf8');
    expect(src).not.toContain('refreshExpiredTiles');
  });
});

describe('PWA never stores third-party tiles', () => {
  const workbox = pwaOptions.workbox;

  it('has no runtime caching route at all', () => {
    expect(workbox?.runtimeCaching ?? []).toEqual([]);
  });

  it('no precache glob or extra manifest entry can match a provider origin or tile path', () => {
    for (const glob of PRECACHE_GLOBS) {
      expect(glob).not.toMatch(/arcgis|eox|https?:|\/\//);
      expect(glob).not.toMatch(/tile/i);
    }
    const extra = JSON.stringify(workbox?.additionalManifestEntries ?? []);
    for (const origin of IMAGERY_ORIGINS) expect(extra).not.toContain(new URL(origin).host);
    expect(JSON.stringify(pwaOptions.includeAssets ?? [])).not.toMatch(/arcgis|eox/);
  });
});

describe('no key in the repository', () => {
  /** Files that could end up in git (the .env.local of a developer is git-ignored). */
  const scanDirs = ['src', 'public', 'docs', 'tests', 'scripts', 'functions', 'server'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|json|md|toml|txt|html|css|example)$/.test(name) && st.size < 2_000_000)
        files.push(p);
    }
  };
  for (const d of scanDirs) {
    try {
      walk(join(root, d));
    } catch {
      // Directory absent in this checkout.
    }
  }
  files.push(join(root, '.env.example'));

  it('contains no ArcGIS API key (they start with "AAPT"/"AAPK") and no token in a tile URL', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(/\bAAP[TK][A-Za-z0-9_-]{40,}/.test(text), f).toBe(false);
      expect(/[?&]token=(?!\$\{|TEST_ONLY_|YOUR_|KEY\b|<)[A-Za-z0-9_.-]{40,}/.test(text), f).toBe(false);
    }
  });

  it('.env.example documents the variables with empty values', () => {
    const env = readFileSync(join(root, '.env.example'), 'utf8');
    expect(env).toMatch(/^VITE_ARCGIS_API_KEY=$/m);
    expect(env).toMatch(/^VITE_EOX_BACKDROP=$/m);
  });
});

describe('privacy text per configuration', () => {
  const FAKE = 'TEST_ONLY_fake_arcgis_key_0123456789abcdef';
  const text = (env: Parameters<typeof parseProviderEnv>[0]) =>
    privacyFacts(createProviderRegistry(parseProviderEnv(env)))
      .map((f) => `${f.title} ${f.detail}`)
      .join(' ');

  it('without imagery: unchanged, no third party named', () => {
    expect(imageryPrivacyFact(createProviderRegistry(parseProviderEnv({})))).toBeNull();
    const t = text({});
    expect(t).toContain('It only downloads its own files');
    expect(t).not.toMatch(/esri|eox|arcgis/i);
  });

  it('with Esri: names the provider and host, what it receives, and which modes', () => {
    const t = text({ VITE_ARCGIS_API_KEY: FAKE });
    expect(t).toContain('Satellite imagery comes from Esri World Imagery');
    expect(t).toContain('ibasemaps-api.arcgis.com');
    expect(t).toContain('IP address');
    expect(t).toContain('Campus 3D');
    expect(t).toContain('never stored for offline use');
    expect(t).toContain('roughly where you are');
    expect(t).not.toContain('It only downloads its own files');
    expect(t).toContain('Apart from satellite imagery (below), it only downloads its own files');
    expect(t).not.toContain(FAKE);
  });

  it('with only the EOX backdrop: Satellite 2D only', () => {
    const fact = imageryPrivacyFact(createProviderRegistry(parseProviderEnv({ VITE_EOX_BACKDROP: 'true' })));
    expect(fact?.detail).toContain('tiles.maps.eox.at');
    expect(fact?.detail).toContain('In Satellite 2D, your browser');
    expect(fact?.detail).not.toContain('Campus 3D (which');
  });
});
