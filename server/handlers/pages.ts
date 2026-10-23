/**
 * Pages Functions adapter: builds handler deps from the Pages context and
 * turns any escaped error into a generic 500 (no stack traces leak).
 * functions/** files call only this, so they stay free of business logic.
 */
import type { Env } from '../env.ts';
import type { HandlerDeps } from './deps.ts';
import { realServices } from './repos.ts';
import { errorResponse } from '../http/response.ts';

export interface PagesContext {
  request: Request;
  env: Env;
}

export type Handler = (request: Request, deps: HandlerDeps) => Promise<Response>;

export async function run(handler: Handler, context: PagesContext): Promise<Response> {
  try {
    return await handler(context.request, { env: context.env, services: realServices });
  } catch (err) {
    return errorResponse(err, { cache: 'no-store', route: 'functions', method: context.request.method });
  }
}
