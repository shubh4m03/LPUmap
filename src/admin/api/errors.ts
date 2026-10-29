/**
 * Admin API failures as one typed value. Every non-2xx response, every
 * network failure and every 2xx response whose body does not match the
 * expected schema becomes an `AdminApiError` — never a success. The server's
 * problem body is `apiErrorSchema` (src/community/schema.ts) with an optional
 * `error.details` (409 `current`, studio 422 `validation` /
 * `missingAcknowledgements`, template 409 `currentTemplate`).
 */
import { apiErrorSchema, type ApiError } from '../../community/index.ts';
import {
  validationResultSchema,
  warningCodeSchema,
  type ValidationResult,
  type WarningCode,
} from '../../building-studio/index.ts';

export type ApiErrorCode = ApiError['error']['code'];

export interface ApiIssue {
  path: string;
  message: string;
}

/**
 * What the UI must do about a failure:
 * - `unauthenticated` (401): show the login (password mode) or the Access notice;
 * - `forbidden` (403): the signed-in identity may not do this;
 * - `csrf` (403): the request was refused before it ran (Origin / X-CSRF-Token);
 * - `not-found` (404);
 * - `conflict` (409 `conflict`): stale revision — show `current`, re-validate, retry with `currentRevision`;
 * - `invalid-transition` (409): the record's state does not allow this action;
 * - `too-large` (413): the body exceeds the server limit (32 KB);
 * - `unprocessable` (422): `validation-failed`, `unsupported-model`, `outside-area`, or a refused revert;
 * - `invalid` (400, 405, 415): `issues` lists the fields;
 * - `rate-limited` (429): wait `retryAfterS`;
 * - `not-configured` / `unavailable` (503): administration is switched off or the database is down;
 * - `server` (other 5xx);
 * - `network`: no response — for a write, whether it was applied is unknown (`outcomeUnknown`);
 * - `bad-response`: a response that is not the documented JSON (never treated as success);
 * - `aborted`: the caller cancelled the request.
 */
export type AdminErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'csrf'
  | 'not-found'
  | 'conflict'
  | 'invalid-transition'
  | 'too-large'
  | 'unprocessable'
  | 'invalid'
  | 'rate-limited'
  | 'not-configured'
  | 'unavailable'
  | 'server'
  | 'network'
  | 'bad-response'
  | 'aborted';

export interface AdminApiError {
  kind: AdminErrorKind;
  /** HTTP status, or null when no response arrived. */
  status: number | null;
  /** Server error code (`apiErrorSchema`), or null when the body had none. */
  code: ApiErrorCode | null;
  /** Safe, human-readable text (the server's message, or the client's explanation). */
  message: string;
  issues: readonly ApiIssue[];
  retryAfterS: number | null;
  /** 409: the server's current copy (`details.current`, or `details.currentTemplate` for templates). */
  current: unknown;
  /** 409: the revision of `current` when it has one (retry with it after re-validating). */
  currentRevision: number | null;
  /** 422 `validation-failed` (studio publish / restore): the validation that blocked the write. */
  validation: ValidationResult | null;
  /** 422 `validation-failed`: warning codes still without an acknowledgement. */
  missingAcknowledgements: readonly WarningCode[];
  /**
   * True only when a write may or may not have been applied (the request was
   * sent but no response arrived). The UI must reload before retrying.
   */
  outcomeUnknown: boolean;
}

const KIND_BY_CODE: Partial<Record<ApiErrorCode, AdminErrorKind>> = {
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  csrf: 'csrf',
  'not-found': 'not-found',
  conflict: 'conflict',
  'invalid-transition': 'invalid-transition',
  'too-large': 'too-large',
  'validation-failed': 'unprocessable',
  'unsupported-model': 'unprocessable',
  'outside-area': 'unprocessable',
  'rate-limited': 'rate-limited',
  'not-configured': 'not-configured',
  unavailable: 'unavailable',
  internal: 'server',
};

/** Kind for a status when the body carried no recognised code (e.g. a proxy page). */
function kindForStatus(status: number): AdminErrorKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too-large';
  if (status === 422) return 'unprocessable';
  if (status === 429) return 'rate-limited';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'server';
  return 'invalid';
}

const FALLBACK_MESSAGE: Record<AdminErrorKind, string> = {
  unauthenticated: 'Your session has ended. Sign in again.',
  forbidden: 'You are not allowed to do this.',
  csrf: 'The request was refused by a security check before it ran. Nothing was changed.',
  'not-found': 'This item no longer exists.',
  conflict: 'This item was changed elsewhere since you loaded it. Review the current version and try again.',
  'invalid-transition': 'This action is not possible in the item’s current state.',
  'too-large': 'The request is larger than the server accepts. Nothing was changed.',
  unprocessable: 'The server could not accept these values. Nothing was changed.',
  invalid: 'The request was not valid. Nothing was changed.',
  'rate-limited': 'Too many attempts. Wait and try again.',
  'not-configured': 'Administration is not configured on this site.',
  unavailable: 'The server’s database is unavailable right now. Try again later.',
  server: 'The server failed. Nothing is known to have changed; reload to check.',
  network:
    'The server could not be reached. If you were saving, it is not known whether the change was saved: reload to check before retrying.',
  'bad-response':
    'The server sent an unexpected response. It is not known whether a change was saved: reload to check.',
  aborted: 'The request was cancelled.',
};

function emptyError(kind: AdminErrorKind, status: number | null, message?: string): AdminApiError {
  return {
    kind,
    status,
    code: null,
    message: message ?? FALLBACK_MESSAGE[kind],
    issues: [],
    retryAfterS: null,
    current: null,
    currentRevision: null,
    validation: null,
    missingAcknowledgements: [],
    outcomeUnknown: false,
  };
}

function revisionOf(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = (value as { revision?: unknown }).revision;
  return typeof r === 'number' && Number.isInteger(r) && r > 0 ? r : null;
}

function detailsOf(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const details = (error as { details?: unknown }).details;
  return typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : null;
}

/**
 * Error for an HTTP error response. `body` is the parsed JSON (or null when
 * the body was not JSON); `retryAfterHeader` is the `Retry-After` header.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null = null,
): AdminApiError {
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) {
    const err = emptyError(kindForStatus(status), status);
    const header = Number(retryAfterHeader);
    if (status === 429 && Number.isFinite(header) && header > 0) err.retryAfterS = Math.ceil(header);
    return err;
  }
  const { code, message, issues, retryAfterS } = parsed.data.error;
  const kind = KIND_BY_CODE[code] ?? (code === 'invalid' && status === 422 ? 'unprocessable' : 'invalid');
  const err: AdminApiError = {
    ...emptyError(kind, status),
    code,
    message: message.trim() ? message : FALLBACK_MESSAGE[kind],
    issues: issues ?? [],
    retryAfterS: retryAfterS ?? null,
  };
  const details = detailsOf(body);
  if (details) {
    const current = 'current' in details ? details.current : details.currentTemplate;
    if (current !== undefined) {
      err.current = current;
      err.currentRevision = revisionOf(current);
    }
    const validation = validationResultSchema.safeParse(details.validation);
    if (validation.success) err.validation = validation.data;
    if (Array.isArray(details.missingAcknowledgements)) {
      err.missingAcknowledgements = details.missingAcknowledgements.flatMap((c) => {
        const r = warningCodeSchema.safeParse(c);
        return r.success ? [r.data] : [];
      });
    }
  }
  return err;
}

/** No response arrived. For a write (`sent` = the request may have reached the server) the outcome is unknown. */
export function networkError(isWrite: boolean): AdminApiError {
  const err = emptyError('network', null);
  err.outcomeUnknown = isWrite;
  if (!isWrite) err.message = 'The server could not be reached. Check your connection and try again.';
  return err;
}

/** A 2xx (or error) response whose body is not the documented JSON. */
export function badResponseError(status: number, isWrite: boolean, detail?: string): AdminApiError {
  const err = emptyError('bad-response', status);
  err.outcomeUnknown = isWrite;
  if (!isWrite) err.message = 'The server sent an unexpected response. Reload and try again.';
  if (detail) err.issues = [{ path: '(response)', message: detail }];
  return err;
}

/**
 * The request was redirected (the API itself never redirects): an identity
 * proxy such as Cloudflare Access wants the browser to sign in again. The
 * request did not reach the API, so nothing was changed.
 */
export function signInRedirectError(): AdminApiError {
  return emptyError(
    'unauthenticated',
    null,
    'Your sign-in has ended. Reload the page to sign in again. Nothing was changed.',
  );
}

export function abortedError(): AdminApiError {
  return emptyError('aborted', null);
}

/** One sentence for a banner or toast. Never claims success; says when the outcome is unknown. */
export function describeAdminError(err: AdminApiError): string {
  if (err.kind === 'conflict' && err.currentRevision !== null) {
    return `${err.message} (The current version is revision ${err.currentRevision}.)`;
  }
  if (err.kind === 'rate-limited' && err.retryAfterS !== null) {
    return `${err.message} Try again in ${err.retryAfterS} s.`;
  }
  return err.message;
}

/** True for failures where retrying the same request unchanged may succeed. */
export const isRetryable = (err: AdminApiError): boolean =>
  err.kind === 'network' ||
  err.kind === 'unavailable' ||
  err.kind === 'server' ||
  err.kind === 'rate-limited';
