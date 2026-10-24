/**
 * Field errors from the shared Zod schemas (the same schemas the server
 * validates with) and from server `issues`. Pure.
 */
import type { z } from 'zod';
import type { ApiIssue } from '../api/errors.ts';

export type FieldErrors = Readonly<Record<string, string>>;

/** First message per top-level field (`location.0` → `location`). */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : '(form)';
    if (!(key in out)) out[key] = friendly(key, issue.message);
  }
  return out;
}

/** Server issues (`fields.name`, `accessPoint.nodeId`) keyed by their last meaningful segment. */
export function issueFieldErrors(issues: readonly ApiIssue[], prefix = 'fields.'): FieldErrors {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const path = i.path.startsWith(prefix) ? i.path.slice(prefix.length) : i.path;
    const key = path.split('.')[0] || '(form)';
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

function friendly(field: string, message: string): string {
  if (/too_small|at least|>=\s*2/i.test(message) && field === 'name') return 'Enter at least 2 characters.';
  if (/Unknown category/.test(message)) return 'Choose a category.';
  if (field === 'lastVerifiedAt') return 'Use a date in the form YYYY-MM-DD.';
  if (field === 'location') return 'Place the point on the map or enter valid coordinates.';
  return message;
}
