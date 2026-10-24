/** Dependencies every handler receives. Functions build them from the Pages context. */
import type { FetchLike } from '../auth/access.ts';
import type { BaseData, StudioBaseData } from '../base-data.ts';
import type { Env, ParsedEnv } from '../env.ts';
import { HttpError } from '../http/errors.ts';
import type { Services } from './ports.ts';

export interface HandlerDeps {
  env: Env;
  services: Services;
  /** Clock (injectable for tests). */
  now?: () => Date;
  /** Fetch used for the Access JWKS (injectable for tests). */
  fetch?: FetchLike;
}

export function nowOf(deps: HandlerDeps): Date {
  return deps.now ? deps.now() : new Date();
}

export function fetchOf(deps: HandlerDeps): FetchLike {
  return deps.fetch ?? ((url: string) => fetch(url));
}

/** Loads the static base dataset through the Pages ASSETS binding (same deployment). */
export async function loadBaseFor(request: Request, env: ParsedEnv, deps: HandlerDeps): Promise<BaseData> {
  const assets = env.assets;
  if (!assets) throw new HttpError('unavailable', 'Base dataset is unavailable');
  const origin = new URL(request.url).origin;
  return deps.services.loadBase((path: string) =>
    assets.fetch(new Request(new URL(`/${path.replace(/^\/+/, '')}`, origin).toString())),
  );
}

/** Loads the studio view of the base dataset (same deployment, cached per datasetVersion). */
export async function loadStudioBaseFor(
  request: Request,
  env: ParsedEnv,
  deps: HandlerDeps,
): Promise<StudioBaseData> {
  const assets = env.assets;
  if (!assets) throw new HttpError('unavailable', 'Base dataset is unavailable');
  const origin = new URL(request.url).origin;
  return deps.services.loadStudioBase((path: string) =>
    assets.fetch(new Request(new URL(`/${path.replace(/^\/+/, '')}`, origin).toString())),
  );
}
