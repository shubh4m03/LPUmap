/**
 * The owner's publication layer (GET /api/locations, publication v1 or v2:
 * docs/BUILDING_STUDIO_DESIGN.md §10) as the app loads it.
 *
 * Network-first with a short timeout, like Workbox's NetworkFirst: the
 * request keeps running after the timeout and refreshes the saved copy for
 * the next visit. The last good publication is kept in Cache Storage (it is
 * public data: the schema strips everything that is not part of the public
 * shape, and the endpoint never contains drafts, notes or actors). The
 * service worker never caches /api/ responses itself.
 *
 * Truthful states, never an error screen — the base dataset always works:
 *  - 'live'        fetched now;
 *  - 'saved'       the network failed, timed out or the device is offline, so
 *                  the last saved copy is used (with its date);
 *  - 'unavailable' this host has no API (static hosting: 404/405/501 or an
 *                  HTML fallback page) — base data only, nothing to report;
 *  - 'failed'      the API answered with an error or invalid data and there
 *                  is no saved copy — base data only.
 */
import { publishedStudioBuildingSchema } from '../../building-studio/index.ts';
import {
  publicationSchema,
  publishedLocationSchema,
  publishedOverrideSchema,
  type Publication,
} from '../../community/index.ts';
import { APP_CONFIG } from '../../config/index.ts';
import { publishedArtworkAssociationSchema } from '../../isometric-art/index.ts';

export const PUBLICATION_PATH = '/api/locations';
/** How long startup waits for the network before using the saved copy. */
export const PUBLICATION_TIMEOUT_MS = 3000;
/** A request still running after this is abandoned (it only refreshes the saved copy). */
export const PUBLICATION_HARD_TIMEOUT_MS = 20_000;
export const PUBLICATION_CACHE = `${APP_CONFIG.storage.prefix}-publication-v1`;

import type { PublicationFailure, PublicationStatus } from './publication-status.ts';

export type { PublicationFailure, PublicationStatus } from './publication-status.ts';

export interface PublicationLoad {
  status: PublicationStatus;
  publication: Publication | null;
}

/** Where the last good publication is kept. Every method may fail; failures are ignored. */
export interface PublicationStore {
  read(): Promise<{ savedAt: string; publication: Publication } | null>;
  write(publication: Publication, savedAt: string): Promise<void>;
}

export interface LoadPublicationOptions {
  fetchImpl?: typeof fetch;
  store?: PublicationStore | null;
  timeoutMs?: number;
  hardTimeoutMs?: number;
  /** navigator.onLine (false skips the request: no failed-request noise while offline). */
  online?: () => boolean;
  now?: () => Date;
  url?: string;
}

const savedEnvelope = (v: unknown): { savedAt: string; publication: Publication } | null => {
  if (!v || typeof v !== 'object') return null;
  const { savedAt, publication } = v as { savedAt?: unknown; publication?: unknown };
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return null;
  const parsed = publicationSchema.safeParse(publication);
  return parsed.success ? { savedAt, publication: parsed.data } : null;
};

/** Cache Storage store, or null where Cache Storage is unavailable (old browsers, insecure origins, tests). */
export function cacheStorageStore(): PublicationStore | null {
  if (typeof caches === 'undefined' || typeof location === 'undefined') return null;
  const key = () => new Request(new URL(PUBLICATION_PATH, location.origin).toString());
  return {
    async read() {
      try {
        const cache = await caches.open(PUBLICATION_CACHE);
        const res = await cache.match(key());
        return res ? savedEnvelope(await res.json()) : null;
      } catch {
        return null;
      }
    },
    async write(publication, savedAt) {
      try {
        const cache = await caches.open(PUBLICATION_CACHE);
        await cache.put(
          key(),
          new Response(JSON.stringify({ savedAt, publication }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      } catch {
        // Quota, private mode or a blocked origin: the saved copy is a convenience only.
      }
    },
  };
}

type Outcome =
  { ok: true; publication: Publication } | { ok: false; absent: boolean; reason: PublicationFailure };

/** 404/405/501 or a non-JSON body (an SPA fallback page) mean "this host has no API". */
async function request(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal,
      // Revalidate with the ETag; the public endpoint needs no cookies.
      cache: 'no-cache',
      credentials: 'omit',
      // HTML is accepted (at the lowest weight) so a host without the API answers with its
      // single-page fallback instead of a 404 that the browser would log as an error: the
      // body is then recognised as "no API here". The real endpoint always sends JSON.
      headers: { Accept: 'application/json, text/html;q=0.1' },
    });
  } catch {
    return { ok: false, absent: false, reason: signal.aborted ? 'timeout' : 'network' };
  }
  if (res.status === 404 || res.status === 405 || res.status === 501)
    return { ok: false, absent: true, reason: 'http' };
  if (!res.ok) return { ok: false, absent: false, reason: 'http' };
  const type = res.headers.get('Content-Type') ?? '';
  if (!/\bjson\b/i.test(type)) return { ok: false, absent: true, reason: 'invalid' };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, absent: false, reason: signal.aborted ? 'timeout' : 'invalid' };
  }
  const publication = parsePublication(body);
  return publication ? { ok: true, publication } : { ok: false, absent: false, reason: 'invalid' };
}

const RECORD_SCHEMAS = {
  locations: publishedLocationSchema,
  overrides: publishedOverrideSchema,
  buildings: publishedStudioBuildingSchema,
  // v3: one malformed artwork decision is dropped (its subject falls back to the curated baseline).
  artworkAssociations: publishedArtworkAssociationSchema,
} as const;

/**
 * The public shape of a publication body, or null when the body itself is
 * not a publication (wrong version, missing fields). One record that fails
 * its schema is dropped rather than blanking every other owner update (the
 * server never publishes such a record; the client does not rely on it).
 * Unknown keys are stripped either way.
 */
export function parsePublication(body: unknown): Publication | null {
  const parsed = publicationSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  if (!body || typeof body !== 'object') return null;
  const salvaged: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const [key, schema] of Object.entries(RECORD_SCHEMAS)) {
    const list = salvaged[key];
    if (Array.isArray(list)) salvaged[key] = list.filter((r) => schema.safeParse(r).success);
  }
  const retry = publicationSchema.safeParse(salvaged);
  return retry.success ? retry.data : null;
}

const counts = (p: Publication) => ({
  publicationVersion: p.publicationVersion,
  generatedAt: p.generatedAt,
  buildings: p.buildings?.length ?? 0,
});

/**
 * Loads the publication. Never rejects: every failure becomes a status, and
 * the caller then uses the base dataset (plus a saved copy when there is one).
 */
export async function loadPublication(opts: LoadPublicationOptions = {}): Promise<PublicationLoad> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const store = opts.store === undefined ? cacheStorageStore() : opts.store;
  const now = opts.now ?? (() => new Date());
  const online = opts.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const url = opts.url ?? PUBLICATION_PATH;

  const fromSaved = async (reason: PublicationFailure): Promise<PublicationLoad> => {
    const saved = store ? await store.read() : null;
    if (!saved) return { status: { kind: 'failed', reason }, publication: null };
    return {
      status: { kind: 'saved', ...counts(saved.publication), savedAt: saved.savedAt, reason },
      publication: saved.publication,
    };
  };

  if (!online()) return fromSaved('offline');

  const controller = new AbortController();
  const hard = setTimeout(() => controller.abort(), opts.hardTimeoutMs ?? PUBLICATION_HARD_TIMEOUT_MS);
  const network = request(fetchImpl, url, controller.signal).then(async (outcome) => {
    clearTimeout(hard);
    if (outcome.ok && store) await store.write(outcome.publication, now().toISOString());
    return outcome;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? PUBLICATION_TIMEOUT_MS);
  });
  const first = await Promise.race([network, timeout]);
  clearTimeout(timer);

  // Too slow: use the saved copy now; the request keeps running and refreshes it for next time.
  if (first === 'timeout') return fromSaved('timeout');
  if (first.ok)
    return { status: { kind: 'live', ...counts(first.publication) }, publication: first.publication };
  if (first.absent) return { status: { kind: 'unavailable' }, publication: null };
  return fromSaved(first.reason);
}
