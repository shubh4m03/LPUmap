// @vitest-environment node
/**
 * The documentation describes the system that ships (audit items G-01, G-04,
 * G-11, G-16):
 *
 * - every relative link and heading anchor in the docs resolves;
 * - every browser storage key and cache name the code writes is in the
 *   storage inventory of docs/SECURITY_AND_PRIVACY.md;
 * - every `?place=` id prefix and `?view=` value the app accepts is in its
 *   threat model;
 * - the gate lists in README.md and docs/DEPLOYMENT.md are `npm run check`;
 * - the bundle budgets in docs/PERFORMANCE.md are the enforced ones;
 * - docs/ACCEPTANCE_REPORT.md covers every master-spec part.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLE_BUDGETS } from '../../../scripts/perf/bundle-budget.ts';
import { viewModeToParam, VIEW_MODE_OPTIONS } from '../../../src/app/view-mode.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const stripCode = (s: string) => s.replace(/```[\s\S]*?```/g, '');

function markdownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.md')) out.push(p);
    }
  };
  walk(join(root, 'docs'));
  out.push(join(root, 'README.md'), join(root, 'CONTRIBUTING.md'), join(root, 'data/README.md'));
  return out;
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens, -1/-2 for repeats. */
function anchors(file: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  for (const m of stripCode(readFileSync(file, 'utf8')).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = m[1]!
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

describe('links in the documentation', () => {
  const files = markdownFiles();

  it('every relative link points to an existing file, and every anchor to an existing heading', () => {
    const broken: string[] = [];
    for (const f of files) {
      for (const m of stripCode(readFileSync(f, 'utf8')).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1]!;
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [path, frag] = target.split('#') as [string, string | undefined];
        const file = path === '' ? f : resolve(dirname(f), decodeURIComponent(path));
        const where = `${relative(root, f)} → ${target}`;
        if (!existsSync(file)) broken.push(`${where} (no such file)`);
        else if (frag && file.endsWith('.md') && !anchors(file).has(decodeURIComponent(frag)))
          broken.push(`${where} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('docs/SECURITY_AND_PRIVACY.md', () => {
  const doc = read('docs/SECURITY_AND_PRIVACY.md');

  it('lists every storage key and cache name the code writes', () => {
    const keys = new Set<string>();
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n)) {
          const text = readFileSync(p, 'utf8');
          for (const m of text.matchAll(/createStorage\(\s*'([^']+)'/g))
            keys.add(`${APP_CONFIG.storage.prefix}:v${APP_CONFIG.storage.version}:${m[1]}`);
          for (const m of text.matchAll(/`\$\{APP_CONFIG\.storage\.prefix\}([^`]*)`/g))
            keys.add(
              `${APP_CONFIG.storage.prefix}${m[1]!.replace('${APP_CONFIG.storage.version}', String(APP_CONFIG.storage.version))}`,
            );
        }
      }
    };
    walk(join(root, 'src'));
    expect(keys.size).toBeGreaterThanOrEqual(7);
    const missing = [...keys].filter((k) => !doc.includes(`\`${k}`));
    expect(missing).toEqual([]);
  });

  it('names every place-id prefix and view value that deep links accept', () => {
    const source = read('src/app/deep-link.ts');
    const grammar = [
      /const PLACE_ID_RE =\s*\n?\s*\/(.+)\/;/.exec(source)?.[1],
      /export const ARTWORK_ID_RE = \/(.+)\/;/.exec(source)?.[1],
    ].join(' ');
    const prefixes = new Set([...grammar.matchAll(/([a-z]{3}):/g)].map((m) => `${m[1]}:`));
    for (const m of grammar.matchAll(/\(([a-z]{3}(?:\|[a-z]{3})+)\):/g))
      for (const p of m[1]!.split('|')) prefixes.add(`${p}:`);
    expect(prefixes).toEqual(new Set(['osm:', 'cur:', 'own:', 'com:', 'stu:', 'art:']));
    const row = doc.split('\n').find((l) => l.includes('Deep-link injection')) ?? '';
    for (const p of prefixes) expect(row, `prefix ${p}`).toContain(`\`${p}`);
    for (const mode of VIEW_MODE_OPTIONS)
      expect(row, `view ${mode}`).toContain(`\`${viewModeToParam(mode)}\``);
  });
});

describe('gate lists match `npm run check`', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const gates = scripts.check!.split('&&').map((s) => s.trim().replace(/^npm run (-s )?/, ''));

  it('README.md Testing table', () => {
    const row = read('README.md')
      .split('\n')
      .find((l) => l.startsWith('| `npm run check`'));
    const listed = [...(row?.split('The full gate:')[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(listed).toEqual(gates);
  });

  it('docs/DEPLOYMENT.md §Before deploying', () => {
    const text = read('docs/DEPLOYMENT.md').replace(/\s+/g, ' ');
    const list = /`npm run check` runs, in this order: ([^.]+)\./.exec(text)?.[1] ?? '';
    expect(list.split('→').map((s) => s.trim())).toEqual(gates);
  });
});

describe('docs/PERFORMANCE.md bundle budgets', () => {
  it('quote exactly the limits that scripts/perf/bundle-budget.ts enforces', () => {
    const doc = read('docs/PERFORMANCE.md');
    for (const [key, value] of Object.entries(BUNDLE_BUDGETS)) {
      const row = doc.split('\n').find((l) => l.startsWith('|') && l.includes(`\`${key}\``));
      expect(row, `a table row for ${key}`).toBeDefined();
      expect(row).toContain(`${value.toLocaleString('en-US')} B`);
    }
  });
});

describe('docs/ACCEPTANCE_REPORT.md', () => {
  it('reports every master-spec part (P1–P22) and the owner specs with a verdict', () => {
    const doc = read('docs/ACCEPTANCE_REPORT.md');
    for (let n = 1; n <= 22; n++) expect(doc, `Part ${n}`).toMatch(new RegExp(`^### P${n}\\b`, 'm'));
    for (const spec of ['Owner spec A', 'Owner spec B', 'Owner spec C', 'Artwork integration'])
      expect(doc).toContain(spec);
    expect(doc).toMatch(/\bPASS\b/);
    expect(doc).toMatch(/\bPARTIAL\b/);
    expect(doc).toMatch(/\bNOT TESTABLE\b/);
  });
});
