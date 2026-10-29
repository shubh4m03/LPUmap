/**
 * The owner's studio buildings (drafts, published, archived) from
 * GET /studio/buildings. Selecting one opens it at /admin/studio/<id>, so a
 * reload reopens the same record from the server.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Spinner,
} from '../../components/ui/index.ts';
import { cx, FOCUS_RING } from '../../components/ui/index.ts';
import type { StudioBuildingSummary, StudioStatus } from '../../building-studio/index.ts';
import { categoryLabel } from '../../building-studio/ui/index.ts';
import { describeAdminError } from '../api/errors.ts';
import { useAdminApi } from '../context.ts';

type Filter = 'all' | StudioStatus;

const STATUS_TONE = { draft: 'info', published: 'success', archived: 'danger' } as const;
const STATUS_LABEL = { draft: 'Draft', published: 'Published', archived: 'Archived' } as const;

export interface RecordListProps {
  openId: string | null;
  /** Changes whenever the open record was written (reloads the list). */
  refreshKey: string;
  onOpen(id: string): void;
}

export function RecordList({ openId, refreshKey, onOpen }: RecordListProps) {
  const api = useAdminApi();
  const [filter, setFilter] = useState<Filter>('all');
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; items: StudioBuildingSummary[]; more: boolean }
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // The previous list stays visible until the new one arrives.
    const ctl = new AbortController();
    void api.studio
      .listBuildings({ ...(filter === 'all' ? {} : { status: filter }), limit: 200 }, { signal: ctl.signal })
      .then((r) => {
        if (ctl.signal.aborted) return;
        if (r.ok) setState({ status: 'ready', items: r.data.items, more: r.data.nextCursor !== null });
        else if (r.error.kind !== 'aborted')
          setState({ status: 'error', message: describeAdminError(r.error) });
      });
    return () => ctl.abort();
  }, [api, filter, refreshKey, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-3">
        <SegmentedControl<Filter>
          label="Show buildings"
          // Four filters must fit the 18 rem side panel: share the width, tighter padding.
          className="flex w-full [&>button]:flex-1 [&>button]:px-1"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Drafts' },
            { value: 'published', label: 'Published' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
      </div>
      {state.status === 'loading' ? (
        <div className="p-6">
          <Spinner label="Loading buildings…" />
        </div>
      ) : state.status === 'error' ? (
        <ErrorState title="Could not load the buildings" message={state.message} onRetry={retry} />
      ) : state.items.length === 0 ? (
        <EmptyState
          icon="building"
          title={filter === 'archived' ? 'Nothing archived' : 'No studio buildings yet'}
          description={
            filter === 'all'
              ? 'Place a template from the Library, or select an existing building on the map to model it.'
              : undefined
          }
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Studio buildings">
          {state.items.map((b) => (
            <li key={b.id} className="mb-1.5">
              <button
                type="button"
                aria-current={b.id === openId ? 'true' : undefined}
                onClick={() => onOpen(b.id)}
                data-testid={`studio-record-${b.id}`}
                className={cx(
                  'flex w-full flex-col gap-1 rounded-lg border p-2.5 text-left',
                  b.id === openId ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-hover',
                  FOCUS_RING,
                )}
              >
                <span className="text-sm leading-tight font-medium">{b.title}</span>
                <span className="text-xs text-muted">
                  {b.targetId
                    ? `Model of ${b.targetId}`
                    : b.categoryId
                      ? categoryLabel(b.categoryId)
                      : 'New building'}
                </span>
                <span className="flex flex-wrap gap-1">
                  <Badge tone={STATUS_TONE[b.status]}>
                    {STATUS_LABEL[b.status]}
                    {b.publishedVersion !== null ? ` · v${b.publishedVersion}` : ''}
                  </Badge>
                  {b.hasDraft && b.status !== 'draft' ? <Badge tone="info">Draft pending</Badge> : null}
                  {b.errorCount > 0 ? (
                    <Badge tone="danger">
                      {b.errorCount} {b.errorCount === 1 ? 'error' : 'errors'}
                    </Badge>
                  ) : null}
                  {b.warningCount > 0 ? (
                    <Badge tone="warning">
                      {b.warningCount} {b.warningCount === 1 ? 'warning' : 'warnings'}
                    </Badge>
                  ) : null}
                  {!b.modelAvailable ? <Badge tone="warning">Model unavailable</Badge> : null}
                </span>
              </button>
            </li>
          ))}
          {state.more ? (
            <li className="p-2 text-xs text-muted">Only the 200 most recent are listed.</li>
          ) : null}
        </ul>
      )}
      <div className="border-t border-border p-2">
        <Button size="sm" variant="ghost" icon="reset" onClick={retry}>
          Refresh list
        </Button>
      </div>
    </div>
  );
}
