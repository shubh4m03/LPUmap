/**
 * Per-call context for domain operations. The HTTP layer builds it after
 * authentication: `actor` is the verified owner identity (never read from the
 * request body), `now` is the server clock, `base` the loaded base dataset.
 */
import type { BaseData } from '../base-data.ts';
import { fail } from '../errors.ts';
import { randomIds, type IdGenerator } from '../ids.ts';

export interface DomainContext {
  now: Date;
  /** Authenticated actor (Access email or 'owner'). Required for privileged operations. */
  actor?: string;
  base: BaseData;
  /** Injected for deterministic tests; defaults to crypto-random ids. */
  ids?: IdGenerator;
}

/** Actor recorded for anonymous public submissions. */
export const PUBLIC_ACTOR = 'public';

export function requireActor(ctx: Pick<DomainContext, 'actor'>): string {
  const actor = ctx.actor?.trim();
  if (!actor || actor === PUBLIC_ACTOR) return fail('unauthenticated', 'Sign in as the owner to do this.');
  return actor;
}

export const idsOf = (ctx: DomainContext): IdGenerator => ctx.ids ?? randomIds;
export const isoNow = (ctx: Pick<DomainContext, 'now'>): string => ctx.now.toISOString();
