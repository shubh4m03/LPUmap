/**
 * The one way data scripts talk to the network (G-08): every request carries
 * the neutral User-Agent below, has a timeout, and is retried a bounded number
 * of times with exponential backoff on network errors, timeouts, HTTP 429 and
 * 5xx. Other HTTP errors are not retried.
 *
 * The User-Agent names the project only. It never carries an e-mail address,
 * account, token or any other personal identifier, and callers cannot override
 * it (see docs/SECURITY_AND_PRIVACY.md, "Incident record").
 */
import { pipeline, Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/** Sent on every scripted request. Neutral: no contact, account or personal id. */
export const RESEARCH_USER_AGENT = 'LPU-Campus-Atlas-research/0.1';
/** robots.txt product token matching RESEARCH_USER_AGENT (RFC 9309 §2.2.1). */
export const ROBOTS_PRODUCT_TOKEN = 'LPU-Campus-Atlas-research';

export interface RetryOptions {
  /** Extra attempts after the first (default 3, so at most 4 requests). */
  retries?: number;
  /** First backoff delay; doubles on every retry (default 2000 ms). */
  baseDelayMs?: number;
  /** Per-attempt limit for a whole text request, or for the response headers of a stream (default 180 s). */
  timeoutMs?: number;
  /** A stream that delivers no bytes for this long is aborted and retried (default 60 s). */
  stallTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const MAX_RETRIES = 5;

export class FetchFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchFailedError';
  }
}

/** An HTTP answer that retrying cannot change (4xx other than 429). */
class PermanentHttpError extends FetchFailedError {}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/** `init` with the research User-Agent forced (a caller-supplied one is replaced, never merged). */
export function politeInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', RESEARCH_USER_AGENT);
  return { ...init, headers };
}

function retriesOf(opts: RetryOptions): number {
  const n = opts.retries ?? 3;
  if (!Number.isInteger(n) || n < 0 || n > MAX_RETRIES)
    throw new RangeError(`retries must be an integer from 0 to ${MAX_RETRIES}`);
  return n;
}

/**
 * Runs `attempt` until it succeeds, a permanent HTTP error occurs, or the
 * retry budget is spent; waits baseDelayMs · 2^(n-1) before retry n.
 */
export async function withRetry<T>(
  label: string,
  attempt: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = retriesOf(opts);
  const sleep = opts.sleep ?? defaultSleep;
  let lastError = '';
  for (let n = 0; n <= retries; n++) {
    if (n > 0) await sleep((opts.baseDelayMs ?? 2000) * 2 ** (n - 1));
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof PermanentHttpError) throw new FetchFailedError(`${label}: ${e.message}`);
      lastError = (e as Error).message;
    }
  }
  throw new FetchFailedError(`${label}: ${lastError} (gave up after ${retries + 1} attempts)`);
}

export interface TextResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  text: string;
}

/**
 * GET/POST returning status, final URL and body. Retries network errors,
 * timeouts, body-read failures, 429 and 5xx; a 4xx is returned as is (with an
 * empty body) so callers such as robots.txt handling can act on it.
 */
export async function fetchResponseWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<TextResponse> {
  return withRetry(
    url,
    async () => {
      const res = await fetchImpl(url, {
        ...politeInit(init),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      });
      if (isRetryableStatus(res.status)) throw new Error(`HTTP ${res.status}`);
      const finalUrl = res.url || url;
      if (!res.ok) return { status: res.status, url: finalUrl, text: '' };
      const text = init.method?.toUpperCase() === 'HEAD' ? '' : await res.text();
      return { status: res.status, url: finalUrl, text };
    },
    opts,
  );
}

/** Like fetchResponseWithRetry, but any non-2xx answer is an error (4xx fails at once). */
export async function fetchTextWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<string> {
  return withRetry(
    url,
    async () => {
      const res = await fetchImpl(url, {
        ...politeInit(init),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      });
      if (isRetryableStatus(res.status)) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new PermanentHttpError(`HTTP ${res.status}`);
      return await res.text();
    },
    opts,
  );
}

/**
 * One streaming GET (no retry: wrap the whole download-and-consume step in
 * withRetry). The response headers must arrive within timeoutMs; afterwards
 * the body is aborted when no bytes arrive for stallTimeoutMs, so a hung
 * connection fails instead of blocking forever.
 */
export async function openStream(
  fetchImpl: typeof fetch,
  url: string,
  opts: RetryOptions = {},
): Promise<Readable> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const stallMs = opts.stallTimeoutMs ?? 60_000;
  const ac = new AbortController();
  const headerTimer = setTimeout(
    () => ac.abort(new Error(`no response headers within ${timeoutMs} ms`)),
    timeoutMs,
  );
  let res: Response;
  try {
    res = await fetchImpl(url, { ...politeInit(), signal: ac.signal });
  } finally {
    clearTimeout(headerTimer);
  }
  if (isRetryableStatus(res.status)) throw new Error(`HTTP ${res.status}`);
  if (!res.ok) throw new PermanentHttpError(`HTTP ${res.status}`);
  if (!res.body) throw new Error('response has no body');
  const body = Readable.fromWeb(res.body as unknown as WebReadableStream);
  // Bytes are timed as they pass through, so nothing flows before the caller starts reading.
  let stall: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => {
      const err = new Error(`download stalled: no data for ${stallMs} ms`);
      ac.abort(err);
      watched.destroy(err);
    }, stallMs);
  };
  const watched = new Transform({
    transform(chunk: Buffer, _enc, done) {
      arm();
      done(null, chunk);
    },
  });
  pipeline(body, watched, () => clearTimeout(stall));
  arm();
  return watched;
}
