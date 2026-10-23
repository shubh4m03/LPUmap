/**
 * POST /api/contributions/locations — public location suggestions.
 *
 * A submission can never publish itself: the body is re-validated with the
 * shared schema (unknown keys such as status/approved/isAdmin/reviewer are
 * stripped), the domain always stores status 'pending', and the response
 * says so truthfully. A filled honeypot gets a decoy 202 of the same shape
 * and nothing — not even a rate-limit counter — is written.
 */
import { APP_CONFIG } from '../../src/config/index.ts';
import { LIMITS, contributionInputSchema } from '../../src/community/schema.ts';
import type { ContributionResponse } from '../../src/community/schema.ts';
import { insideContributionArea } from '../../src/community/geo.ts';
import { enforceRateLimits } from '../auth/rate-limit.ts';
import type { RateRule } from '../auth/rate-limit.ts';
import { parseEnv } from '../env.ts';
import { randomIds } from '../ids.ts';
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

function honeypotFilled(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = (raw as { website?: unknown }).website;
  return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
}

export async function handleContribution(request: Request, deps: HandlerDeps): Promise<Response> {
  const started = Date.now();
  let res: Response;
  try {
    if (request.method !== 'POST') throw methodNotAllowed(['POST']);
    const env = parseEnv(deps.env);
    if (!env.db) throw new HttpError('unavailable', 'Suggestions are temporarily unavailable');
    const db = env.db;
    checkSameOrigin(request, env.publicOrigin, { requireOrigin: false });
    const raw = await readJsonBody(request, LIMITS.publicBodyBytes);

    if (honeypotFilled(raw)) {
      const decoy: ContributionResponse = {
        reference: randomIds.next('suggestion'),
        status: 'pending',
        message: PENDING_MESSAGE,
        possibleDuplicates: [],
      };
      res = json(decoy, { status: 202, cache: 'no-store' });
    } else {
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
