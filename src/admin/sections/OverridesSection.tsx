/**
 * Base-place overrides: /admin/overrides (tabs: all, hidden, orphans; plus a
 * base-place search to start a new override) and /admin/overrides/<place id>.
 */
import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { cx, FOCUS_RING } from '../../components/ui/cx.ts';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx';
import { Spinner } from '../../components/ui/Spinner.tsx';
import { SearchInput } from '../../components/ui/TextInput.tsx';
import { useAdminApi } from '../context.ts';
import { useAdminCampusData } from '../data/campus-data.ts';
import { useResource } from '../hooks/useResource.ts';
import { adminHref } from '../routes.ts';
import { ErrorNotice } from '../ui/ErrorNotice.tsx';
import { categoryLabel, ORPHAN_GENERAL_ADVICE, ORPHAN_REASON_ADVICE } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { onInAppClick } from '../ui/links.ts';
import { OverrideEditor } from './overrides/OverrideEditor.tsx';
import {
  filterOverrides,
  overrideSummary,
  parseOverrideTab,
  searchBasePlaces,
  type OverrideTab,
} from './overrides/overrides-model.ts';
import type { AdminSectionProps } from './types.ts';

export default function OverridesSection({ route, navigate }: AdminSectionProps) {
  const [listQuery, setListQuery] = useState(route.query);
  if (!route.id && listQuery !== route.query) setListQuery(route.query);
  if (route.id) {
    return (
      <OverrideEditor
        key={route.id}
        targetId={route.id}
        navigate={navigate}
        backHref={adminHref({ section: 'overrides', query: listQuery })}
        onBack={() => navigate({ section: 'overrides', query: listQuery })}
      />
    );
  }
  return <OverridesList tab={parseOverrideTab(route.query)} navigate={navigate} />;
}

function OverridesList({ tab, navigate }: { tab: OverrideTab; navigate: AdminSectionProps['navigate'] }) {
  const api = useAdminApi();
  const campus = useAdminCampusData();
  const list = useResource('overrides', (signal) => api.community.listOverrides({ signal }));
  const [q, setQ] = useState('');
  const items = useMemo(() => list.state.data?.items ?? [], [list.state.data]);
  const visible = useMemo(() => filterOverrides(items, tab), [items, tab]);
  const orphanCount = items.filter((o) => o.orphan).length;
  const hiddenCount = items.filter((o) => o.hidden).length;
  const results = useMemo(
    () => (campus.status === 'ready' ? searchBasePlaces(campus.data.places, q) : []),
    [campus, q],
  );
  const open = (id: string) => navigate({ section: 'overrides', id });

  return (
    <Page
      title="Base-place overrides"
      description="Owner corrections to places from the base dataset (OpenStreetMap and curated data). The base files are never changed; overrides are applied on top by place id."
      wide
      actions={
        <Button size="sm" icon="reset" onClick={list.reload} loading={list.state.status === 'loading'}>
          Refresh
        </Button>
      }
    >
      <Section title="Change a base place">
        <SearchInput
          label="Find a campus place by name or id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => setQ('')}
          hint={campus.status === 'error' ? campus.message : 'Type at least 2 characters.'}
        />
        {campus.status === 'loading' && q.trim().length >= 2 ? (
          <Spinner label="Loading the campus places…" />
        ) : null}
        {q.trim().length >= 2 && campus.status === 'ready' ? (
          results.length === 0 ? (
            <p className="text-sm text-muted">No campus place matches “{q.trim()}”.</p>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Matching campus places">
              {results.map((p) => (
                <li key={p.id}>
                  <a
                    href={adminHref({ section: 'overrides', id: p.id })}
                    onClick={onInAppClick(() => open(p.id))}
                    className={cx(
                      'flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-surface-hover',
                      FOCUS_RING,
                    )}
                  >
                    <span className="font-medium text-text">{p.displayName}</span>
                    <span className="text-sm text-muted">
                      {categoryLabel(p.categoryId)} · <code>{p.id}</code>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Section>

      <SegmentedControl
        label="Show"
        value={tab}
        onChange={(t) => navigate({ section: 'overrides', query: t === 'all' ? {} : { tab: t } })}
        options={[
          { value: 'all', label: `All (${items.length})` },
          { value: 'hidden', label: `Hidden (${hiddenCount})` },
          { value: 'orphans', label: `Orphans (${orphanCount})` },
        ]}
      />
      {tab === 'orphans' ? (
        <p className="rounded-md border border-border bg-warning-soft p-3 text-sm text-text">
          {ORPHAN_GENERAL_ADVICE}
        </p>
      ) : null}

      {list.state.status === 'error' ? (
        <ErrorNotice error={list.state.error} title="Could not load the overrides" onReload={list.reload} />
      ) : null}
      {list.state.status === 'loading' && !list.state.data ? (
        <Spinner label="Loading overrides…" />
      ) : list.state.data && visible.length === 0 ? (
        <EmptyState
          icon="check"
          title={
            tab === 'orphans'
              ? 'No orphaned overrides'
              : tab === 'hidden'
                ? 'No hidden base places'
                : 'No overrides yet'
          }
          description={tab === 'all' ? 'Search for a campus place above to correct or hide it.' : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Overrides">
          {visible.map((o) => (
            <li key={o.targetId}>
              <a
                href={adminHref({ section: 'overrides', id: o.targetId })}
                onClick={onInAppClick(() => open(o.targetId))}
                className={cx(
                  'flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-3 hover:bg-surface-hover',
                  FOCUS_RING,
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold break-words text-text">{o.baseName ?? o.targetId}</span>
                  {o.orphan ? <Badge tone="warning">Orphan: not applied</Badge> : null}
                  {o.hidden ? <Badge>Hidden</Badge> : null}
                </span>
                <code className="text-xs break-all text-subtle">{o.targetId}</code>
                <span className="text-sm text-text">{overrideSummary(o).join(' · ')}</span>
                {o.orphan && o.orphanReason ? (
                  <span className="text-sm text-muted">{ORPHAN_REASON_ADVICE[o.orphanReason]}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
