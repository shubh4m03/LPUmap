/** Per-request context handed to admin route handlers. */
import type { z } from 'zod';
import { LIMITS } from '../../../src/community/schema.ts';
import type { Actor, Permission } from '../../auth/authorize.ts';
import { insertAudit } from '../../db/audit.ts';
import type { AuditEntityType } from '../../db/records.ts';
import type { SqlDatabase } from '../../db/types.ts';
import type { ParsedEnv } from '../../env.ts';
import { STUDIO_LIMITS } from '../../../src/building-studio/schema.ts';
import type { StudioContext } from '../../domain/studio/context.ts';
import { parseWith, readJsonBody } from '../../http/body.ts';
import { assertJsonBounds } from '../../http/json-bounds.ts';
import { isApiErrorLike } from '../../http/errors.ts';
import type { ParamName, Params, Route } from '../../http/router.ts';
import { loadBaseFor, loadStudioBaseFor } from '../deps.ts';
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
  /** The route's audit target (writes only): body rejections are audited against it. */
  audit?: AdminAuditSpec | undefined;
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
  readonly audit: AdminAuditSpec | null;

  constructor(init: AdminCtxInit) {
    this.request = init.request;
    this.url = new URL(init.request.url);
    this.params = init.params;
    this.env = init.env;
    this.db = init.db;
    this.deps = init.deps;
    this.now = init.now;
    this.actor = init.actor;
    this.audit = init.audit ?? null;
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
    return this.auditingRejection(async () =>
      parseWith(schema, await readJsonBody(this.request, LIMITS.adminBodyBytes)),
    );
  }

  /**
   * Studio body: JSON content type, <= STUDIO_LIMITS.bodyBytes, finite numbers
   * and bounded depth/arrays. Returned RAW: the studio domain parses it with
   * the strict schemas inside its audit wrapper.
   */
  async rawStudioBody(): Promise<unknown> {
    return this.auditingRejection(async () => {
      const raw = await readJsonBody(this.request, STUDIO_LIMITS.bodyBytes);
      assertJsonBounds(raw);
      return raw;
    });
  }

  /**
   * Runs a body read. A request the HTTP layer rejects before the domain sees
   * it (415 content type, 413 size, 400 malformed JSON / UTF-8 / structural
   * bounds / schema) is audited as 'rejected' for the authenticated actor,
   * exactly as a domain rejection would be. The detail is the fixed error
   * code and message (never the body). A failing audit write never masks the
   * original error.
   */
  private async auditingRejection<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (err) {
      const spec = this.audit;
      if (spec && this.actor && isApiErrorLike(err)) {
        try {
          await insertAudit(this.db, {
            at: this.now.toISOString(),
            actor: this.actor.id,
            action: spec.action,
            entityType: spec.entityType,
            entityId: spec.param ? (this.params[spec.param] ?? null) : null,
            outcome: 'rejected',
            detail: `${err.code} (HTTP ${err.status}): ${err.message}`,
          });
        } catch {
          // The audit write itself failed; the original rejection still propagates.
        }
      }
      throw err;
    }
  }

  /** Query string as a plain object (repeated keys rejected); parsed by the domain. */
  rawQuery(): Record<string, string> {
    return queryObject(this.url);
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

  /** Studio context: the authenticated actor and the studio view of the base dataset. */
  async studioCtx(): Promise<StudioContext> {
    if (!this.actor) throw new Error('studioCtx requires an authenticated actor');
    const studio = await loadStudioBaseFor(this.request, this.env, this.deps);
    return { now: this.now, actor: this.actor.id, studio };
  }
}

/**
 * What a write route records in the audit log (the same action and entity the
 * domain uses). `param` names the path parameter that is the entity id.
 */
export interface AdminAuditSpec {
  action: string;
  entityType: AuditEntityType;
  param?: ParamName;
}

export interface AdminHandler {
  /** null → reachable without authentication (only the password login). */
  permission: Permission | null;
  /** Audit target of a write route; body rejections (413/415/400) are audited against it. */
  audit?: AdminAuditSpec;
  run(c: AdminCtx): Promise<Response>;
}

export type AdminRoute = Route<AdminHandler>;
