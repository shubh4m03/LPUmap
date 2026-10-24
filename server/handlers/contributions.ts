/**
 * POST /api/contributions/locations — public location suggestions.
 *
 * A submission can never publish itself: the body is re-validated with the
 * shared schema (unknown keys such as status/approved/isAdmin/reviewer are
 * stripped), the domain always stores status 'pending', and the response
 * says so truthfully. A filled honeypot gets a decoy that a client cannot tell
 * from a real acceptance — same validation errors, same 201 status, headers
 * and body shape, a `sug_` reference of the same format, and the same read
 * work (base data and duplicate lookup) so the timing is similar — while
 * nothing, not even a rate-limit counter, is written.
 */
import { APP_CONFIG } from '../../src/config/index.ts';
import { LIMITS, contributionInputSchema } from '../../src/community/schema.ts';
import type { ContributionResponse } from '../../src/community/schema.ts';
import { insideContributionArea } from '../../src/community/geo.ts';
import { enforceRateLimits } from '../auth/rate-limit.ts';
import type { RateRule } from '../auth/rate-limit.ts';
import { parseEnv } from '../env.ts';
import { parseWith, readJsonBody } from '../http/body.ts';
import { HttpError } from '../http/errors.ts';
import { log } from '../http/log.ts';
import { checkSameOrigin } from '../http/origin.ts';
import { errorResponse, json, methodNotAllowed } from '../http/response.ts';
import { loadBaseFor, nowOf } from './deps.ts';
import type { HandlerDeps } from './deps.ts';

export const PENDING_MESSAGE =
  'Your location suggestion has been submitted for review. It will not appear on the public map until it is approved.';

const ROUTE = '/api/contributions/locations';

export function contributionRateRules(): RateRule[] {
  const r = APP_CONFIG.contributions.rateLimit;
  return [
    { scope: 'contrib:window', limit: r.perWindow, windowS: r.windowMinutes * 60 },
    { scope: 'contrib:day', limit: r.perDay, windowS: 86_400 },
    { scope: 'contrib:global', limit: r.globalPerDay, windowS: 86_400, global: true },
  ];
}

/**
 * Decoy timing. A real acceptance also writes (rate-limit rows, the suggestion
 * and its audit event), so a decoy that only reads would answer measurably
 * faster. The decoy therefore waits until about as long as recent real
 * acceptances took. The estimate lives in this isolate's memory only: it is
 * never stored, logged or sent, and it holds no request data.
 */
export const DECOY_TIMING = {
  /** Estimate before any real acceptance was seen in this isolate. */
  initialMs: 60,
  /** Never hold a decoy longer than this. */
  maxMs: 2_000,
  /** Weight of the newest real sample in the moving average. */
  alpha: 0.2,
  /** The target is the estimate times a uniform factor in [1 - jitter, 1 + jitter]. */
  jitter: 0.15,
} as const;

let realAcceptMs: number = DECOY_TIMING.initialMs;

/** Test hook: forget the latency estimate. */
export function resetDecoyTiming(): void {
  realAcceptMs = DECOY_TIMING.initialMs;
}

function recordRealAcceptance(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  realAcceptMs = realAcceptMs + DECOY_TIMING.alpha * (Math.min(ms, DECOY_TIMING.maxMs) - realAcceptMs);
}

/** How much longer a decoy that has run for `elapsedMs` should wait (`unit` in [0, 1)). */
export function decoyWaitMs(elapsedMs: number, unit: number = Math.random()): number {
  const factor = 1 - DECOY_TIMING.jitter + 2 * DECOY_TIMING.jitter * unit;
  const target = Math.min(DECOY_TIMING.maxMs, realAcceptMs * factor);
  return Math.max(0, Math.round(target - elapsedMs));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function honeypotFilled(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = (raw as { website?: unknown }).website;
  return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

export async function handleContribution(request: Request, deps: HandlerDeps): Promise<Response> {
  const started = Date.now();
  const startedPrecise = performance.now();
  let res: Response;
  try {
    if (request.method !== 'POST') throw methodNotAllowed(['POST']);
    const env = parseEnv(deps.env);
    if (!env.db) throw new HttpError('unavailable', 'Suggestions are temporarily unavailable');
    const db = env.db;
    checkSameOrigin(request, env.publicOrigin, { requireOrigin: false });
    const raw = await readJsonBody(request, LIMITS.publicBodyBytes);
    const parsed = parseWith(contributionInputSchema, raw, 'Suggestion');
    // Rebuild from known fields only: nothing client-supplied beyond the contract reaches the domain.
    const input = {
      name: parsed.name,
      categoryId: parsed.categoryId,
      location: parsed.location,
      description: parsed.description,
      landmark: parsed.landmark,
      evidenceUrl: parsed.evidenceUrl,
      details: parsed.details,
    };
    if (!insideContributionArea(input.location)) {
      throw new HttpError('outside-area', 'The location must be on or near the LPU campus.');
    }

    if (honeypotFilled(raw)) {
      // Decoy: the same validation, base load, duplicate lookup, id format, status and body as a
      // real submission, but nothing is written (no suggestion, audit event or rate-limit row).
      const now = nowOf(deps);
      const base = await loadBaseFor(request, env, deps);
      const decoy = await deps.services.domain.decoySuggestion(db, input, { now, base });
      const body: ContributionResponse = {
        reference: decoy.reference,
        status: 'pending',
        message: PENDING_MESSAGE,
        possibleDuplicates: decoy.possibleDuplicates,
      };
      const wait = decoyWaitMs(performance.now() - startedPrecise);
      if (wait > 0) await sleep(wait);
      res = json(body, { status: 201, cache: 'no-store' });
    } else {
      const now = nowOf(deps);
      await enforceRateLimits(request, contributionRateRules(), {
        db,
        repo: deps.services.rateLimits,
        salts: deps.services.salts,
        rateLimitKey: env.rateLimitKey,
        now,
      });
      const base = await loadBaseFor(request, env, deps);
      const created = await deps.services.domain.createSuggestion(db, input, { now, base });
      const body: ContributionResponse = {
        reference: created.reference,
        status: 'pending',
        message: PENDING_MESSAGE,
        possibleDuplicates: created.possibleDuplicates,
      };
      res = json(body, { status: 201, cache: 'no-store' });
      recordRealAcceptance(performance.now() - startedPrecise);
    }
  } catch (err) {
    res = errorResponse(err, { cache: 'no-store', route: ROUTE, method: request.method });
  }
  log('info', {
    event: 'request',
    method: request.method,
    route: ROUTE,
    status: res.status,
    ms: Date.now() - started,
  });
  return res;
}
