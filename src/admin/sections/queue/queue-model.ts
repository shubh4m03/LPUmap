/**
 * Moderation queue model (pure): URL filters ↔ API query, and which actions a
 * suggestion's state allows (the server's SUGGESTION_TRANSITIONS; the server
 * enforces them again).
 */
import {
  ASSIGNABLE_CATEGORY_IDS,
  canTransition,
  suggestionStatusSchema,
  type SuggestionStatus,
} from '../../../community/index.ts';
import type { SuggestionsQuery } from '../../api/community.ts';

export type StatusFilter = SuggestionStatus | 'all';

export interface QueueFilters {
  status: StatusFilter;
  category: string | null;
  q: string;
  sort: 'created_desc' | 'created_asc';
}

export const QUEUE_PAGE_SIZE = 25;

/** Default view: what needs the owner's attention first. */
export const DEFAULT_FILTERS: QueueFilters = {
  status: 'pending',
  category: null,
  q: '',
  sort: 'created_asc',
};

export const STATUS_FILTERS: readonly StatusFilter[] = [
  'pending',
  'needs_information',
  'approved',
  'rejected',
  'duplicate',
  'all',
];

export function parseQueueFilters(query: Readonly<Record<string, string>>): QueueFilters {
  const status = query.status === 'all' ? 'all' : suggestionStatusSchema.safeParse(query.status);
  return {
    status: status === 'all' ? 'all' : status.success ? status.data : DEFAULT_FILTERS.status,
    category: query.category && ASSIGNABLE_CATEGORY_IDS.includes(query.category) ? query.category : null,
    q: (query.q ?? '').trim().slice(0, 120),
    sort: query.sort === 'created_desc' || query.sort === 'created_asc' ? query.sort : DEFAULT_FILTERS.sort,
  };
}

/** URL query for filters (defaults left out, so /admin/queue is the default view). */
export function queueFiltersQuery(f: QueueFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status !== DEFAULT_FILTERS.status) out.status = f.status;
  if (f.category) out.category = f.category;
  if (f.q) out.q = f.q;
  if (f.sort !== DEFAULT_FILTERS.sort) out.sort = f.sort;
  return out;
}

export function apiQuery(f: QueueFilters, cursor?: string): SuggestionsQuery {
  const q: SuggestionsQuery = { sort: f.sort, limit: QUEUE_PAGE_SIZE };
  if (f.status !== 'all') q.status = f.status;
  if (f.category) q.category = f.category;
  if (f.q) q.q = f.q;
  if (cursor) q.cursor = cursor;
  return q;
}

export type ModerationAction = 'edit' | 'approve' | 'request-info' | 'reject' | 'duplicate' | 'reopen';

/** Actions offered for a status, in display order. */
export function moderationActions(status: SuggestionStatus): ModerationAction[] {
  const out: ModerationAction[] = [];
  if (status === 'pending' || status === 'needs_information') out.push('edit');
  if (canTransition(status, 'approved')) out.push('approve');
  if (canTransition(status, 'needs_information')) out.push('request-info');
  if (canTransition(status, 'rejected')) out.push('reject');
  if (canTransition(status, 'duplicate')) out.push('duplicate');
  if (canTransition(status, 'pending')) out.push('reopen');
  return out;
}
