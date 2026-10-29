/**
 * Typed domain errors. Every server/domain function throws DomainError (never
 * a bare Error) for expected failures; the HTTP layer maps `code`/`status`
 * onto `apiErrorSchema`. Messages are safe to show to the caller — they never
 * contain secrets, SQL, stack traces or other users' private data.
 */
import type { z } from 'zod';
import type { ApiError } from '../src/community/index.ts';

export type ErrorCode = ApiError['error']['code'];
export interface ErrorIssue {
  path: string;
  message: string;
}

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
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
  // Building Studio (STUDIO_ERROR_STATUS in src/building-studio/schema.ts).
  'validation-failed': 422,
  'unsupported-model': 422,
  unavailable: 503,
  'not-configured': 503,
  internal: 500,
};

export interface DomainErrorOptions {
  status?: number;
  issues?: ErrorIssue[];
  retryAfterS?: number;
  /** Extra data for the caller, e.g. the current record on a conflict. */
  details?: unknown;
  cause?: unknown;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues: ErrorIssue[] | undefined;
  readonly retryAfterS: number | undefined;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, opts: DomainErrorOptions = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'DomainError';
    this.code = code;
    this.status = opts.status ?? STATUS_BY_CODE[code];
    this.issues = opts.issues;
    this.retryAfterS = opts.retryAfterS;
    this.details = opts.details;
  }

  /** Wire shape (`apiErrorSchema`). `details` is deliberately not included; callers add it explicitly. */
  toApiError(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues ? { issues: this.issues } : {}),
        ...(this.retryAfterS !== undefined ? { retryAfterS: this.retryAfterS } : {}),
      },
    };
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

export function zodIssues(error: z.ZodError, prefix = ''): ErrorIssue[] {
  return error.issues.map((i) => ({
    path: [prefix, ...i.path.map(String)].filter(Boolean).join('.') || '(root)',
    message: i.message,
  }));
}

/** Parses with a Zod schema or throws DomainError('invalid') listing every issue. */
export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
  opts: { prefix?: string; status?: number } = {},
): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issues = zodIssues(r.error, opts.prefix);
  return fail('invalid', `${what} is invalid: ${issues[0]?.path}: ${issues[0]?.message}`, {
    issues,
    ...(opts.status ? { status: opts.status } : {}),
  });
}

export function fail(code: ErrorCode, message: string, opts: DomainErrorOptions = {}): never {
  throw new DomainError(code, message, opts);
}

export const notFound = (what: string, id: string): never =>
  fail('not-found', `${what} ${JSON.stringify(id.slice(0, 120))} does not exist.`);

export const conflict = (what: string, current: unknown): never =>
  fail(
    'conflict',
    `${what} was changed by someone else since you loaded it. Review the current version and try again.`,
    { details: { current } },
  );

export const invalidTransition = (from: string, to: string): never =>
  fail('invalid-transition', `Cannot move a suggestion from "${from}" to "${to}".`);

/** 422 with a single field issue — for well-formed input that fails a domain rule. */
export const unprocessable = (path: string, message: string): never =>
  fail('invalid', message, { status: 422, issues: [{ path, message }] });
