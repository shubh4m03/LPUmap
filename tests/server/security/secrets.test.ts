/**
 * Red-team: secrets must never reach the frontend bundle, the repository or
 * server logs. Static scans over the source trees that ship or deploy.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(root, p).replace(/\\/g, '/');
const SOURCE = /\.(ts|tsx|js|mjs|json|toml|sql|html)$/;

/** A PBKDF2 hash literal with a real-looking salt and key, or a long base64 secret assigned to a secret name. */
const HASH_LITERAL = /pbkdf2-sha256\$\d+\$[A-Za-z0-9+/]{16,}={0,2}\$[A-Za-z0-9+/]{40,}={0,2}/;
const SECRET_ASSIGN = /(OWNER_PASSWORD_HASH|RATE_LIMIT_KEY)\s*[:=]\s*["']?[A-Za-z0-9+/_$-]{16,}/;

describe('frontend bundle sources', () => {
  const files = walk(join(root, 'src'), /\.(ts|tsx)$/);

  it('scans a non-trivial tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never import server code (which would pull auth/DB logic into the bundle)', () => {
    const offenders = files.filter((f) =>
      /from\s+['"][./]*(\.\.\/)+server\/|import\(\s*['"][./]*(\.\.\/)+server\//.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('never reference admin secret names or contain hash literals', () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /OWNER_PASSWORD_HASH|RATE_LIMIT_KEY|ACCESS_AUD/.test(text) || HASH_LITERAL.test(text);
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('deployable server sources and config', () => {
  const files = [
    ...walk(join(root, 'server'), SOURCE),
    ...walk(join(root, 'functions'), SOURCE),
    ...walk(join(root, 'migrations'), SOURCE),
    join(root, 'wrangler.toml'),
    join(root, '.dev.vars.example'),
  ];

  it('contain no committed secret values', () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return HASH_LITERAL.test(text) || SECRET_ASSIGN.test(text);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('never write to console except through the scrubbing logger', () => {
    const offenders = walk(join(root, 'server'), /\.ts$/).filter(
      (f) =>
        !rel(f).endsWith('server/http/log.ts') &&
        /console\.(log|info|warn|error|debug)/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('never read process.env (secrets come only from the Pages env binding)', () => {
    const offenders = files.filter((f) => /process\.env/.test(readFileSync(f, 'utf8')));
    expect(offenders.map(rel)).toEqual([]);
  });
});
