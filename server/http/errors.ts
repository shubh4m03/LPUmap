/**
 * HTTP-layer error type. Any thrown value that carries a known API error
 * `code` and a numeric `status` (this class, or the domain's DomainError) is
 * turned into an `apiErrorSchema` problem response by `errorResponse()`.
 */
import type { ApiError } from '../../src/community/schema.ts';

export type ApiErrorCode = ApiError['error']['code'];
export type ApiIssue = { path: string; message: string };

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid: 400,
  'outside-area': 422,
  'rate-limited': 429,
  'too-large': 413,
  unauthenticated: 401,
  forbidden: 403,
  csrf: 403,
  'not-found': 404,
  conflict: 409,
  'invalid-transition': 409,
  unavailable: 503,
  'not-configured': 503,
  internal: 500,
};

export interface HttpErrorOptions {
  /** Overrides the default status for the code (e.g. 415 or 405 with code 'invalid'). */
  status?: number;
  issues?: ApiIssue[];
  retryAfterS?: number;
  /** Extra response headers (e.g. `Allow` on 405). */
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly issues?: ApiIssue[];
  readonly retryAfterS?: number;
  readonly headers?: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, opts: HttpErrorOptions = {}) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = opts.status ?? STATUS_BY_CODE[code];
    if (opts.issues) this.issues = opts.issues;
    if (opts.retryAfterS !== undefined) this.retryAfterS = opts.retryAfterS;
    if (opts.headers) this.headers = opts.headers;
  }
}

/** Shape shared by HttpError and the domain's DomainError (duck-typed so the layers stay decoupled). */
export interface ApiErrorLike {
  code: ApiErrorCode;
  status: number;
  message: string;
  issues?: ApiIssue[];
  retryAfterS?: number;
  details?: unknown;
  headers?: Record<string, string>;
}

const CODES = new Set<string>(Object.keys(STATUS_BY_CODE));

export function isApiErrorLike(err: unknown): err is ApiErrorLike {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { code?: unknown; status?: unknown };
  return (
    typeof e.code === 'string' &&
    CODES.has(e.code) &&
    typeof e.status === 'number' &&
    Number.isInteger(e.status) &&
    e.status >= 400 &&
    e.status <= 599
  );
}
