import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Parses Cloudflare Pages `_headers`: a path line, then indented `Name: value` lines. */
function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const m = /^\s+([^:]+):\s*(.*)$/.exec(line);
    if (m && current) current.set(m[1]!.toLowerCase(), m[2]!);
  }
  return rules;
}

const rules = parseHeaders(readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8'));

// G-16: the owner admin and the API must never be indexed.
describe('public/_headers: X-Robots-Tag for /admin and /api', () => {
  for (const path of ['/admin', '/admin/*', '/api/*']) {
    it(`${path} is noindex`, () => {
      expect(rules.get(path)?.get('x-robots-tag')).toMatch(/\bnoindex\b/);
    });
  }

  it('the public app itself stays indexable', () => {
    for (const path of ['/*', '/', '/index.html'])
      expect(rules.get(path)?.get('x-robots-tag')).toBeUndefined();
  });
});
