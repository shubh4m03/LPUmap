/**
 * Tiny method + path-pattern router. Patterns use literal segments and
 * `:name` parameters; each parameter name maps to a validation regex so ids
 * are checked before any handler (and therefore the database) sees them.
 * Parameters are matched per path segment and percent-decoded, so base place
 * ids containing '/' (osm:way/123) must be sent encoded (osm%3Away%2F123).
 */
import { OWNER_TEMPLATE_ID_RE, STUDIO_ID_RE } from '../../src/building-studio/schema.ts';
import { ART_SUBJECT_ID_MAX, ART_SUBJECT_ID_RE } from '../../src/isometric-art/schema.ts';
import { ID_PATTERNS } from '../ids.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const ROUTER_METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export const PARAM_PATTERNS = {
  id: ID_PATTERNS.suggestion,
  locationId: /^(own|com):[a-z2-7]{26}$/,
  targetId: /^(osm:(node|way|relation)\/\d{1,20}|cur:[a-z0-9][a-z0-9-]{0,150})$/,
  /** Building Studio record (`stu:…`). */
  buildingId: STUDIO_ID_RE,
  /** Owner template (`stv:…`); starter templates live in code and have no write routes. */
  templateId: OWNER_TEMPLATE_ID_RE,
  /** Artwork subject (`art:num-25`, `art:scene-091`, `art:area-…`), length-bounded. */
  subjectId: new RegExp(`^(?=.{1,${ART_SUBJECT_ID_MAX}}$)${ART_SUBJECT_ID_RE.source.slice(1)}`),
} as const;

export type ParamName = keyof typeof PARAM_PATTERNS;
export type Params = Partial<Record<ParamName, string>>;

export interface Route<H> {
  method: HttpMethod;
  pattern: string;
  handler: H;
}

interface Compiled<H> {
  route: Route<H>;
  segments: Array<{ literal: string } | { param: ParamName }>;
}

export type MatchResult<H> =
  | { kind: 'match'; route: Route<H>; params: Params }
  | { kind: 'method-not-allowed'; allowed: HttpMethod[] }
  | { kind: 'invalid-param' }
  | { kind: 'not-found' };

function splitPath(path: string): string[] {
  return path.split('/').filter((s, i, all) => !(s === '' && (i === 0 || i === all.length - 1)));
}

export class Router<H> {
  private readonly compiled: Compiled<H>[];

  constructor(routes: readonly Route<H>[]) {
    this.compiled = routes.map((route) => ({
      route,
      segments: splitPath(route.pattern).map((seg) => {
        if (!seg.startsWith(':')) return { literal: seg };
        const name = seg.slice(1);
        if (!(name in PARAM_PATTERNS)) throw new Error(`Unknown route parameter :${name}`);
        return { param: name as ParamName };
      }),
    }));
  }

  get routes(): Route<H>[] {
    return this.compiled.map((c) => c.route);
  }

  /** `invalid-param` when a structurally matching route has an id failing its regex. */
  match(method: string, path: string): MatchResult<H> {
    const parts = splitPath(path);
    const allowed: HttpMethod[] = [];
    let invalidParam = false;
    for (const c of this.compiled) {
      if (c.segments.length !== parts.length) continue;
      const params: Params = {};
      let ok = true;
      let bad = false;
      for (let i = 0; i < parts.length && ok; i++) {
        const seg = c.segments[i]!;
        const raw = parts[i]!;
        if ('literal' in seg) {
          ok = seg.literal === raw;
          continue;
        }
        let decoded: string;
        try {
          decoded = decodeURIComponent(raw);
        } catch {
          bad = true;
          continue;
        }
        if (!PARAM_PATTERNS[seg.param].test(decoded)) bad = true;
        else params[seg.param] = decoded;
      }
      if (!ok) continue;
      if (c.route.method !== method) {
        allowed.push(c.route.method);
        continue;
      }
      if (bad) {
        invalidParam = true;
        continue;
      }
      return { kind: 'match', route: c.route, params };
    }
    if (invalidParam) return { kind: 'invalid-param' };
    if (allowed.length > 0) return { kind: 'method-not-allowed', allowed: [...new Set(allowed)] };
    return { kind: 'not-found' };
  }
}
