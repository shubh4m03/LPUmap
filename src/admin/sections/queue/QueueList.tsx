import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/Button.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { cx, FOCUS_RING } from '../../../components/ui/cx.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { Spinner } from '../../../components/ui/Spinner.tsx';
import { SearchInput } from '../../../components/ui/TextInput.tsx';
import type { AdminApiError } from '../../api/errors.ts';
import type { SuggestionRecord } from '../../api/schemas.ts';
import { useAdminApi } from '../../context.ts';
import { useResource } from '../../hooks/useResource.ts';
import type { AdminNavigate } from '../../router.ts';
import { adminHref } from '../../routes.ts';
import { ErrorNotice } from '../../ui/ErrorNotice.tsx';
import { SelectField } from '../../ui/fields.tsx';
import {
  CATEGORY_OPTIONS,
  categoryLabel,
  formatDateTime,
  formatLngLat,
  SUGGESTION_STATUS_LABELS,
  SUGGESTION_STATUS_TONES,
} from '../../ui/format.ts';
import { Page } from '../../ui/Page.tsx';
import { onInAppClick } from '../../ui/links.ts';
import {
  apiQuery,
  parseQueueFilters,
  queueFiltersQuery,
  STATUS_FILTERS,
  type QueueFilters,
  type StatusFilter,
} from './queue-model.ts';
import { rememberQueueQuery } from './remembered.ts';

const STATUS_FILTER_LABEL = (s: StatusFilter) => (s === 'all' ? 'All' : SUGGESTION_STATUS_LABELS[s]);

interface MorePages {
  key: string;
  items: SuggestionRecord[];
  nextCursor: string | null;
  loading: boolean;
  error: AdminApiError | null;
}

export function QueueList({
  query,
  navigate,
}: {
  query: Readonly<Record<string, string>>;
  navigate: AdminNavigate;
}) {
  const api = useAdminApi();
  const filters = parseQueueFilters(query);
  const key = JSON.stringify(filters);
  const list = useResource(key, (signal) => api.community.listSuggestions(apiQuery(filters), { signal }));
  const overview = useResource('overview', (signal) => api.community.overview({ signal }));
  const [more, setMore] = useState<MorePages | null>(null);
  const [q, setQ] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setQ(filters.q);
  }

  const go = (next: Partial<QueueFilters>) =>
    navigate({ section: 'queue', query: queueFiltersQuery({ ...filters, ...next }) });

  const pages = more?.key === key ? more : null;
  const items = [...(list.state.data?.items ?? []), ...(pages?.items ?? [])];
  const nextCursor = pages ? pages.nextCursor : (list.state.data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!nextCursor) return;
    setMore({ key, items: pages?.items ?? [], nextCursor, loading: true, error: null });
    const r = await api.community.listSuggestions(apiQuery(filters, nextCursor));
    setMore((m) => {
      const base = m && m.key === key ? m.items : [];
      return r.ok
        ? {
            key,
            items: [...base, ...r.data.items],
            nextCursor: r.data.nextCursor,
            loading: false,
            error: null,
          }
        : { key, items: base, nextCursor, loading: false, error: r.error };
    });
  };

  // A reload of the first page drops the extra pages (they may be stale).
  const reloadAll = () => {
    setMore(null);
    list.reload();
    overview.reload();
  };

  useEffect(() => {
    rememberQueueQuery(queueFiltersQuery(filters));
  });

  const counts = overview.state.data?.suggestions ?? null;
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    go({ q: q.trim() });
  };

  return (
    <Page
      title="Moderation queue"
      description="Public suggestions waiting for review. Nothing appears on the public map until you approve it."
      wide
      actions={
        <Button size="sm" icon="reset" onClick={reloadAll} loading={list.state.status === 'loading'}>
          Refresh
        </Button>
      }
    >
      <nav aria-label="Suggestion status">
        <ul className="flex gap-1 overflow-x-auto pb-1">
          {STATUS_FILTERS.map((s) => {
            const current = filters.status === s;
            const count = counts && s !== 'all' ? counts[s] : null;
            return (
              <li key={s} className="shrink-0">
                <a
                  href={adminHref({ section: 'queue', query: queueFiltersQuery({ ...filters, status: s }) })}
                  aria-current={current ? 'page' : undefined}
                  onClick={onInAppClick(() => go({ status: s }))}
                  className={cx(
                    'flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium whitespace-nowrap',
                    current
                      ? 'border-transparent bg-accent text-accent-contrast'
                      : 'border-border-strong bg-surface-raised text-text hover:bg-surface-hover',
                    FOCUS_RING,
                  )}
                >
                  {STATUS_FILTER_LABEL(s)}
                  {count !== null ? (
                    <span
                      className={cx(
                        'rounded-full px-1.5 text-xs tabular-nums',
                        current ? 'bg-surface-raised text-accent-text' : 'bg-surface-sunken text-muted',
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_14rem_12rem] md:items-end">
        <form role="search" onSubmit={submitSearch} className="flex items-end gap-2">
          <SearchInput
            className="flex-1"
            label="Search names"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClear={() => {
              setQ('');
              go({ q: '' });
            }}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <SelectField
          label="Category"
          value={filters.category ?? ''}
          onChange={(e) => go({ category: e.target.value || null })}
          options={[{ value: '', label: 'All categories' }, ...CATEGORY_OPTIONS]}
        />
        <SelectField
          label="Order"
          value={filters.sort}
          onChange={(e) => go({ sort: e.target.value === 'created_desc' ? 'created_desc' : 'created_asc' })}
          options={[
            { value: 'created_asc', label: 'Oldest first' },
            { value: 'created_desc', label: 'Newest first' },
          ]}
        />
      </div>

      {list.state.status === 'error' ? (
        <ErrorNotice error={list.state.error} title="Could not load suggestions" onReload={list.reload} />
      ) : null}

      {list.state.status === 'loading' && !list.state.data ? (
        <div className="flex justify-center py-8">
          <Spinner label="Loading suggestions…" />
        </div>
      ) : list.state.data && items.length === 0 ? (
        <EmptyState
          icon="check"
          title={filters.q || filters.category ? 'No suggestions match these filters' : 'Nothing here'}
          description={
            filters.status === 'pending'
              ? 'There are no pending suggestions right now.'
              : 'No suggestions have this status.'
          }
        />
      ) : list.state.data ? (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            Showing {items.length} {items.length === 1 ? 'suggestion' : 'suggestions'}
            {nextCursor ? ' (more available)' : ''}.
          </p>
          <ul className="flex flex-col gap-2" aria-label="Suggestions">
            {items.map((s) => (
              <li key={s.id}>
                <SuggestionRow s={s} onOpen={() => navigate({ section: 'queue', id: s.id })} />
              </li>
            ))}
          </ul>
          {pages?.error ? (
            <ErrorNotice error={pages.error} title="Could not load more suggestions" onReload={loadMore} />
          ) : null}
          {nextCursor ? (
            <Button className="self-center" onClick={() => void loadMore()} loading={pages?.loading ?? false}>
              Load more
            </Button>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}

function SuggestionRow({ s, onOpen }: { s: SuggestionRecord; onOpen(): void }) {
  return (
    <a
      href={adminHref({ section: 'queue', id: s.id })}
      onClick={onInAppClick(onOpen)}
      className={cx(
        'flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4',
        FOCUS_RING,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold break-words text-text">{s.name}</span>
          <Badge tone={SUGGESTION_STATUS_TONES[s.status]}>{SUGGESTION_STATUS_LABELS[s.status]}</Badge>
        </span>
        <span className="text-sm text-muted">
          {categoryLabel(s.categoryId)} · {formatLngLat(s.location)}
        </span>
        {s.description ? <span className="line-clamp-2 text-sm text-text">{s.description}</span> : null}
      </div>
      <span className="shrink-0 text-sm text-muted">Submitted {formatDateTime(s.createdAt)}</span>
    </a>
  );
}
