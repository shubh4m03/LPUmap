/**
 * Turning imagery errors into a ProviderFailure (auth / quota / network), so
 * the app can fall back to the campus map with a truthful reason.
 *
 * Measured 2026-10-24 (bodies discarded, nothing stored): the Esri tile
 * endpoint answers a request WITHOUT a token with HTTP 200 `text/plain`
 * ("Token Required" JSON), not 401 — so a tile that cannot be decoded as an
 * image counts as an auth failure for a keyed provider. A malformed token was
 * not rejected at all, so a bad key may only show up as tile errors later.
 * MapLibre never fires an error for a 404 tile (it just leaves a hole).
 *
 * Nothing here logs or returns a URL: tile URLs carry the key.
 */
import type { ProviderFailure } from './types.ts';

/** The fields of a MapLibre tile error we read (AJAXError has `status`). */
export interface TileErrorLike {
  status?: number;
  name?: string;
  message?: string;
}

const AUTH_STATUS = new Set([401, 403, 498, 499]);

export function classifyImageryError(
  error: TileErrorLike | null | undefined,
  opts: { requiresKey: boolean; online: boolean },
): ProviderFailure {
  if (!opts.online) return 'network';
  const status = typeof error?.status === 'number' ? error.status : null;
  if (status !== null && AUTH_STATUS.has(status)) return 'auth';
  if (status === 429) return 'quota';
  if (status !== null && status !== 0) return 'network';
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  // The response was not an image (e.g. an error message with status 200).
  const notAnImage = /could not load image|decode|InvalidStateError|EncodingError|unsupported image/i.test(
    text,
  );
  if (notAnImage) return opts.requiresKey ? 'auth' : 'network';
  return 'network';
}

/**
 * ArcGIS REST errors come back as `{error:{code}}`, often with HTTP 200:
 * 498 invalid/expired token, 499 token required, 403 not permitted.
 */
export function classifyProbeResponse(status: number, body: unknown): ProviderFailure | null {
  if (AUTH_STATUS.has(status)) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 500) return 'network';
  const code =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown } }).error?.code
      : undefined;
  if (typeof code === 'number') {
    if (AUTH_STATUS.has(code)) return 'auth';
    if (code === 429) return 'quota';
  }
  return null;
}

/**
 * One metadata request (no imagery) before the first tiles: catches a missing,
 * revoked or expired key early. Network trouble is reported as 'network'.
 */
export async function probeImagery(
  url: string,
  opts: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ProviderFailure | null> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { signal: opts.signal, credentials: 'omit', cache: 'no-store' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return 'network';
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return classifyProbeResponse(res.status, body);
}

/**
 * Debounces transient tile trouble: auth and quota fail at once; network
 * errors fail after `networkThreshold` errors with no tile loading in between
 * (one dropped tile on a flaky connection is not worth leaving the mode).
 */
export class ImageryHealth {
  private networkErrors = 0;
  private failed: ProviderFailure | null = null;
  private readonly networkThreshold: number;

  constructor(opts: { networkThreshold?: number } = {}) {
    this.networkThreshold = opts.networkThreshold ?? 4;
  }

  /** A tile loaded: the provider works. */
  tileLoaded(): void {
    this.networkErrors = 0;
  }

  /** Records an error; returns the failure once the provider should be given up, else null. */
  tileError(failure: ProviderFailure): ProviderFailure | null {
    if (this.failed) return null;
    if (failure === 'network') {
      this.networkErrors += 1;
      if (this.networkErrors < this.networkThreshold) return null;
    }
    this.failed = failure;
    return failure;
  }

  reset(): void {
    this.networkErrors = 0;
    this.failed = null;
  }
}
