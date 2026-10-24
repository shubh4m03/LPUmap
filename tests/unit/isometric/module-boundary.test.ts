/**
 * The overview must work without WebGL and stay a small chunk: it never
 * imports maplibre-gl (directly, or through the map module's runtime code).
 * Only `import type` from src/map is allowed. The studio adapter (studio.ts) is
 * the one file allowed to import the studio schema, and IsoStage must not
 * reach it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = resolve(process.cwd(), 'src/isometric');
const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));
const src = (f: string) => readFileSync(join(DIR, f), 'utf8');
const imports = (code: string) =>
  [...code.matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)';/gm)].map((m) => ({
    typeOnly: Boolean(m[1]),
    from: m[2]!,
  }));

describe('src/isometric import boundary', () => {
  it('never imports maplibre-gl (static or dynamic import)', () => {
    for (const f of files) {
      for (const i of imports(src(f))) expect(i.from).not.toMatch(/maplibre/);
      expect(src(f)).not.toMatch(/import\(\s*['"][^'"]*maplibre/);
    }
  });

  it('imports src/map and src/buildings3d for types only', () => {
    for (const f of files)
      for (const i of imports(src(f)))
        if (/\/(map|buildings3d)\//.test(i.from))
          expect({ file: f, ...i }).toEqual({ file: f, ...i, typeOnly: true });
  });

  it('keeps the studio schema out of the overview graph (only studio.ts imports it at runtime)', () => {
    for (const f of files) {
      if (f === 'studio.ts') continue;
      for (const i of imports(src(f))) {
        if (i.from.includes('building-studio/schema') || i.from.includes('building-studio/mesh/generate'))
          expect({ file: f, ...i }).toEqual({ file: f, ...i, typeOnly: true });
        expect(i.from).not.toMatch(/\.\/studio\.ts$/);
      }
    }
  });
});
