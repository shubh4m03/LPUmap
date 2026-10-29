/**
 * POST /api/contributions/locations as one typed outcome. "Submitted" is
 * reported ONLY when the server answered with the documented pending
 * response; every other answer says what happened and whether anything may
 * have been stored (a network failure after sending: unknown).
 */
import {
  apiErrorSchema,
  contributionResponseSchema,
  type ContributionInput,
  type DuplicateCandidate,
} from '../../community/index.ts';

export const CONTRIBUTION_PATH = '/api/contributions/locations';

export type SubmitOutcome =
  | { kind: 'submitted'; reference: string; message: string; possibleDuplicates: DuplicateCandidate[] }
  | { kind: 'rate-limited'; retryAfterS: number | null }
  | { kind: 'invalid'; issues: Array<{ path: string; message: string }> }
  | { kind: 'outside-area' }
  | { kind: 'too-large' }
  | { kind: 'refused' }
  /** This deployment has no suggestions API (static hosting / local preview). */
  | { kind: 'no-api' }
  /** The API exists but is switched off or its database is down. */
  | { kind: 'unavailable' }
  /** Sent, but no usable answer: it is not known whether it was stored. */
  | { kind: 'unknown' };

export type SubmitFetch = (input: string, init: RequestInit) => Promise<Response>;

const isJson = (res: Response) =>
  /^application\/(?:[\w.+-]+\+)?json\b/i.test(res.headers.get('Content-Type') ?? '');

async function body(res: Response): Promise<unknown> {
  if (!isJson(res)) return null;
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export async function submitSuggestion(
  input: ContributionInput,
  opts: { fetch?: SubmitFetch; signal?: AbortSignal } = {},
): Promise<SubmitOutcome> {
  const doFetch: SubmitFetch = opts.fetch ?? ((u, i) => globalThis.fetch(u, i));
  let res: Response;
  try {
    res = await doFetch(CONTRIBUTION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal ?? null,
    });
  } catch {
    return { kind: 'unknown' };
  }
  const data = await body(res);
  if (res.status === 201 || res.status === 202) {
    const ok = contributionResponseSchema.safeParse(data);
    return ok.success
      ? {
          kind: 'submitted',
          reference: ok.data.reference,
          message: ok.data.message,
          possibleDuplicates: ok.data.possibleDuplicates,
        }
      : { kind: 'unknown' };
  }
  if (res.status >= 200 && res.status < 300) return { kind: 'unknown' };
  const problem = apiErrorSchema.safeParse(data);
  const code = problem.success ? problem.data.error.code : null;
  if (res.status === 429 || code === 'rate-limited') {
    const header = Number(res.headers.get('Retry-After'));
    const fromBody = problem.success ? (problem.data.error.retryAfterS ?? null) : null;
    return {
      kind: 'rate-limited',
      retryAfterS: fromBody ?? (Number.isFinite(header) && header > 0 ? Math.ceil(header) : null),
    };
  }
  if (code === 'outside-area') return { kind: 'outside-area' };
  if (res.status === 413 || code === 'too-large') return { kind: 'too-large' };
  if (code === 'csrf') return { kind: 'refused' };
  if (res.status === 400 && problem.success)
    return { kind: 'invalid', issues: problem.data.error.issues ?? [] };
  if (res.status === 503) return { kind: 'unavailable' };
  // No API on this host: 404/405/501, or an HTML page from static hosting.
  if (res.status === 404 || res.status === 405 || res.status === 501 || !problem.success)
    return { kind: 'no-api' };
  return { kind: 'unknown' };
}

/** Wait text for a rate limit ("about 3 minutes"). */
export function waitText(seconds: number | null): string {
  if (seconds === null) return 'a while';
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}
