/**
 * E2E test backend: the production build (static files) plus the REAL server
 * handlers (server/handlers/**, the same code the Pages Functions run) on one
 * origin, over a fresh, non-persistent local D1 database (wrangler
 * getPlatformProxy, migrations/NNNN_*.sql applied in order).
 *
 *   node tests/e2e/backend/server.ts            (Playwright starts it as a webServer)
 *
 * Environment:
 *   E2E_BACKEND_PORT          port (default 4431; never 4410)
 *   E2E_DIST                  build directory to serve (default ./dist)
 *   ATLAS_E2E_ADMIN_PASSWORD  throwaway owner password (password mode); required
 *
 * Nothing here is mocked: suggestions, moderation, locations, overrides and
 * the audit log are written to and read from D1 by the server's own code. The
 * only test-specific behaviour is that the `x-e2e-client` request header
 * becomes CF-Connecting-IP (which Cloudflare's edge sets in production), so
 * each test is its own rate-limit client. The database lives in memory and is
 * gone when the process exits; no remote database is ever contacted.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { hashPassword } from '../../../server/auth/password.ts';
import type { SqlDatabase } from '../../../server/db/types.ts';
import type { Env } from '../../../server/env.ts';
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { handleContribution } from '../../../server/handlers/contributions.ts';
import { handleHealth } from '../../../server/handlers/health.ts';
import { run, type Handler } from '../../../server/handlers/pages.ts';
import { handlePublication } from '../../../server/handlers/publication.ts';
import { applyMigrations } from '../../server/helpers/test-db.ts';
import { ADMIN_PASSWORD_ENV, BACKEND_PORT, CLIENT_HEADER } from './config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const dist = resolve(root, process.env.E2E_DIST ?? 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pbf': 'application/x-protobuf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

/** A file under dist (never outside it), or null. */
function distFile(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const full = normalize(join(dist, decoded));
  if (full !== dist && !full.startsWith(dist + sep)) return null;
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

function fileResponse(file: string): Response {
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  return new Response(readFileSync(file), {
    status: 200,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' },
  });
}

/** Static hosting like Cloudflare Pages: files as-is, extensionless paths → the SPA's index.html. */
function serveStatic(url: URL): Response {
  const file = distFile(url.pathname === '/' ? '/index.html' : url.pathname);
  if (file) return fileResponse(file);
  if (extname(url.pathname) === '') {
    const index = distFile('/index.html');
    if (index) return fileResponse(index);
  }
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}

const ROUTES: Array<[RegExp, Handler]> = [
  [/^\/api\/health$/, handleHealth],
  [/^\/api\/locations$/, handlePublication],
  [/^\/api\/contributions\/locations$/, handleContribution],
  [/^\/api\/admin(\/.*)?$/, handleAdmin],
];

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host ?? `localhost:${BACKEND_PORT}`}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k.startsWith(':')) continue;
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else headers.set(k, v);
  }
  // Emulates Cloudflare's edge: the client address the rate limiter keys on.
  const client = headers.get(CLIENT_HEADER);
  headers.delete(CLIENT_HEADER);
  headers.set('CF-Connecting-IP', client && /^[0-9a-f.:]{1,45}$/i.test(client) ? client : '127.0.0.1');
  const method = req.method ?? 'GET';
  let body: Buffer | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method, headers, body: body ? new Uint8Array(body) : null, redirect: 'manual' });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const cookies = response.headers.getSetCookie();
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') headers[k] = v;
  });
  if (cookies.length > 0) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function main(): Promise<void> {
  const password = process.env[ADMIN_PASSWORD_ENV];
  if (!password || password.length < 12) {
    throw new Error(`${ADMIN_PASSWORD_ENV} must be set (at least 12 characters).`);
  }
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`No build at ${dist}: run \`npx vite build\` (or set E2E_DIST) first.`);
  }
  const proxy = await getPlatformProxy<{ DB: SqlDatabase }>({
    configPath: join(here, 'wrangler.e2e.toml'),
    persist: false,
  });
  const db = proxy.env.DB;
  await applyMigrations(db);

  const env: Env = {
    DB: db,
    ASSETS: {
      async fetch(input: Request | string) {
        const url = new URL(typeof input === 'string' ? input : input.url);
        return serveStatic(url);
      },
    },
    AUTH_MODE: 'password',
    OWNER_PASSWORD_HASH: await hashPassword(password),
    RATE_LIMIT_KEY: randomBytes(32).toString('base64url'),
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = await toRequest(req);
        const { pathname } = new URL(request.url);
        const route = ROUTES.find(([re]) => re.test(pathname));
        const response = route ? await run(route[1], { request, env }) : serveStatic(new URL(request.url));
        await send(res, response);
      } catch (err) {
        console.error('[e2e-backend]', err instanceof Error ? err.message : err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal error');
      }
    })();
  });

  const shutdown = () => {
    server.close();
    void proxy.dispose().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(BACKEND_PORT, 'localhost', () => {
    console.log(`[e2e-backend] http://localhost:${BACKEND_PORT} (dist: ${dist}; local in-memory D1)`);
  });
}

main().catch((err: unknown) => {
  console.error('[e2e-backend] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
