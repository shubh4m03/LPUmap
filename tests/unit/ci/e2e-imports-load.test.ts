// @vitest-environment node
/**
 * The Playwright specs run in plain Node, not under Vite: an app module they
 * import must load without `import.meta.env` (and without a DOM). When one did
 * not (src/app/view-mode.ts → the providers entry → runtime.ts reading
 * `import.meta.env.VITE_…`), Playwright failed while loading the files and
 * ran 0 of the suite's tests. This loads every src module the e2e files
 * import, in a separate plain Node process, exactly as Playwright would.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const E2E = join(ROOT, 'tests', 'e2e');
const SRC = join(ROOT, 'src') + sep;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return name.endsWith('.ts') ? [p] : [];
  });
}

/** Every src module named by a relative import or re-export in tests/e2e (type-only ones included). */
function srcModulesImportedByE2e(): string[] {
  const found = new Set<string>();
  for (const file of tsFiles(E2E)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]!);
      if (target.startsWith(SRC)) found.add(target);
    }
  }
  return [...found].sort();
}

describe('e2e specs can load the app modules they import', () => {
  const modules = srcModulesImportedByE2e();

  it('finds the src modules the specs import', () => {
    expect(modules.map((m) => relative(ROOT, m).split(sep).join('/'))).toContain('src/app/view-mode.ts');
  });

  it('loads each of them in plain Node (no Vite, no import.meta.env)', () => {
    const urls = modules.map((m) => pathToFileURL(m).href);
    const script = `
      const failures = [];
      for (const url of ${JSON.stringify(urls)}) {
        try { await import(url); } catch (e) { failures.push(url + ': ' + String(e && e.message || e)); }
      }
      process.stdout.write(JSON.stringify(failures));
    `;
    const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(JSON.parse(out) as string[]).toEqual([]);
  }, 90_000);
});
