/**
 * docs/SECURITY_AND_PRIVACY.md must describe the site that ships: the CSP it
 * quotes is the one public/_headers sends, and it never claims there is no
 * server (the site has Pages Functions for suggestions, the owner's
 * published updates and /admin).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const directives = (csp: string) =>
  csp
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

describe('docs/SECURITY_AND_PRIVACY.md', () => {
  const doc = read('docs/SECURITY_AND_PRIVACY.md');

  it('quotes exactly the CSP that public/_headers sends', () => {
    const shipped = /Content-Security-Policy:\s*(.+)/.exec(read('public/_headers'))?.[1];
    const quoted = /Content-Security-Policy:([\s\S]*?)\nPermissions-Policy:/.exec(doc)?.[1];
    expect(shipped).toBeDefined();
    expect(quoted).toBeDefined();
    expect(directives(quoted!)).toEqual(directives(shipped!));
  });

  it('does not claim the site has no server or makes no third-party requests', () => {
    expect(doc).not.toMatch(/no backend|there is no server|client-only app|no runtime third-party requests/i);
    expect(doc).toContain('/api/contributions/locations');
  });
});
