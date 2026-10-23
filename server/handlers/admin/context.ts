/** Per-request context handed to admin route handlers. */
import type { z } from 'zod';
import { LIMITS } from '../../../src/community/schema.ts';
import type { Actor, Permission } from '../../auth/authorize.ts';
import type { SqlDatabase } from '../../db/types.ts';
import type { ParsedEnv } from '../../env.ts';
import { parseWith, readJsonBody } from '../../http/body.ts';
import type { Params, Route } from '../../http/router.ts';
import { loadBaseFor } from '../deps.ts';
import type { HandlerDeps } from '../deps.ts';
import type { DomainCtx, DomainPort } from '../ports.ts';
import { queryObject } from './schemas.ts';

export interface AdminCtxInit {
  request: Request;
  params: Params;
  env: ParsedEnv;
  db: SqlDatabase;
  deps: HandlerDeps;
  now: Date;
  /** null only for the public login route. */
  actor: Actor | null;
}

export class AdminCtx {
  readonly request: Request;
  readonly url: URL;
  readonly params: Params;
  readonly env: ParsedEnv;
  readonly db: SqlDatabase;
  readonly deps: HandlerDeps;
  readonly now: Date;
  readonly actor: Actor | null;

  constructor(init: AdminCtxInit) {
    this.request = init.request;
    this.url = new URL(init.request.url);
    this.params = init.params;
    this.env = init.env;
    this.db = init.db;
    this.deps = init.deps;
    this.now = init.now;
    this.actor = init.actor;
  }

  get domain(): DomainPort {
    return this.deps.services.domain;
  }

  /** Path parameter; the router has already validated it against its regex. */
  param(name: keyof Params): string {
    const v = this.params[name];
    if (v === undefined) throw new Error(`Route is missing parameter ${name}`);
    return v;
  }

  async body<S extends z.ZodType>(schema: S): Promise<z.infer<S>> {
    return parseWith(schema, await readJsonBody(this.request, LIMITS.adminBodyBytes));
  }

  query<S extends z.ZodType>(schema: S): z.infer<S> {
    return parseWith(schema, queryObject(this.url), 'Query');
  }

  /** Domain context with the authenticated actor and the (cached) base dataset. */
  async domainCtx(): Promise<DomainCtx> {
    if (!this.actor) throw new Error('domainCtx requires an authenticated actor');
    const base = await loadBaseFor(this.request, this.env, this.deps);
    return { now: this.now, actor: this.actor.id, base };
  }
}

export interface AdminHandler {
  /** null → reachable without authentication (only the password login). */
  permission: Permission | null;
  run(c: AdminCtx): Promise<Response>;
}

export type AdminRoute = Route<AdminHandler>;
